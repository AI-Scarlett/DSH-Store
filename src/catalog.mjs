import { readFile } from 'node:fs/promises'

const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/
const SIMPLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const COMMIT_SHA = /^[0-9a-f]{40}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_CACHE_TTL_MS = 5 * 60_000

export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/AI-Scarlett/dsh-safe-plugin-manager/main/registry/catalog.json'

function nonEmptyString(value, label, max = 2_000) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new TypeError(`${label} must be a non-empty string no longer than ${max} characters`)
  }
  return value.trim()
}

export function canonicalGithubRepository(value) {
  const source = nonEmptyString(value, 'repositoryUrl', 300)
    .replace(/^git\+/, '')
    .replace(/\.git\/?$/i, '')
    .replace(/\/$/, '')
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/#]+)$/i.exec(source)
  if (!match) throw new TypeError('repositoryUrl must be an https://github.com/<owner>/<repository> URL')
  return `https://github.com/${match[1]}/${match[2]}`
}

export function githubInstallSpecifier(entry) {
  const repository = canonicalGithubRepository(entry.repositoryUrl)
  if (!COMMIT_SHA.test(entry.commit)) throw new TypeError('catalog install target must use a full Git commit SHA')
  return `git+${repository}.git#${entry.commit}`
}

function rawGithubUrl(entry, path) {
  const repository = canonicalGithubRepository(entry.repositoryUrl)
  const [, owner, repo] = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(repository)
  return `https://raw.githubusercontent.com/${owner}/${repo}/${entry.commit}/${path}`
}

async function fetchPinnedText(url, request, timeoutMs, maxBytes) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await request(url, {
        headers: { accept: 'application/vnd.github.raw+json', 'user-agent': 'dsh-safe-plugin-manager' },
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = new Error(`GitHub source returned HTTP ${response.status}`)
        error.retryable = response.status === 429 || response.status >= 500
        throw error
      }
      const text = await response.text()
      if (Buffer.byteLength(text) > maxBytes) throw new Error('GitHub source file is too large')
      return text
    } catch (error) {
      lastError = error
      if (error?.retryable === false || attempt === 2) throw error
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}

export async function verifyCatalogEntry(entry, options = {}) {
  const request = options.fetch ?? globalThis.fetch
  if (typeof request !== 'function') throw new Error('GitHub source verification is unavailable')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const manifestUrl = rawGithubUrl(entry, entry.manifestPath)
  const manifest = JSON.parse(await fetchPinnedText(manifestUrl, request, timeoutMs, 512 * 1024))
  if (manifest.name !== entry.packageName) throw new Error('GitHub manifest package name does not match the registry')
  if (manifest.version !== entry.version) throw new Error('GitHub manifest version does not match the registry')
  const patchRelative = manifest?.dsh?.bundle?.patch
  if (typeof patchRelative !== 'string' || patchRelative.trim() === '' || patchRelative.includes('..') || patchRelative.startsWith('/')) {
    throw new Error('GitHub manifest does not declare a safe dsh.bundle.patch')
  }
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare'].filter(name => typeof manifest.scripts?.[name] === 'string')
  if (JSON.stringify(lifecycle.sort()) !== JSON.stringify([...entry.risk.installScripts].sort())) {
    throw new Error('GitHub lifecycle scripts do not match the registry risk declaration')
  }
  const base = entry.manifestPath.includes('/') ? entry.manifestPath.slice(0, entry.manifestPath.lastIndexOf('/') + 1) : ''
  const patchPath = `${base}${patchRelative.replace(/^\.\//, '')}`
  const patchUrl = rawGithubUrl(entry, patchPath)
  const patch = await fetchPinnedText(patchUrl, request, timeoutMs, 512 * 1024)
  for (const protectedId of ['ui-settings-plugin-inventory', 'dsh-safe-plugin-manager']) {
    const pattern = new RegExp(`(?:^|\\n)- id: ['\"]?${protectedId}['\"]?[\\s\\S]{0,160}?disabled:\\s*true`, 'i')
    if (pattern.test(patch)) throw new Error(`GitHub Bundle Patch disables protected entry ${protectedId}`)
  }
  if (/@deepseek-ai\//.test(patch) && /disabled:\s*true/.test(patch)) {
    throw new Error('GitHub Bundle Patch appears to disable an official package')
  }
  for (const id of entry.entryIds) {
    const pattern = new RegExp(`(?:^|\\n)\\s*- id: ['\"]?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]?\\s*(?:\\n|$)`)
    if (!pattern.test(patch)) throw new Error(`GitHub Bundle Patch does not declare registry entry id ${id}`)
  }
  return {
    status: 'verified', verifiedAt: new Date().toISOString(), manifestUrl, patchUrl,
    packageName: manifest.name, version: manifest.version, installScripts: lifecycle,
  }
}

