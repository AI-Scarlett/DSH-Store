import { createHash } from 'node:crypto'
import { compareVersions, verifyCatalogEntry } from './catalog.mjs'

const COMMIT_SHA = /^[0-9a-f]{40}$/
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_CACHE_TTL_MS = 10 * 60_000
const MAX_COMPARE_FILES = 100
const RISK_PATTERN = /(?:node:)?child_process|\b(?:exec|execFile|spawn|fork)\s*\(|shell\s*:\s*true|(?:node:)?(?:fs|fs\/promises)|\b(?:fetch|WebSocket)\s*\(|process\.env|keychain|__ModuleLoader__.*(?:unload|remove)|\bFiber\b|@deepseek-ai\/.*disabled\s*:\s*true/i

function updateError(code, message) {
  return Object.assign(new Error(message), { code })
}

function githubIdentity(repositoryUrl) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?\/?$/i.exec(repositoryUrl ?? '')
  if (!match) throw updateError('SOURCE_UPDATE_REPOSITORY_INVALID', '插件源不是规范的公开 GitHub 仓库。')
  return { owner: match[1], repo: match[2] }
}

async function fetchJson(url, request, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await request(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-safe-plugin-manager' },
      signal: controller.signal,
    })
    if (!response.ok) throw updateError('SOURCE_UPDATE_GITHUB_HTTP', `GitHub 返回 HTTP ${response.status}。`)
    return await response.json()
  } catch (error) {
    if (error?.code) throw error
    throw updateError(error?.name === 'AbortError' ? 'SOURCE_UPDATE_TIMEOUT' : 'SOURCE_UPDATE_NETWORK',
      error?.name === 'AbortError' ? 'GitHub 源更新检查超时。' : '暂时无法连接 GitHub 检查源更新。')
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url, request, timeoutMs, maxBytes = 512 * 1024) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await request(url, {
      headers: { accept: 'application/vnd.github.raw+json', 'user-agent': 'dsh-safe-plugin-manager' },
      signal: controller.signal,
    })
    if (!response.ok) throw updateError('SOURCE_UPDATE_GITHUB_HTTP', `GitHub 返回 HTTP ${response.status}。`)
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw updateError('SOURCE_UPDATE_TOO_LARGE', '候选源文件超过本机审核上限。')
    return text
  } catch (error) {
    if (error?.code) throw error
    throw updateError(error?.name === 'AbortError' ? 'SOURCE_UPDATE_TIMEOUT' : 'SOURCE_UPDATE_NETWORK',
      error?.name === 'AbortError' ? 'GitHub 源更新检查超时。' : '暂时无法连接 GitHub 检查源更新。')
  } finally {
    clearTimeout(timer)
  }
}

function effectivePolicy(entry) {
  if (entry.updatePolicy === 'registry-reviewed') return 'registry-reviewed'
  const permissions = entry.details?.permissions ?? {}
  const credentials = permissions.credentials ?? ['unknown']
  const sourceVerified = entry.status === 'approved'
    && entry.risk?.installScripts?.length === 0
    && ['none', 'read-only'].includes(permissions.files)
    && permissions.network === 'none'
    && permissions.commands === 'none'
    && credentials.length === 1 && credentials[0] === 'none'
  return sourceVerified ? 'source-verified' : 'registry-reviewed'
}

function publicCandidate(entry) {
  return {
    id: entry.id, packageName: entry.packageName, version: entry.version, commit: entry.commit,
    repositoryUrl: entry.repositoryUrl, manifestPath: entry.manifestPath, installPath: entry.installPath,
    entryIds: entry.entryIds, updatePolicy: entry.updatePolicy,
  }
}

function cacheKey(entry, installed) {
  return createHash('sha256').update(JSON.stringify({
    id: entry.id, commit: entry.commit, version: entry.version, branch: entry.defaultBranch,
    installedVersion: installed?.version ?? null, installedSpecifier: installed?.declaredSpecifier ?? null,
  })).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value ?? null
}

function manifestContract(manifest) {
  return canonical({
    name: manifest?.name, type: manifest?.type, main: manifest?.main, exports: manifest?.exports,
    files: manifest?.files, engines: manifest?.engines, dsh: manifest?.dsh,
    dependencies: manifest?.dependencies, optionalDependencies: manifest?.optionalDependencies,
    peerDependencies: manifest?.peerDependencies,
  })
}

