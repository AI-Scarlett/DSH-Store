import { readFile, writeFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalGithubRepository, validateCatalog, verifyCatalogEntry } from '../src/catalog.mjs'
import { SUBMISSION_SCAN_BOUNDS, scanSubmissionSources } from '../src/submission-security-scan.mjs'

export const SUBMISSION_REPORT_MARKER = '<!-- dsh-plugin-submission-check -->'

const LABELS = Object.freeze({
  repository: 'GitHub repository',
  pluginPath: 'Plugin path (optional)',
  legacyInstallPath: 'Install path',
  notes: 'Notes (optional)',
})
const PROTECTED_ENTRY_IDS = new Set(['ui-settings-plugin-inventory', 'dsh-safe-plugin-manager'])
const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare']
const MAX_MANIFEST_CANDIDATES = 48
const DEFAULT_TIMEOUT_MS = 10_000
const SECURITY_SCAN_TREE_BYTES = 8 * 1024 * 1024
const SECURITY_SCAN_SOURCE = /\.(?:[cm]?[jt]sx?|py|rb|php|go|rs|java|kt|kts|swift|cs|c|cc|cpp|h|hpp|sh|bash|zsh|fish|ps1|psm1|cmd|bat|ya?ml|json)$/i
const SECURITY_SCAN_EXCLUDED_DIRECTORY = /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|target|\.git|\.next|\.nuxt|out)(?:\/|$)/i
const SECURITY_SCAN_EXCLUDED_FILE = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb?|composer\.lock|Cargo\.lock|go\.sum|.*\.min\.js|.*\.map)$/i

function submissionError(code, message) {
  return Object.assign(new Error(message), { code })
}

function cleanValue(value) {
  const cleaned = String(value ?? '').trim()
  if (cleaned === '' || cleaned === '_No response_' || cleaned === 'No response') return ''
  return cleaned
}

export function parseIssueForm(body) {
  if (typeof body !== 'string' || body.trim() === '') {
    throw submissionError('SUBMISSION_BODY_INVALID', 'Issue body is empty or not an Issue Form response')
  }
  const fields = new Map()
  const lines = body.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^### (.+)$/.exec(lines[index])
    if (!match) continue
    let end = index + 1
    while (end < lines.length && !lines[end].startsWith('### ')) end += 1
    fields.set(match[1].trim(), cleanValue(lines.slice(index + 1, end).join('\n')))
    index = end - 1
  }
  return fields
}

function requiredField(fields, label) {
  const value = cleanValue(fields.get(label))
  if (value === '') throw submissionError('SUBMISSION_FIELD_MISSING', `${label} is required`)
  return value
}

function safeRelativeDirectory(value) {
  const cleaned = cleanValue(value)
  if (cleaned === '' || cleaned === '.' || cleaned === '/' || cleaned.toLowerCase() === 'root') return null
  const normalized = cleaned.replace(/^\.\//, '').replace(/\/$/, '').replace(/\/package\.json$/, '')
  if (normalized === '' || normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\\') || normalized.includes('\0')) {
    throw submissionError('SUBMISSION_PATH_INVALID', 'Plugin path must stay inside the repository')
  }
  return normalized
}

export function parseRepositoryInput(value) {
  let url
  try { url = new URL(cleanValue(value)) } catch {
    throw submissionError('SUBMISSION_REPOSITORY_INVALID', 'GitHub repository must be a valid HTTPS URL')
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw submissionError('SUBMISSION_REPOSITORY_INVALID', 'Only public https://github.com repositories are supported')
  }
  const segments = url.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment))
  if (segments.length < 2) {
    throw submissionError('SUBMISSION_REPOSITORY_INVALID', 'GitHub repository URL must include owner and repository')
  }
  const repository = segments[1].replace(/\.git$/i, '')
  const repositoryUrl = canonicalGithubRepository(`https://github.com/${segments[0]}/${repository}`)
  const linkedPath = ['tree', 'blob'].includes(segments[2]) && segments.length > 4
    ? safeRelativeDirectory(segments.slice(4).join('/'))
    : null
  return { repositoryUrl, linkedPath }
}

function githubParts(repositoryUrl) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(canonicalGithubRepository(repositoryUrl))
  return { owner: match[1], repository: match[2] }
}