function stringArray(value, label, options = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const result = value.map((item, index) => nonEmptyString(item, `${label}[${index}]`, options.max ?? 120))
  if (options.simple === true && result.some(item => !SIMPLE_ID.test(item))) {
    throw new TypeError(`${label} contains an invalid identifier`)
  }
  return [...new Set(result)]
}

function validateEntry(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`entries[${index}] must be an object`)
  }
  const id = nonEmptyString(value.id, `entries[${index}].id`, 96)
  if (!SIMPLE_ID.test(id)) throw new TypeError(`entries[${index}].id is invalid`)
  const packageName = nonEmptyString(value.packageName, `entries[${index}].packageName`, 214)
  if (!PACKAGE_NAME.test(packageName) || packageName.includes('..')) {
    throw new TypeError(`entries[${index}].packageName is invalid`)
  }
  const status = value.status === 'approved' || value.status === 'blocked' ? value.status : null
  if (status === null) throw new TypeError(`entries[${index}].status must be approved or blocked`)
  const commit = nonEmptyString(value.commit, `entries[${index}].commit`, 40).toLowerCase()
  if (!COMMIT_SHA.test(commit)) throw new TypeError(`entries[${index}].commit must be a full Git commit SHA`)
  const version = nonEmptyString(value.version, `entries[${index}].version`, 80)
  if (!VERSION.test(version)) throw new TypeError(`entries[${index}].version must be semantic version text`)
  const manifestPath = nonEmptyString(value.manifestPath ?? 'package.json', `entries[${index}].manifestPath`, 160)
  if (manifestPath.startsWith('/') || manifestPath.includes('..') || manifestPath.includes('\\')) {
    throw new TypeError(`entries[${index}].manifestPath must stay inside the repository`)
  }
  const entryIds = stringArray(value.entryIds ?? [], `entries[${index}].entryIds`, { simple: true })
  if (status === 'approved' && entryIds.length === 0) {
    throw new TypeError(`entries[${index}] approved plugins must declare at least one DSH entry id`)
  }
  const installScripts = stringArray(value.risk?.installScripts ?? [], `entries[${index}].risk.installScripts`, { simple: true })
  const allowedScripts = new Set(['preinstall', 'install', 'postinstall', 'prepare'])
  if (installScripts.some(script => !allowedScripts.has(script))) {
    throw new TypeError(`entries[${index}].risk.installScripts contains an unsupported lifecycle name`)
  }
  return {
    id,
    name: nonEmptyString(value.name, `entries[${index}].name`, 160),
    packageName,
    description: nonEmptyString(value.description, `entries[${index}].description`, 2_000),
    repositoryUrl: canonicalGithubRepository(value.repositoryUrl),
    defaultBranch: nonEmptyString(value.defaultBranch ?? 'main', `entries[${index}].defaultBranch`, 120),
    manifestPath,
    commit,
    version,
    categories: stringArray(value.categories ?? [], `entries[${index}].categories`, { simple: true }),
    entryIds,
    status,
    statusReason: status === 'blocked'
      ? nonEmptyString(value.statusReason, `entries[${index}].statusReason`, 600)
      : null,
    compatibility: {
      dsh: typeof value.compatibility?.dsh === 'string' ? value.compatibility.dsh.slice(0, 120) : null,
      node: typeof value.compatibility?.node === 'string' ? value.compatibility.node.slice(0, 120) : null,
    },
    risk: {
      installScripts,
      review: nonEmptyString(value.risk?.review ?? 'curated-not-security-audited', `entries[${index}].risk.review`, 120),
    },
  }
}

export function validateCatalog(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('catalog must be an object')
  }
  if (document.schemaVersion !== 1) throw new TypeError('catalog schemaVersion must be 1')
  if (!document.registry || typeof document.registry !== 'object' || Array.isArray(document.registry)) {
    throw new TypeError('catalog registry metadata is required')
  }
  if (!Array.isArray(document.entries)) throw new TypeError('catalog entries must be an array')
  const entries = document.entries.map(validateEntry)
  const ids = new Set()
  const packages = new Set()
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new TypeError(`duplicate catalog id ${entry.id}`)
    if (packages.has(entry.packageName)) throw new TypeError(`duplicate catalog package ${entry.packageName}`)
    ids.add(entry.id)
    packages.add(entry.packageName)
  }
  return {
    schemaVersion: 1,
    registry: {
      name: nonEmptyString(document.registry.name, 'registry.name', 160),
      repositoryUrl: canonicalGithubRepository(document.registry.repositoryUrl),
      homepageUrl: typeof document.registry.homepageUrl === 'string'
        ? document.registry.homepageUrl.slice(0, 400)
        : null,
      updatedAt: nonEmptyString(document.registry.updatedAt, 'registry.updatedAt', 80),
    },
    entries,
  }
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value ?? '')
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? null }
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.pre === b.pre) return 0
  if (a.pre === null) return 1
  if (b.pre === null) return -1
  return a.pre.localeCompare(b.pre, 'en', { numeric: true })
}