export function createSourceUpdateService(options = {}) {
  const request = options.fetch ?? globalThis.fetch
  const sourceVerifier = options.sourceVerifier ?? verifyCatalogEntry
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const now = options.now ?? (() => Date.now())
  const cache = new Map()
  const approved = new Map()

  async function inspect(entry, installed) {
    if (!entry || entry.status !== 'approved') throw updateError('SOURCE_UPDATE_NOT_APPROVED', '该插件不是可更新的 approved 条目。')
    if (!installed) throw updateError('SOURCE_UPDATE_NOT_INSTALLED', '仅检查当前 Profile 已安装插件的源更新。')
    if (typeof request !== 'function') throw updateError('SOURCE_UPDATE_UNAVAILABLE', '当前运行环境不能访问 GitHub。')
    const key = cacheKey(entry, installed)
    const cached = cache.get(key)
    if (cached && now() - cached.cachedAt < cacheTtlMs) return { ...cached.value, cacheStatus: 'memory-cache' }

    const { owner, repo } = githubIdentity(entry.repositoryUrl)
    const branch = entry.defaultBranch || 'main'
    const head = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, request, timeoutMs)
    const commit = typeof head?.sha === 'string' ? head.sha.toLowerCase() : ''
    if (!COMMIT_SHA.test(commit)) throw updateError('SOURCE_UPDATE_COMMIT_INVALID', 'GitHub 未返回完整候选 Commit。')
    const policy = effectivePolicy(entry)
    if (commit === entry.commit || installed.declaredSpecifier?.toLowerCase().includes(commit)) {
      const value = { status: 'current', policy, branch, catalogCommit: entry.commit, candidateCommit: commit, candidate: null, reasons: [] }
      cache.set(key, { cachedAt: now(), value })
      return { ...value, cacheStatus: 'fresh' }
    }

    const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/`
    const catalogRawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${entry.commit}/`
    let manifest
    let catalogManifest
    try {
      manifest = JSON.parse(await fetchText(`${rawBase}${entry.manifestPath}`, request, timeoutMs))
      catalogManifest = JSON.parse(await fetchText(`${catalogRawBase}${entry.manifestPath}`, request, timeoutMs))
    } catch (error) {
      if (error?.code) throw error
      throw updateError('SOURCE_UPDATE_MANIFEST_INVALID', '候选 Commit 的 package.json 不是有效 JSON。')
    }
    const candidateVersion = typeof manifest?.version === 'string' ? manifest.version : ''
    const candidate = { ...entry, commit, version: candidateVersion, updatePolicy: policy }
    const reasons = []
    if (policy !== 'source-verified') reasons.push('该插件权限或生命周期风险要求 Registry 复审')
    if (compareVersions(candidateVersion, installed.version ?? entry.version) !== 1) reasons.push('候选版本没有高于当前安装版本')
    if (JSON.stringify(manifestContract(manifest)) !== JSON.stringify(manifestContract(catalogManifest))) {
      reasons.push('候选依赖、入口、文件清单、运行时或 Bundle 声明发生变化')
    }
    const candidatePatchRelative = manifest?.dsh?.bundle?.patch
    const catalogPatchRelative = catalogManifest?.dsh?.bundle?.patch
    if (typeof candidatePatchRelative !== 'string' || candidatePatchRelative !== catalogPatchRelative) {
      reasons.push('候选 Bundle Patch 路径发生变化')
    } else {
      const base = entry.manifestPath.includes('/') ? entry.manifestPath.slice(0, entry.manifestPath.lastIndexOf('/') + 1) : ''
      const patchPath = `${base}${candidatePatchRelative.replace(/^\.\//, '')}`
      const [candidatePatch, catalogPatch] = await Promise.all([
        fetchText(`${rawBase}${patchPath}`, request, timeoutMs),
        fetchText(`${catalogRawBase}${patchPath}`, request, timeoutMs),
      ])
      if (candidatePatch !== catalogPatch) reasons.push('候选 Bundle Patch 内容发生变化')
    }
    try {
      await sourceVerifier(candidate, { fetch: request, timeoutMs })
    } catch {
      reasons.push('候选 manifest、许可证、Bundle Patch、入口或生命周期与商城安全契约不一致')
    }

    const comparison = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/compare/${entry.commit}...${commit}`, request, timeoutMs,
    )
    const files = Array.isArray(comparison?.files) ? comparison.files : []
    if (comparison?.status !== 'ahead') reasons.push('候选 Commit 不是商城已审 Commit 的直接后继')
    if (!Number.isInteger(comparison?.total_commits) || comparison.total_commits > 100) reasons.push('候选提交跨度超过本机审核上限')
    if (files.length === 0 || files.length > MAX_COMPARE_FILES) reasons.push('候选文件清单为空或超过本机审核上限')
    for (const file of files) {
      const name = typeof file?.filename === 'string' ? file.filename : ''
      const patch = typeof file?.patch === 'string' ? file.patch : null
      const sourceLike = /\.(?:[cm]?[jt]sx?|ya?ml|json)$/i.test(name)
      const ignored = /(?:^|\/)(?:test|tests|docs?|examples?)\//i.test(name) || /(?:^|\/)README(?:\.|$)/i.test(name)
      if (sourceLike && !ignored && patch === null) reasons.push(`无法完整审核变更文件：${name}`)
      if (sourceLike && !ignored && patch && RISK_PATTERN.test(patch)) reasons.push(`变更出现新的权限或受保护行为信号：${name}`)
    }

    const uniqueReasons = [...new Set(reasons)]
    const status = uniqueReasons.length === 0 ? 'update-ready' : 'registry-review-required'
    const value = {
      status, policy, branch, catalogCommit: entry.commit, candidateCommit: commit,
      candidateVersion, candidate: publicCandidate(candidate), reasons: uniqueReasons,
      checkedFiles: files.length, checkedCommits: comparison?.total_commits ?? null,
      notice: '检查在用户本机按需完成；通过表示结构和权限信号未漂移，不等于完整安全审计。',
    }
    cache.set(key, { cachedAt: now(), value })
    if (status === 'update-ready') approved.set(`${entry.id}:${commit}`, { approvedAt: now(), candidate: { ...candidate } })
    return { ...value, cacheStatus: 'fresh' }
  }

  function approvedCandidate(entry, commit) {
    const value = approved.get(`${entry.id}:${String(commit).toLowerCase()}`)
    if (!value || now() - value.approvedAt >= cacheTtlMs || value.candidate.commit !== String(commit).toLowerCase()) {
      throw updateError('SOURCE_UPDATE_NOT_VERIFIED', '该候选 Commit 尚未通过本机按需审核，请重新检查更新。')
    }
    return { ...value.candidate }
  }

  return { inspect, approvedCandidate, effectivePolicy }
}

export { effectivePolicy }