function requestHeaders(token, accept = 'application/vnd.github+json') {
  return {
    accept,
    'user-agent': 'dsh-safe-plugin-manager-submission-check',
    'x-github-api-version': '2022-11-28',
    ...(typeof token === 'string' && token.trim() !== '' ? { authorization: `Bearer ${token.trim()}` } : {}),
  }
}

async function fetchText(url, options) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await options.request(url, {
      headers: requestHeaders(options.token, options.accept), signal: controller.signal,
    })
    if (!response?.ok) {
      if (options.optional === true && response?.status === 404) return null
      throw submissionError(options.code ?? 'SUBMISSION_GITHUB_HTTP', `GitHub returned HTTP ${response?.status ?? 'unknown'} for required source metadata`)
    }
    const text = await response.text()
    if (Buffer.byteLength(text) > (options.maxBytes ?? 2 * 1024 * 1024)) {
      throw submissionError('SUBMISSION_SOURCE_TOO_LARGE', 'GitHub source metadata exceeds the static precheck limit')
    }
    return text
  } catch (error) {
    if (typeof error?.code === 'string') throw error
    if (error?.name === 'AbortError') throw submissionError('SUBMISSION_GITHUB_TIMEOUT', 'GitHub source metadata request timed out')
    throw submissionError('SUBMISSION_GITHUB_NETWORK', 'GitHub source metadata is temporarily unavailable')
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url, options) {
  const text = await fetchText(url, options)
  try { return JSON.parse(text) } catch {
    throw submissionError('SUBMISSION_GITHUB_JSON_INVALID', 'GitHub returned invalid JSON metadata')
  }
}