export function searchCatalog(catalog, query = '') {
  const needle = String(query).trim().toLowerCase()
  if (needle === '') return catalog.entries
  return catalog.entries.filter(entry => [
    entry.id, entry.name, entry.packageName, entry.description,
    entry.repositoryUrl, ...entry.categories,
  ].some(value => value.toLowerCase().includes(needle)))
}

export function buildMarketplaceSnapshot(catalog, inventory, query = '') {
  const installedByName = new Map(inventory.plugins.map(plugin => [plugin.packageName, plugin]))
  const entries = searchCatalog(catalog, query).map(entry => {
    const installed = installedByName.get(entry.packageName) ?? null
    const versionComparison = installed?.version ? compareVersions(installed.version, entry.version) : null
    const localProtected = ['link', 'file', 'workspace'].includes(installed?.source)
    const commitMatched = installed?.source === 'git'
      && typeof installed.declaredSpecifier === 'string'
      && installed.declaredSpecifier.toLowerCase().includes(entry.commit)
    const commitDrift = installed?.source === 'git' && !commitMatched
    let managementBlockedReason = null
    if (entry.status !== 'approved') managementBlockedReason = entry.statusReason
    else if (entry.packageName === 'dsh-safe-plugin-manager') managementBlockedReason = '管理器自身受保护'
    else if (installed?.official) managementBlockedReason = '官方组件永久只读'
    else if (localProtected) managementBlockedReason = '本地开发链接不会被市场替换'
    return {
      ...entry,
      installed: installed !== null,
      installedVersion: installed?.version ?? null,
      installedSource: installed?.source ?? null,
      updateAvailable: installed !== null && (versionComparison === -1 || commitDrift),
      commitMatched,
      versionState: versionComparison === null ? 'unknown' : versionComparison < 0 ? 'behind' : versionComparison > 0 ? 'ahead' : 'equal',
      manageable: managementBlockedReason === null,
      managementBlockedReason,
    }
  })
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profile: inventory.profile,
    registry: catalog.registry,
    source: catalog.source,
    entries,
  }
}

async function readResponseJson(response) {
  if (!response.ok) throw new Error(`catalog returned HTTP ${response.status}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_CATALOG_BYTES) throw new Error('catalog response is too large')
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) throw new Error('catalog response is too large')
  return JSON.parse(text)
}

export function createCatalogService(options = {}) {
  const catalogUrl = options.catalogUrl === null ? null : (options.catalogUrl ?? DEFAULT_CATALOG_URL)
  const bundledUrl = options.bundledUrl ?? new URL('../registry/catalog.json', import.meta.url)
  const request = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  let cached = null
  let cachedAt = 0

  async function bundled(errorCode = null) {
    const document = validateCatalog(JSON.parse(await readFile(bundledUrl, 'utf8')))
    return {
      ...document,
      source: { kind: 'bundled', url: catalogUrl, fetchedAt: new Date().toISOString(), errorCode },
    }
  }

  async function load({ force = false } = {}) {
    if (!force && cached && Date.now() - cachedAt < cacheTtlMs) return cached
    let value
    if (catalogUrl === null || typeof request !== 'function') {
      value = await bundled(catalogUrl === null ? null : 'FETCH_UNAVAILABLE')
    } else {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await request(catalogUrl, {
          headers: { accept: 'application/json', 'user-agent': 'dsh-safe-plugin-manager' },
          signal: controller.signal,
        })
        const document = validateCatalog(await readResponseJson(response))
        value = {
          ...document,
          source: { kind: 'github', url: catalogUrl, fetchedAt: new Date().toISOString(), errorCode: null },
        }
      } catch (error) {
        const code = error?.name === 'AbortError' ? 'CATALOG_TIMEOUT' : 'CATALOG_UNAVAILABLE'
        value = await bundled(code)
      } finally {
        clearTimeout(timer)
      }
    }
    cached = value
    cachedAt = Date.now()
    return value
  }

  return { load }
}