function rawUrl(repositoryUrl, commit, path) {
  const { owner, repository } = githubParts(repositoryUrl)
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${commit}/${encodedPath}`
}

async function readPinnedJson(repositoryUrl, commit, path, options) {
  const text = await fetchText(rawUrl(repositoryUrl, commit, path), {
    ...options, accept: 'application/vnd.github.raw+json', maxBytes: 512 * 1024,
    code: 'SUBMISSION_SOURCE_HTTP',
  })
  try { return JSON.parse(text) } catch {
    throw submissionError('SUBMISSION_MANIFEST_INVALID', `${path} is not valid JSON`)
  }
}

async function readPinnedText(repositoryUrl, commit, path, options = {}) {
  return fetchText(rawUrl(repositoryUrl, commit, path), {
    ...options, accept: 'application/vnd.github.raw+json', maxBytes: options.maxBytes ?? 512 * 1024,
    code: 'SUBMISSION_SOURCE_HTTP',
  })
}

function isPossibleManifestPath(path) {
  if (!(path === 'package.json' || path.endsWith('/package.json'))) return false
  return !/(?:^|\/)(?:node_modules|vendor|fixtures?|examples?|test-data|dist|build)(?:\/|$)/i.test(path)
}

function safePatchPath(manifestPath, declared) {
  if (typeof declared !== 'string' || declared.trim() === '' || declared.startsWith('/') || declared.includes('..') || declared.includes('\\')) {
    throw submissionError('SUBMISSION_BUNDLE_PATCH_INVALID', 'package.json must declare a safe repository-relative dsh.bundle.patch')
  }
  const base = manifestPath.includes('/') ? posix.dirname(manifestPath) : ''
  return base ? posix.join(base, declared.replace(/^\.\//, '')) : declared.replace(/^\.\//, '')
}

function patchEntryIds(patch, options = {}) {
  if (/\bname:\s*['"]?@deepseek-ai\//i.test(patch)) {
    throw submissionError('SUBMISSION_PATCH_PROTECTED', 'Bundle Patch impersonates the protected @deepseek-ai namespace')
  }
  if (/@deepseek-ai\//.test(patch) && /disabled:\s*true/i.test(patch)) {
    throw submissionError('SUBMISSION_PATCH_PROTECTED', 'Bundle Patch appears to disable an official component')
  }
  const ids = [...new Set([...patch.matchAll(/(?:^|\n)\s*- id:\s*['"]?([A-Za-z0-9][A-Za-z0-9._-]{0,95})['"]?\s*(?:\n|$)/g)]
    .map(match => match[1]))]
  if (ids.length === 0) throw submissionError('SUBMISSION_ENTRY_MISSING', 'Bundle Patch does not declare a DSH entry ID')
  const protectedIds = ids.filter(id => PROTECTED_ENTRY_IDS.has(id))
  const allowProtectedManager = options.allowProtectedManager === true
    && ids.length === 1
    && ids[0] === 'dsh-safe-plugin-manager'
  if (protectedIds.length > 0 && !allowProtectedManager) {
    throw submissionError('SUBMISSION_ENTRY_PROTECTED', 'Bundle Patch uses a protected DSH entry ID')
  }
  return ids
}

function readmeDescription(markdown) {
  if (typeof markdown !== 'string') return ''
  const paragraphs = markdown
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map(value => value.replace(/<[^>]+>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim())
    .filter(value => value && !value.startsWith('#') && !value.startsWith('[![') && !/^[-*|]/.test(value))
  return (paragraphs[0] ?? '').slice(0, 1_000)
}

function catalogId(packageName) {
  const candidate = packageName.split('/').at(-1).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(candidate)) {
    throw submissionError('SUBMISSION_PACKAGE_INVALID', 'Package name cannot be converted to a stable Catalog ID')
  }
  return candidate
}

function inferredCategories(manifest, catalog, pluginType) {
  const declared = Array.isArray(manifest.keywords) ? manifest.keywords.map(value => String(value).toLowerCase()) : []
  const matched = declared.filter(value => Object.hasOwn(catalog.registry.categories, value))
  if (matched.length > 0) return [...new Set(matched)]
  if (pluginType === 'theme' && Object.hasOwn(catalog.registry.categories, 'themes')) return ['themes']
  if (pluginType === 'client' && Object.hasOwn(catalog.registry.categories, 'clients')) return ['clients']
  return [Object.hasOwn(catalog.registry.categories, 'experimental') ? 'experimental' : Object.keys(catalog.registry.categories)[0]]
}

function inferredCompatibility(manifest) {
  const declared = manifest?.dsh?.compatibility && typeof manifest.dsh.compatibility === 'object'
    ? manifest.dsh.compatibility
    : {}
  const peerRanges = Object.entries(manifest.peerDependencies ?? {})
    .filter(([name, range]) => name.startsWith('@deepseek-ai/dsh-') && typeof range === 'string')
    .map(([, range]) => range)
  const uniquePeerRanges = [...new Set(peerRanges)]
  const os = Array.isArray(manifest.os) ? manifest.os : []
  const systems = os.flatMap(value => ({ darwin: 'macOS', linux: 'Linux', win32: 'Windows' })[String(value)] ?? [])
  const declaredProfiles = Array.isArray(declared.profiles) ? declared.profiles.filter(value => typeof value === 'string') : []
  const platform = manifest?.dsh?.client?.platform
  return {
    dsh: typeof declared.dsh === 'string' ? declared.dsh : uniquePeerRanges.length === 1 ? uniquePeerRanges[0] : null,
    dshReleases: Object.hasOwn(declared, 'dshReleases') ? declared.dshReleases : {},
    node: typeof manifest.engines?.node === 'string' ? manifest.engines.node : null,
    systems: [...new Set(systems)],
    profiles: [...new Set([...declaredProfiles, ...(platform === 'web' ? ['web'] : [])])],
  }
}

function checkCatalogCollisions(entry, catalog) {
  const existing = catalog.entries.find(item => item.id === entry.id || item.packageName === entry.packageName)
  if (existing && (existing.id !== entry.id || existing.packageName !== entry.packageName || existing.repositoryUrl !== entry.repositoryUrl)) {
    throw submissionError('SUBMISSION_CATALOG_COLLISION', 'Catalog ID or package name collides with another registry entry')
  }
  for (const item of catalog.entries) {
    if (item.id === existing?.id) continue
    const overlap = entry.entryIds.find(id => item.entryIds.includes(id))
    if (overlap) throw submissionError('SUBMISSION_ENTRY_COLLISION', `DSH entry ID ${overlap} is already owned by ${item.id}`)
  }
}

async function repositorySnapshot(repositoryUrl, options) {
  const { owner, repository } = githubParts(repositoryUrl)
  const apiRoot = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
  const metadata = await fetchJson(apiRoot, { ...options, code: 'SUBMISSION_REPOSITORY_HTTP' })
  if (metadata.private === true) throw submissionError('SUBMISSION_REPOSITORY_PRIVATE', 'Repository must be public')
  if (metadata.archived === true) throw submissionError('SUBMISSION_REPOSITORY_ARCHIVED', 'Archived repositories cannot enter the active marketplace')
  if (typeof metadata.default_branch !== 'string' || metadata.default_branch === '') {
    throw submissionError('SUBMISSION_DEFAULT_BRANCH_MISSING', 'Repository does not expose a default branch')
  }
  const commit = await fetchJson(`${apiRoot}/commits/${encodeURIComponent(metadata.default_branch)}`, {
    ...options, code: 'SUBMISSION_COMMIT_HTTP',
  })
  if (!/^[0-9a-f]{40}$/.test(commit.sha ?? '')) {
    throw submissionError('SUBMISSION_COMMIT_INVALID', 'GitHub did not return a full immutable commit SHA')
  }
  return { defaultBranch: metadata.default_branch, commit: commit.sha, apiRoot }
}

async function discoverManifest(repositoryUrl, snapshot, requestedPath, options) {
  if (requestedPath !== null) {
    const manifestPath = `${requestedPath}/package.json`
    const manifest = await readPinnedJson(repositoryUrl, snapshot.commit, manifestPath, options)
    if (!manifest?.dsh?.bundle?.patch) {
      throw submissionError('SUBMISSION_BUNDLE_MISSING', `${manifestPath} does not declare dsh.bundle.patch`)
    }
    return { manifestPath, manifest, candidates: [requestedPath] }
  }
  const tree = await fetchJson(`${snapshot.apiRoot}/git/trees/${snapshot.commit}?recursive=1`, {
    ...options, code: 'SUBMISSION_TREE_HTTP', maxBytes: 4 * 1024 * 1024,
  })
  if (tree.truncated === true) {
    throw submissionError('SUBMISSION_TREE_TRUNCATED', 'Repository tree is too large; edit the Issue and provide Plugin path')
  }
  const paths = (Array.isArray(tree.tree) ? tree.tree : [])
    .filter(item => item?.type === 'blob' && typeof item.path === 'string' && isPossibleManifestPath(item.path))
    .map(item => item.path)
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))
  if (paths.length > MAX_MANIFEST_CANDIDATES) {
    throw submissionError('SUBMISSION_MANIFEST_LIMIT', `Repository has more than ${MAX_MANIFEST_CANDIDATES} package manifests; edit the Issue and provide Plugin path`)
  }
  const matches = []
  for (const manifestPath of paths) {
    const manifest = await readPinnedJson(repositoryUrl, snapshot.commit, manifestPath, options)
    if (manifest?.dsh?.bundle?.patch) matches.push({ manifestPath, manifest })
  }
  if (matches.length === 0) throw submissionError('SUBMISSION_BUNDLE_MISSING', 'No package.json declaring dsh.bundle.patch was found')
  if (matches.length > 1) {
    const candidates = matches.map(item => item.manifestPath === 'package.json' ? '.' : posix.dirname(item.manifestPath)).join(', ')
    throw submissionError('SUBMISSION_PACKAGE_AMBIGUOUS', `Multiple DSH plugins were found. Set Plugin path to one of: ${candidates}`)
  }
  return { ...matches[0], candidates: matches.map(item => posix.dirname(item.manifestPath)) }
}

async function optionalReadme(repositoryUrl, commit, manifestPath, options) {
  const packageDirectory = manifestPath === 'package.json' ? '' : posix.dirname(manifestPath)
  const candidates = [...new Set([packageDirectory ? `${packageDirectory}/README.md` : 'README.md', 'README.md'])]
  for (const path of candidates) {
    const text = await readPinnedText(repositoryUrl, commit, path, { ...options, optional: true, maxBytes: 512 * 1024 })
    if (text !== null) return { path, text }
  }
  return { path: null, text: '' }
}

export async function checkRepository(repositoryValue, pluginPath = '', options = {}) {
  const request = options.fetch ?? globalThis.fetch
  if (typeof request !== 'function') throw submissionError('SUBMISSION_FETCH_UNAVAILABLE', 'Public GitHub source verification is unavailable')
  const catalogDocument = options.catalogDocument ?? JSON.parse(await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8'))
  const catalog = validateCatalog(catalogDocument)
  const repositoryInput = parseRepositoryInput(repositoryValue)
  const submittedPath = cleanValue(pluginPath)
  const requestedPath = safeRelativeDirectory(submittedPath) ?? repositoryInput.linkedPath
  const fetchOptions = { request, token: options.token ?? process.env.GITHUB_TOKEN, timeoutMs: options.timeoutMs }
  const snapshot = await repositorySnapshot(repositoryInput.repositoryUrl, fetchOptions)
  const discovered = await discoverManifest(repositoryInput.repositoryUrl, snapshot, requestedPath, fetchOptions)
  const manifest = discovered.manifest
  if (typeof manifest.name !== 'string' || !/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(manifest.name)) {
    throw submissionError('SUBMISSION_PACKAGE_INVALID', 'package.json must declare a valid package name')
  }
  if (manifest.name.startsWith('@deepseek-ai/')) {
    throw submissionError('SUBMISSION_PACKAGE_PROTECTED', 'Third-party plugins cannot use the @deepseek-ai namespace')
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw submissionError('SUBMISSION_VERSION_INVALID', 'package.json must declare a semantic version')
  }
  const patchPath = safePatchPath(discovered.manifestPath, manifest.dsh.bundle.patch)
  const patch = await readPinnedText(repositoryInput.repositoryUrl, snapshot.commit, patchPath, fetchOptions)
  const allowProtectedManager = options.allowProtectedManager === true
    && repositoryInput.repositoryUrl === 'https://github.com/AI-Scarlett/dsh-safe-plugin-manager'
    && manifest.name === 'dsh-safe-plugin-manager'
  const entryIds = patchEntryIds(patch, { allowProtectedManager })
  const readme = await optionalReadme(repositoryInput.repositoryUrl, snapshot.commit, discovered.manifestPath, fetchOptions)
  const pluginType = ['feature', 'theme', 'suite', 'client', 'provider'].includes(manifest?.dsh?.pluginType)
    ? manifest.dsh.pluginType
    : 'unknown'
  const installPath = discovered.manifestPath === 'package.json' ? null : posix.dirname(discovered.manifestPath)
  const candidate = validateCatalog({ ...catalogDocument, entries: [{
    id: catalogId(manifest.name),
    name: cleanValue(manifest.displayName ?? manifest?.dsh?.displayName) || manifest.name,
    packageName: manifest.name,
    description: cleanValue(manifest.description) || readmeDescription(readme.text) || `${manifest.name} DSH plugin submission candidate`,
    repositoryUrl: repositoryInput.repositoryUrl,
    defaultBranch: snapshot.defaultBranch,
    manifestPath: discovered.manifestPath,
    ...(installPath === null ? {} : { installPath }),
    commit: snapshot.commit,
    version: manifest.version,
    categories: inferredCategories(manifest, catalog, pluginType),
    featured: false,
    entryIds,
    status: 'approved',
    compatibility: inferredCompatibility(manifest),
    details: {
      pluginType, installSource: 'github',
      license: cleanValue(manifest.license) || 'UNKNOWN',
      permissions: { level: 'unknown', files: 'unknown', network: 'unknown', commands: 'unknown', credentials: ['unknown'] },
      externalDependencies: [], reviewStatus: 'automated-scan',
    },
    risk: {
      installScripts: LIFECYCLE_SCRIPTS.filter(name => typeof manifest.scripts?.[name] === 'string'),
      review: 'submission-static-precheck-not-security-audited',
    },
  }] }).entries[0]
  checkCatalogCollisions(candidate, catalog)
  const source = await verifyCatalogEntry(candidate, { fetch: request, retryDelaysMs: options.retryDelaysMs ?? [300, 900] })
  return {
    status: 'passed', candidate, source,
    discovery: { publisher: githubParts(repositoryInput.repositoryUrl).owner, readmePath: readme.path, patchPath },
  }
}

export async function checkSubmission(body, options = {}) {
  const fields = parseIssueForm(body)
  const repositoryValue = requiredField(fields, LABELS.repository)
  const pluginPath = cleanValue(fields.get(LABELS.pluginPath)) || cleanValue(fields.get(LABELS.legacyInstallPath))
  return checkRepository(repositoryValue, pluginPath, options)
}

function scanFilePriority(path) {
  if (path === 'package.json' || /(?:^|\/)(?:cordis|plugin)(?:\.patch)?\.ya?ml$/i.test(path)) return 0
  if (/(?:^|\/)(?:src|lib|runtime|server|client|plugin)(?:\/|$)/i.test(path)) return 1
  if (/(?:^|\/)(?:bin|scripts?)(?:\/|$)/i.test(path)) return 2
  if (/(?:^|\/)(?:docs?|examples?|fixtures?|tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./i.test(path)) return 4
  return 3
}

function repositoryPathWithinPackage(path, installPath) {
  const prefix = installPath ? `${installPath.replace(/\/$/, '')}/` : ''
  if (prefix && !path.startsWith(prefix)) return null
  return prefix ? path.slice(prefix.length) : path
}

export async function scanSubmissionRepository(result, options = {}) {
  if (result?.status !== 'passed' || !result.candidate) {
    throw submissionError('SUBMISSION_SCAN_INPUT_INVALID', 'Security scan requires a passed fixed-source precheck')
  }
  const request = options.fetch ?? globalThis.fetch
  if (typeof request !== 'function') throw submissionError('SUBMISSION_FETCH_UNAVAILABLE', 'Public GitHub source verification is unavailable')
  const entry = result.candidate
  const { owner, repository } = githubParts(entry.repositoryUrl)
  const apiRoot = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
  const fetchOptions = { request, token: options.token ?? process.env.GITHUB_TOKEN, timeoutMs: options.timeoutMs }
  const tree = await fetchJson(`${apiRoot}/git/trees/${entry.commit}?recursive=1`, {
    ...fetchOptions, code: 'SUBMISSION_SCAN_TREE_HTTP', maxBytes: SECURITY_SCAN_TREE_BYTES,
  })
  const treeEntries = Array.isArray(tree?.tree) ? tree.tree : []
  const packageEntries = treeEntries
    .map(item => ({ item, relativePath: typeof item?.path === 'string'
      ? repositoryPathWithinPackage(item.path, entry.installPath) : null }))
    .filter(record => record.relativePath !== null)
  const skippedUnsupported = packageEntries.filter(({ item, relativePath }) =>
    (item?.mode === '120000' || item?.mode === '160000' || item?.type === 'commit')
    && (SECURITY_SCAN_SOURCE.test(relativePath) || relativePath === 'package.json')).length
  const eligible = packageEntries
    .filter(({ item, relativePath }) => item?.type === 'blob'
      && item?.mode !== '120000'
      && !SECURITY_SCAN_EXCLUDED_DIRECTORY.test(relativePath)
      && !SECURITY_SCAN_EXCLUDED_FILE.test(relativePath)
      && (relativePath === 'package.json' || SECURITY_SCAN_SOURCE.test(relativePath)))
    .sort((left, right) => scanFilePriority(left.relativePath) - scanFilePriority(right.relativePath)
      || left.relativePath.localeCompare(right.relativePath, 'en'))
  const oversized = eligible.filter(({ item }) => !Number.isSafeInteger(item?.size)
    || item.size > SUBMISSION_SCAN_BOUNDS.maxFileBytes)
  const selected = eligible.filter(({ item }) => Number.isSafeInteger(item?.size)
      && item.size <= SUBMISSION_SCAN_BOUNDS.maxFileBytes)
    .slice(0, SUBMISSION_SCAN_BOUNDS.maxFiles)
  const sources = []
  for (let index = 0; index < selected.length; index += 8) {
    const batch = selected.slice(index, index + 8)
    const texts = await Promise.all(batch.map(({ item }) => readPinnedText(
      entry.repositoryUrl, entry.commit, item.path,
      { ...fetchOptions, maxBytes: SUBMISSION_SCAN_BOUNDS.maxFileBytes },
    )))
    for (let offset = 0; offset < batch.length; offset += 1) {
      sources.push({ path: batch[offset].relativePath, source: texts[offset] })
    }
  }
  return scanSubmissionSources(sources, {
    eligibleFiles: eligible.length,
    skippedOversize: oversized.length,
    skippedUnsupported,
    capped: tree?.truncated === true || eligible.length === 0
      || eligible.length - oversized.length > SUBMISSION_SCAN_BOUNDS.maxFiles,
  })
}

function safeCode(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 1_000)
}

function renderSecurityScan(scan) {
  if (!scan) return ''
  const verdict = { pass: '通过', warn: '警告', fail: '阻断' }[scan.verdict] ?? '未知'
  const boundary = scan.complete
    ? '扫描面完整'
    : `扫描面不完整；超限文件 ${scan.skippedOversize} 个，不支持项 ${scan.skippedUnsupported} 个${scan.capped ? '，并达到文件/目录树上限' : ''}`
  const findings = scan.findings.slice(0, 12).map(finding =>
    `  - \`${safeCode(finding.severity)}/${safeCode(finding.category)}/${safeCode(finding.rule)}\` ` +
    `\`${safeCode(finding.file)}:${finding.line}\`：${safeCode(finding.message)}`)
  return `- 安全启发式扫描：**${verdict}**；已扫 ${scan.filesScanned}/${scan.eligibleFiles} 个文件；` +
    `Critical ${scan.counts.critical}、Warning ${scan.counts.warning}、Info ${scan.counts.info}；${boundary}\n` +
    (findings.length > 0 ? `- 扫描发现：\n${findings.join('\n')}\n` : '')
}

export function renderSubmissionReport(result) {
  if (result.status === 'passed') {
    const entry = result.candidate
    return `${SUBMISSION_REPORT_MARKER}\n### DSH 插件提交自动预检：固定源码读取通过\n\n` +
      `- GitHub 发布者：\`@${safeCode(result.discovery.publisher)}\`\n` +
      `- 固定来源：[\`${safeCode(entry.commit)}\`](${entry.repositoryUrl}/commit/${entry.commit})\n` +
      `- 自动识别：\`${safeCode(entry.packageName)}@${safeCode(entry.version)}\`，manifest 为 \`${safeCode(entry.manifestPath)}\`\n` +
      `- Bundle Patch：\`${safeCode(result.discovery.patchPath)}\`；入口：${entry.entryIds.map(id => `\`${safeCode(id)}\``).join('、')}\n` +
      `- 生命周期脚本：${entry.risk.installScripts.length > 0 ? entry.risk.installScripts.map(name => `\`${name}\``).join('、') : '无'}\n` +
      `- README：${result.discovery.readmePath ? `\`${safeCode(result.discovery.readmePath)}\`` : '未找到，介绍需人工补充'}\n` +
      renderSecurityScan(result.securityScan) + '\n' +
      '> 机器人没有执行第三方代码。扫描是有边界的静态启发式检查；此结果不是安全审计、运行验证或自动上架，权限、外部依赖、兼容性和实际运行效果仍是独立证据层级。'
  }
  return `${SUBMISSION_REPORT_MARKER}\n### DSH 插件提交自动预检：需要补充或修复\n\n` +
    `- 错误代码：\`${safeCode(result.code ?? 'SUBMISSION_CHECK_FAILED')}\`\n` +
    `- 原因：${safeCode(result.message ?? 'Unknown validation failure')}\n` +
    renderSecurityScan(result.securityScan) + '\n' +
    '> 请直接编辑本 Issue。若检测到多个插件，只需补充 Plugin path；无需手填整份 Catalog。工作流不会执行第三方代码；静态扫描结论也不等于安全审计。'
}

function argumentsFrom(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw submissionError('SUBMISSION_CLI_INVALID', 'Expected --event, --report, and --result arguments')
    args.set(key, value)
  }
  return args
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  const args = argumentsFrom(argv)
  const eventPath = args.get('--event')
  const reportPath = args.get('--report')
  const resultPath = args.get('--result')
  if (!eventPath || !reportPath || !resultPath) {
    throw submissionError('SUBMISSION_CLI_INVALID', '--event, --report, and --result are required')
  }
  const event = JSON.parse(await readFile(eventPath, 'utf8'))
  let result
  try {
    result = await checkSubmission(event?.issue?.body, options)
    const scanRepository = options.scanRepository ?? scanSubmissionRepository
    result.securityScan = await scanRepository(result, options)
    if (result.securityScan.verdict === 'fail') {
      result = {
        ...result,
        status: 'failed',
        code: 'SUBMISSION_SECURITY_HIGH_RISK',
        message: '固定 Commit 中发现硬编码密钥、数据外传、破坏性命令或挖矿等高危静态特征',
      }
    }
  } catch (error) {
    result = { ...(result ?? {}),
      status: 'failed',
      code: typeof error?.code === 'string' ? error.code : 'SUBMISSION_CHECK_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }
  }
  await writeFile(reportPath, `${renderSubmissionReport(result)}\n`, 'utf8')
  await writeFile(resultPath, `${JSON.stringify({
    status: result.status,
    code: result.code ?? null,
    securityScan: result.securityScan ?? null,
    source: result.candidate ? {
      repositoryUrl: result.candidate.repositoryUrl,
      commit: result.candidate.commit,
      manifestPath: result.candidate.manifestPath,
    } : null,
    checkedAt: new Date().toISOString(),
  })}\n`, 'utf8')
  return result.status === 'passed' ? 0 : 1
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli().then(code => { process.exitCode = code }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  })
}
