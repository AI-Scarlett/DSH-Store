import { readFile } from 'node:fs/promises'

const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/
const SIMPLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const COMMIT_SHA = /^[0-9a-f]{40}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_CACHE_TTL_MS = 5 * 60_000
const DEFAULT_RETRY_DELAYS_MS = [300, 900, 1_800]
const MAX_COUNTS_BYTES = 256 * 1024
export const DSH_RC_RELEASES = ['rc.7', 'rc.8', '0.1.1-rc.1', '0.1.1-rc.2']
export const DSH_OPERATIONS = ['install', 'start', 'uninstall', 'rollback']
export const DSH_RC_VERSIONS = {
  'rc.7': '0.1.0-rc.7',
  'rc.8': '0.1.0-rc.8',
  '0.1.1-rc.1': '0.1.1-rc.1',
  '0.1.1-rc.2': '0.1.1-rc.2',
}
const MAX_DSH_RELEASE_KEYS = 64
export const MARKET_PAGE_SIZE = 24
export const MAX_MARKET_PAGE_SIZE = 48
const MAX_DSH_RANGE_LENGTH = 512
const MAX_DSH_RANGE_CLAUSES = 16
const MAX_DSH_RANGE_TOKENS = 32
const DSH_RANGE_OPERATORS = ['>=', '<=', '>', '<', '^', '~', '=']

export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/catalog.json'

function parseDshRangeClause(clause) {
  const fragments = clause.trim().split(/\s+/u).filter(Boolean)
  if (fragments.length === 0 || fragments.length > MAX_DSH_RANGE_TOKENS * 2) return null
  const tokens = []
  for (let index = 0; index < fragments.length; index += 1) {
    let fragment = fragments[index]
    let operator = '='
    if (DSH_RANGE_OPERATORS.includes(fragment)) {
      operator = fragment
      fragment = fragments[++index] ?? ''
    } else {
      const prefix = DSH_RANGE_OPERATORS.find(candidate => fragment.startsWith(candidate))
      if (prefix) {
        operator = prefix
        fragment = fragment.slice(prefix.length)
      }
    }
    if (!VERSION.test(fragment)) return null
    tokens.push({ operator, version: fragment })
    if (tokens.length > MAX_DSH_RANGE_TOKENS) return null
  }
  return tokens
}

function parseDshRange(value) {
  if (typeof value !== 'string' || value.length > MAX_DSH_RANGE_LENGTH) return null
  const normalized = value.trim()
  if (normalized === '' || normalized.toLowerCase() === 'unknown') return null
  const clauses = normalized.split('||').map(clause => clause.trim()).filter(Boolean)
  if (clauses.length > MAX_DSH_RANGE_CLAUSES) return null
  const parsedClauses = clauses.map(parseDshRangeClause)
  if (parsedClauses.length === 0 || parsedClauses.some(clause => clause === null)) return null
  return parsedClauses
}

export function dshVersionCompatibility(value, version) {
  if (!VERSION.test(version ?? '')) return 'unknown'
  const parsedClauses = parseDshRange(value)
  if (parsedClauses === null) return 'unknown'
  const satisfiesToken = (version, token) => {
    const comparison = compareVersions(version, token.version)
    if (comparison === null) return false
    if (token.operator === '>=') return comparison >= 0
    if (token.operator === '<=') return comparison <= 0
    if (token.operator === '>') return comparison > 0
    if (token.operator === '<') return comparison < 0
    if (token.operator === '^') {
      const target = parseVersion(token.version)
      const candidate = parseVersion(version)
      if (!target || !candidate || comparison < 0) return false
      return target.major === 0
        ? candidate.major === 0 && candidate.minor === target.minor
        : candidate.major === target.major
    }
    if (token.operator === '~') {
      const target = parseVersion(token.version)
      const candidate = parseVersion(version)
      return Boolean(target && candidate && comparison >= 0
        && candidate.major === target.major && candidate.minor === target.minor)
    }
    return comparison === 0
  }
  return parsedClauses.some(clause => clause.every(token => satisfiesToken(version, token)))
    ? 'compatible'
    : 'incompatible'
}

export function dshReleaseVersion(release) {
  if (Object.hasOwn(DSH_RC_VERSIONS, release)) return DSH_RC_VERSIONS[release]
  return VERSION.test(release ?? '') ? release : null
}

export function dshReleaseCompatibility(value, releases = DSH_RC_RELEASES) {
  const result = {}
  for (const release of releases) {
    const version = dshReleaseVersion(release)
    result[release] = version === null ? 'unknown' : dshVersionCompatibility(value, version)
  }
  return result
}

function declaredDshReleaseCompatibility(value, dshRange, label) {
  if (value === undefined) return dshReleaseCompatibility(dshRange)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}.dshReleases must be an object`)
  const releases = Object.keys(value)
  if (releases.length > MAX_DSH_RELEASE_KEYS) throw new TypeError(`${label}.dshReleases contains too many release keys`)
  const normalized = {}
  const byVersion = new Map()
  for (const release of releases) {
    const version = dshReleaseVersion(release)
    if (version === null) throw new TypeError(`${label}.dshReleases.${release} is not a supported DSH release key`)
    const status = value[release]
    if (!['compatible', 'incompatible', 'unknown'].includes(status)) {
      throw new TypeError(`${label}.dshReleases.${release} must be compatible, incompatible, or unknown`)
    }
    if (byVersion.has(version) && byVersion.get(version) !== status) {
      throw new TypeError(`${label}.dshReleases declares conflicting aliases for ${version}`)
    }
    byVersion.set(version, status)
    normalized[release] = status
  }
  return normalized
}

function declaredDshOperations(value, label) {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new TypeError(`${label}.dshOperations must be an object`)
  }
  const releases = [...new Set([...DSH_RC_RELEASES, ...Object.keys(value ?? {})])]
  if (releases.length > MAX_DSH_RELEASE_KEYS) throw new TypeError(`${label}.dshOperations contains too many release keys`)
  const normalized = {}
  const byVersion = new Map()
  for (const release of releases) {
    const version = dshReleaseVersion(release)
    if (version === null) throw new TypeError(`${label}.dshOperations.${release} is not a supported DSH release key`)
    const record = value?.[release]
    if (record !== undefined && (!record || typeof record !== 'object' || Array.isArray(record))) {
      throw new TypeError(`${label}.dshOperations.${release} must be an object`)
    }
    normalized[release] = {}
    for (const operation of DSH_OPERATIONS) {
      const status = record?.[operation] ?? 'unknown'
      if (!['passed', 'failed', 'unknown'].includes(status)) {
        throw new TypeError(`${label}.dshOperations.${release}.${operation} must be passed, failed, or unknown`)
      }
      normalized[release][operation] = status
    }
    const fingerprint = JSON.stringify(normalized[release])
    if (byVersion.has(version) && byVersion.get(version) !== fingerprint) {
      throw new TypeError(`${label}.dshOperations declares conflicting aliases for ${version}`)
    }
    byVersion.set(version, fingerprint)
  }
  return normalized
}

function isoDateOrNull(value, label) {
  if (value === undefined || value === null) return null
  const text = nonEmptyString(value, label, 80)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(Date.parse(text))) throw new TypeError(`${label} must be an ISO date-time`)
  return new Date(text).toISOString()
}

function httpsUrlOrNull(value, label) {
  if (value === undefined || value === null) return null
  const text = nonEmptyString(value, label, 400)
  const url = new URL(text)
  if (url.protocol !== 'https:') throw new TypeError(`${label} must use https`)
  return url.href
}

function sourceMetadata(value, label) {
  if (value === undefined || value === null) return { updatedAt: null, observedAt: null, provenance: 'unknown' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}.source must be an object`)
  return {
    updatedAt: isoDateOrNull(value.updatedAt, `${label}.source.updatedAt`),
    observedAt: isoDateOrNull(value.observedAt, `${label}.source.observedAt`),
    provenance: enumValue(value.provenance, `${label}.source.provenance`, ['github-commit', 'github-repository', 'unknown']),
  }
}

function evidenceRecord(value, label, fallback) {
  if (value === undefined || value === null) return { ...fallback }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  const wireStatus = enumValue(value.status, `${label}.status`, ['verified', 'partial', 'failed', 'unknown', 'not-applicable'])
  const evidenceStatus = value.evidenceStatus === undefined || value.evidenceStatus === null
    ? null
    : enumValue(value.evidenceStatus, `${label}.evidenceStatus`, ['partial'])
  if (evidenceStatus !== null && wireStatus !== 'unknown') {
    throw new TypeError(`${label}.evidenceStatus requires the legacy wire status unknown`)
  }
  const status = evidenceStatus ?? wireStatus
  const record = {
    status,
    method: value.method === undefined || value.method === null ? null : nonEmptyString(value.method, `${label}.method`, 120),
    checkedAt: isoDateOrNull(value.checkedAt, `${label}.checkedAt`),
    evidenceUrl: httpsUrlOrNull(value.evidenceUrl, `${label}.evidenceUrl`),
    dshRelease: value.dshRelease === undefined || value.dshRelease === null
      ? null
      : (() => {
          const release = nonEmptyString(value.dshRelease, `${label}.dshRelease`, 80)
          if (dshReleaseVersion(release) === null) throw new TypeError(`${label}.dshRelease is not a supported DSH release key`)
          return release
        })(),
    systems: stringArray(value.systems ?? [], `${label}.systems`),
    profiles: stringArray(value.profiles ?? [], `${label}.profiles`),
    summary: value.summary === undefined || value.summary === null ? null : nonEmptyString(value.summary, `${label}.summary`, 600),
  }
  if (['verified', 'partial'].includes(status) && (!record.method || !record.checkedAt || !record.evidenceUrl)) {
    throw new TypeError(`${label} ${status} evidence requires method, checkedAt, and evidenceUrl`)
  }
  return record
}

function assuranceEvidence(value, label, catalogUpdatedAt) {
  if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    throw new TypeError(`${label}.assurance must be an object`)
  }
  return {
    discovery: evidenceRecord(value?.discovery, `${label}.assurance.discovery`, {
      status: 'verified', method: 'catalog-presence', checkedAt: catalogUpdatedAt, evidenceUrl: DEFAULT_CATALOG_URL,
      dshRelease: null, systems: [], profiles: [], summary: 'Present in the trusted GitHub catalog.',
    }),
    installability: evidenceRecord(value?.installability, `${label}.assurance.installability`, {
      status: 'unknown', method: null, checkedAt: null, evidenceUrl: null, dshRelease: null, systems: [], profiles: [], summary: null,
    }),
    runtime: evidenceRecord(value?.runtime, `${label}.assurance.runtime`, {
      status: 'unknown', method: null, checkedAt: null, evidenceUrl: null, dshRelease: null, systems: [], profiles: [], summary: null,
    }),
    securityReview: evidenceRecord(value?.securityReview, `${label}.assurance.securityReview`, {
      status: 'unknown', method: null, checkedAt: null, evidenceUrl: null, dshRelease: null, systems: [], profiles: [], summary: null,
    }),
  }
}

export function assertLegacyCatalogCompatibility(document) {
  if (!document || typeof document !== 'object' || !Array.isArray(document.entries)) {
    throw new TypeError('legacy Catalog compatibility requires a Catalog document')
  }
  for (const [entryIndex, entry] of document.entries.entries()) {
    const assurance = entry?.assurance
    if (assurance === undefined || assurance === null) continue
    if (typeof assurance !== 'object' || Array.isArray(assurance)) {
      throw new TypeError(`entries[${entryIndex}].assurance must be an object`)
    }
    for (const [gate, record] of Object.entries(assurance)) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue
      if (record.status === 'partial') {
        throw new TypeError(`entries[${entryIndex}].assurance.${gate} uses a wire status unsupported by 0.8.2`)
      }
      if (record.evidenceStatus !== undefined
        && (record.evidenceStatus !== 'partial' || record.status !== 'unknown')) {
        throw new TypeError(`entries[${entryIndex}].assurance.${gate} has an invalid legacy evidence bridge`)
      }
    }
  }
  return true
}

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
  const installPath = entry.installPath ? `&path:${entry.installPath}` : ''
  return `git+${repository}.git#${entry.commit}${installPath}`
}

function rawGithubUrl(entry, path) {
  const repository = canonicalGithubRepository(entry.repositoryUrl)
  const [, owner, repo] = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(repository)
  return `https://raw.githubusercontent.com/${owner}/${repo}/${entry.commit}/${path}`
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function retryableTransportError(error) {
  if (error?.catalogInvalid === true) return false
  if (typeof error?.retryable === 'boolean') return error.retryable
  return error?.name === 'AbortError' || error instanceof TypeError
}

function sourceError(code, message) {
  return Object.assign(new Error(message), { code })
}

function finalSourceTransportError(error) {
  if (error?.name === 'AbortError') {
    return sourceError('SOURCE_VERIFICATION_TIMEOUT', 'GitHub fixed-commit source verification timed out; retry the operation')
  }
  if (Number.isInteger(error?.status)) {
    return sourceError('SOURCE_VERIFICATION_HTTP', `GitHub fixed-commit source returned HTTP ${error.status}`)
  }
  return sourceError('SOURCE_VERIFICATION_NETWORK', 'GitHub fixed-commit source is temporarily unavailable; retry the operation')
}

async function fetchPinnedTextWithRetries(url, request, timeoutMs, maxBytes, retryDelaysMs) {
  let lastError
  const delays = Array.isArray(retryDelaysMs) ? retryDelaysMs : DEFAULT_RETRY_DELAYS_MS
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await request(url, {
        headers: { accept: 'application/vnd.github.raw+json', 'user-agent': 'dsh-safe-plugin-manager' },
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = new Error(`GitHub source returned HTTP ${response.status}`)
        error.status = response.status
        error.retryable = response.status === 429 || response.status >= 500
        throw error
      }
      const text = await response.text()
      if (Buffer.byteLength(text) > maxBytes) throw new Error('GitHub source file is too large')
      return text
    } catch (error) {
      lastError = error
      if (!retryableTransportError(error) || attempt === delays.length) {
        throw finalSourceTransportError(error)
      }
      await wait(delays[attempt])
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
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const manifestUrl = rawGithubUrl(entry, entry.manifestPath)
  let manifest
  try {
    manifest = JSON.parse(await fetchPinnedTextWithRetries(
      manifestUrl, request, timeoutMs, 512 * 1024, retryDelaysMs,
    ))
  } catch (error) {
    if (typeof error?.code === 'string') throw error
    throw sourceError('SOURCE_MANIFEST_INVALID', 'GitHub fixed-commit manifest is not valid JSON')
  }
  if (manifest.name !== entry.packageName) {
    throw sourceError('SOURCE_MANIFEST_MISMATCH', 'GitHub manifest package name does not match the registry')
  }
  if (manifest.version !== entry.version) {
    throw sourceError('SOURCE_MANIFEST_MISMATCH', 'GitHub manifest version does not match the registry')
  }
  const manifestLicense = typeof manifest.license === 'string' && manifest.license.trim() !== ''
    ? manifest.license.trim()
    : null
  if (manifestLicense !== null && manifestLicense !== entry.details.license) {
    throw sourceError('SOURCE_MANIFEST_MISMATCH', 'GitHub manifest license does not match the registry')
  }
  const patchRelative = manifest?.dsh?.bundle?.patch
  if (typeof patchRelative !== 'string' || patchRelative.trim() === '' || patchRelative.includes('..') || patchRelative.startsWith('/')) {
    throw sourceError('SOURCE_MANIFEST_MISMATCH', 'GitHub manifest does not declare a safe dsh.bundle.patch')
  }
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare'].filter(name => typeof manifest.scripts?.[name] === 'string')
  if (JSON.stringify(lifecycle.sort()) !== JSON.stringify([...entry.risk.installScripts].sort())) {
    throw sourceError('SOURCE_MANIFEST_MISMATCH', 'GitHub lifecycle scripts do not match the registry risk declaration')
  }
  const base = entry.manifestPath.includes('/') ? entry.manifestPath.slice(0, entry.manifestPath.lastIndexOf('/') + 1) : ''
  const patchPath = `${base}${patchRelative.replace(/^\.\//, '')}`
  const patchUrl = rawGithubUrl(entry, patchPath)
  const patch = await fetchPinnedTextWithRetries(patchUrl, request, timeoutMs, 512 * 1024, retryDelaysMs)
  for (const protectedId of ['ui-settings-plugin-inventory', 'dsh-safe-plugin-manager']) {
    const pattern = new RegExp(`(?:^|\\n)- id: ['\"]?${protectedId}['\"]?[\\s\\S]{0,160}?disabled:\\s*true`, 'i')
    if (pattern.test(patch)) {
      throw sourceError('SOURCE_PATCH_REJECTED', `GitHub Bundle Patch disables protected entry ${protectedId}`)
    }
  }
  if (/@deepseek-ai\//.test(patch) && /disabled:\s*true/.test(patch)) {
    throw sourceError('SOURCE_PATCH_REJECTED', 'GitHub Bundle Patch appears to disable an official package')
  }
  for (const id of entry.entryIds) {
    const pattern = new RegExp(`(?:^|\\n)\\s*- id: ['\"]?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]?\\s*(?:\\n|$)`)
    if (!pattern.test(patch)) {
      throw sourceError('SOURCE_PATCH_MISMATCH', `GitHub Bundle Patch does not declare registry entry id ${id}`)
    }
  }
  return {
    status: 'verified', verifiedAt: new Date().toISOString(), manifestUrl, patchUrl,
    packageName: manifest.name, version: manifest.version,
    license: manifestLicense ?? entry.details.license, installScripts: lifecycle,
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

function enumValue(value, label, allowed, fallback = 'unknown') {
  const candidate = value === undefined || value === null ? fallback : value
  if (typeof candidate !== 'string' || !allowed.includes(candidate)) {
    throw new TypeError(`${label} must be one of ${allowed.join(', ')}`)
  }
  return candidate
}

function enumArray(value, label, allowed, fallback = [], minimum = 0) {
  const items = stringArray(value ?? fallback, label, { simple: true })
  if (items.some(item => !allowed.includes(item))) {
    throw new TypeError(`${label} contains an unsupported value`)
  }
  if (items.length < minimum) throw new TypeError(`${label} must contain at least ${minimum} value`)
  return items
}

function validateEntry(value, index, catalogUpdatedAt) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`entries[${index}] must be an object`)
  }
  if (!value.compatibility || typeof value.compatibility !== 'object' || Array.isArray(value.compatibility)) {
    throw new TypeError(`entries[${index}].compatibility must be an object`)
  }
  if (!value.details || typeof value.details !== 'object' || Array.isArray(value.details)) {
    throw new TypeError(`entries[${index}].details must be an object`)
  }
  if (!value.details.permissions || typeof value.details.permissions !== 'object' || Array.isArray(value.details.permissions)) {
    throw new TypeError(`entries[${index}].details.permissions must be an object`)
  }
  for (const field of ['dsh', 'node', 'systems', 'profiles']) {
    if (!Object.hasOwn(value.compatibility, field)) throw new TypeError(`entries[${index}].compatibility.${field} is required`)
  }
  for (const field of ['pluginType', 'installSource', 'license', 'permissions', 'externalDependencies', 'reviewStatus']) {
    if (!Object.hasOwn(value.details, field)) throw new TypeError(`entries[${index}].details.${field} is required`)
  }
  for (const field of ['level', 'files', 'network', 'commands', 'credentials']) {
    if (!Object.hasOwn(value.details.permissions, field)) throw new TypeError(`entries[${index}].details.permissions.${field} is required`)
  }
  const id = nonEmptyString(value.id, `entries[${index}].id`, 96)
  if (!SIMPLE_ID.test(id)) throw new TypeError(`entries[${index}].id is invalid`)
  const packageName = nonEmptyString(value.packageName, `entries[${index}].packageName`, 214)
  if (!PACKAGE_NAME.test(packageName) || packageName.includes('..')) {
    throw new TypeError(`entries[${index}].packageName is invalid`)
  }
  const status = ['approved', 'blocked', 'unlisted'].includes(value.status) ? value.status : null
  if (status === null) throw new TypeError(`entries[${index}].status must be approved, blocked, or unlisted`)
  const commit = nonEmptyString(value.commit, `entries[${index}].commit`, 40).toLowerCase()
  if (!COMMIT_SHA.test(commit)) throw new TypeError(`entries[${index}].commit must be a full Git commit SHA`)
  const version = nonEmptyString(value.version, `entries[${index}].version`, 80)
  if (!VERSION.test(version)) throw new TypeError(`entries[${index}].version must be semantic version text`)
  const manifestPath = nonEmptyString(value.manifestPath ?? 'package.json', `entries[${index}].manifestPath`, 160)
  if (manifestPath.startsWith('/') || manifestPath.includes('..') || manifestPath.includes('\\')) {
    throw new TypeError(`entries[${index}].manifestPath must stay inside the repository`)
  }
  const installPath = value.installPath === undefined || value.installPath === null
    ? null
    : nonEmptyString(value.installPath, `entries[${index}].installPath`, 160).replace(/^\/+|\/+$/g, '')
  if (installPath && (installPath.includes('..') || installPath.includes('\\'))) {
    throw new TypeError(`entries[${index}].installPath must stay inside the repository`)
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
    searchTerms: stringArray(value.searchTerms ?? [], `entries[${index}].searchTerms`, { max: 120 }).slice(0, 40),
    repositoryUrl: canonicalGithubRepository(value.repositoryUrl),
    defaultBranch: nonEmptyString(value.defaultBranch ?? 'main', `entries[${index}].defaultBranch`, 120),
    manifestPath,
    installPath,
    updatePolicy: value.updatePolicy === undefined || value.updatePolicy === null
      ? null
      : enumValue(value.updatePolicy, `entries[${index}].updatePolicy`, ['source-verified', 'user-reviewed', 'external-only']),
    commit,
    version,
    categories: stringArray(value.categories ?? [], `entries[${index}].categories`, { simple: true }),
    featured: value.featured === true,
    installCount: Number.isSafeInteger(value.installCount) && value.installCount >= 0 ? value.installCount : null,
    source: sourceMetadata(value.source, `entries[${index}]`),
    assurance: assuranceEvidence(value.assurance, `entries[${index}]`, catalogUpdatedAt),
    entryIds,
    status,
    statusReason: status === 'blocked' || status === 'unlisted'
      ? nonEmptyString(value.statusReason, `entries[${index}].statusReason`, 600)
      : null,
    compatibility: {
      dsh: typeof value.compatibility?.dsh === 'string' ? value.compatibility.dsh.slice(0, 120) : null,
      dshReleases: declaredDshReleaseCompatibility(value.compatibility?.dshReleases, value.compatibility?.dsh, `entries[${index}].compatibility`),
      dshOperations: declaredDshOperations(value.compatibility?.dshOperations, `entries[${index}].compatibility`),
      node: typeof value.compatibility?.node === 'string' ? value.compatibility.node.slice(0, 120) : null,
      systems: stringArray(value.compatibility?.systems ?? [], `entries[${index}].compatibility.systems`),
      profiles: stringArray(value.compatibility?.profiles ?? [], `entries[${index}].compatibility.profiles`),
    },
    details: {
      pluginType: enumValue(value.details?.pluginType, `entries[${index}].details.pluginType`, [
        'feature', 'theme', 'suite', 'client', 'provider', 'unknown',
      ]),
      installSource: enumValue(value.details?.installSource, `entries[${index}].details.installSource`, [
        'npm', 'github', 'local-bundle', 'unknown',
      ]),
      license: typeof value.details?.license === 'string' && value.details.license.trim() !== ''
        ? value.details.license.trim().slice(0, 120)
        : 'UNKNOWN',
      permissions: {
        level: enumValue(value.details?.permissions?.level, `entries[${index}].details.permissions.level`, [
          'low', 'medium', 'high', 'unknown',
        ]),
        files: enumValue(value.details?.permissions?.files, `entries[${index}].details.permissions.files`, [
          'none', 'read-only', 'write', 'unknown',
        ]),
        network: enumValue(value.details?.permissions?.network, `entries[${index}].details.permissions.network`, [
          'none', 'specified-services', 'any', 'unknown',
        ]),
        commands: enumValue(value.details?.permissions?.commands, `entries[${index}].details.permissions.commands`, [
          'none', 'restricted', 'shell', 'unknown',
        ]),
        credentials: enumArray(value.details?.permissions?.credentials, `entries[${index}].details.permissions.credentials`, [
          'none', 'api-key', 'oauth', 'keychain', 'unknown',
        ], ['unknown'], 1),
      },
      externalDependencies: stringArray(
        value.details?.externalDependencies ?? [], `entries[${index}].details.externalDependencies`, { max: 160 },
      ),
      reviewStatus: enumValue(value.details?.reviewStatus, `entries[${index}].details.reviewStatus`, [
        'unreviewed', 'automated-scan', 'manual-review', 'author-verified',
      ], 'unreviewed'),
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
  const trustPolicy = document.registry.trustPolicy
  if (trustPolicy?.candidateInstallDisabled !== true || trustPolicy?.unknownIsNotVerified !== true
    || trustPolicy?.promotionIndependentOfVerification !== true) {
    throw new TypeError('catalog registry trustPolicy must fail closed')
  }
  const categories = document.registry.categories && typeof document.registry.categories === 'object'
    ? Object.fromEntries(Object.entries(document.registry.categories).map(([key, label]) => {
        const id = nonEmptyString(key, 'registry.categories key', 96)
        if (!SIMPLE_ID.test(id)) throw new TypeError(`registry category id ${id} is invalid`)
        return [id, nonEmptyString(label, `registry.categories.${key}`, 120)]
      }))
    : {}
  const registryUpdatedAt = isoDateOrNull(document.registry.updatedAt, 'registry.updatedAt')
  if (!registryUpdatedAt) throw new TypeError('registry.updatedAt must be an ISO date-time')
  const entries = document.entries.map((entry, index) => validateEntry(entry, index, registryUpdatedAt))
  const ids = new Set()
  const packages = new Set()
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new TypeError(`duplicate catalog id ${entry.id}`)
    if (packages.has(entry.packageName)) throw new TypeError(`duplicate catalog package ${entry.packageName}`)
    if (entry.categories.length === 0) throw new TypeError(`catalog entry ${entry.id} must declare at least one category`)
    for (const category of entry.categories) {
      if (!Object.hasOwn(categories, category)) throw new TypeError(`catalog entry ${entry.id} uses unknown category ${category}`)
    }
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
      installCountsUrl: typeof document.registry.installCountsUrl === 'string'
        ? new URL(document.registry.installCountsUrl).href
        : null,
      updatedAt: registryUpdatedAt,
      sourceUpdates: {
        mode: document.registry.sourceUpdates?.mode === 'client-on-demand' ? 'client-on-demand' : 'client-on-demand',
        defaultPolicy: document.registry.sourceUpdates?.defaultPolicy === 'risk-derived' ? 'risk-derived' : 'risk-derived',
      },
      trustPolicy: {
        candidateInstallDisabled: true,
        unknownIsNotVerified: true,
        promotionIndependentOfVerification: true,
      },
      categories,
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

function unknownDshOperations() {
  return Object.fromEntries(DSH_OPERATIONS.map(operation => [operation, 'unknown']))
}

function addReleaseRecord(byVersion, release) {
  const version = dshReleaseVersion(release)
  if (version === null) return
  const current = byVersion.get(version)
  if (current) {
    current.aliases.add(release)
    if (VERSION.test(release)) current.key = release
    return
  }
  byVersion.set(version, { key: release, version, aliases: new Set([release]) })
}

export function createDshReleaseContext(entries = [], dshVersion = {}) {
  const byVersion = new Map()
  for (const release of DSH_RC_RELEASES) addReleaseRecord(byVersion, release)
  for (const entry of entries) {
    for (const release of Object.keys(entry?.compatibility?.dshReleases ?? {})) addReleaseRecord(byVersion, release)
    for (const release of Object.keys(entry?.compatibility?.dshOperations ?? {})) addReleaseRecord(byVersion, release)
  }
  const npmLatest = VERSION.test(dshVersion?.latestVersion ?? '') ? dshVersion.latestVersion : null
  if (npmLatest) addReleaseRecord(byVersion, npmLatest)
  const allReleases = [...byVersion.values()]
    .sort((left, right) => compareVersions(left.version, right.version) ?? left.version.localeCompare(right.version, 'en'))
  const officialLatestIndex = npmLatest ? allReleases.findIndex(release => release.version === npmLatest) : -1
  const boundedReleases = officialLatestIndex >= 0
    ? allReleases.slice(Math.max(0, officialLatestIndex - MAX_DSH_RELEASE_KEYS + 1), officialLatestIndex + 1)
    : allReleases.slice(-MAX_DSH_RELEASE_KEYS)
  const fallbackLatest = boundedReleases.at(-1)?.version ?? null
  const latestVersion = npmLatest ?? fallbackLatest
  const releases = boundedReleases.map(release => ({
    key: release.key,
    version: release.version,
    label: release.version,
    aliases: [...release.aliases].sort(),
    latest: release.version === latestVersion,
  }))
  const latestIndex = Math.max(0, releases.findIndex(release => release.latest))
  return {
    schemaVersion: 1,
    source: npmLatest ? 'npm-official' : 'catalog-fallback',
    latestVersion,
    checkedAt: npmLatest && typeof dshVersion.checkedAt === 'string' ? dshVersion.checkedAt : null,
    registryUrl: npmLatest && typeof dshVersion.registryUrl === 'string' ? dshVersion.registryUrl : null,
    errorCode: npmLatest ? null : (dshVersion?.errorCode ?? null),
    releases,
    cardReleases: releases.slice(Math.max(0, latestIndex - 2), latestIndex + 1),
  }
}

export function projectDshRelease(entry, release) {
  const compatibility = entry?.compatibility ?? {}
  const releaseKeys = [...new Set([release?.key, ...(release?.aliases ?? [])].filter(Boolean))]
  const declaredKey = releaseKeys.find(key => Object.hasOwn(compatibility.dshReleases ?? {}, key)) ?? null
  const declaredStatus = declaredKey === null ? null : compatibility.dshReleases[declaredKey]
  const rangeStatus = dshVersionCompatibility(compatibility.dsh, release?.version)
  const basis = declaredKey === null ? (rangeStatus === 'unknown' ? 'unknown' : 'range') : 'catalog'
  const status = declaredKey === null
    ? rangeStatus === 'incompatible' ? 'incompatible' : 'unknown'
    : declaredStatus
  const operationKey = releaseKeys.find(key => Object.hasOwn(compatibility.dshOperations ?? {}, key)) ?? null
  return {
    key: release?.key ?? null,
    version: release?.version ?? null,
    label: release?.label ?? release?.version ?? release?.key ?? 'unknown',
    latest: release?.latest === true,
    status: ['compatible', 'incompatible', 'unknown'].includes(status) ? status : 'unknown',
    basis,
    rangeStatus,
    declaredKey,
    operations: { ...unknownDshOperations(), ...(operationKey ? compatibility.dshOperations[operationKey] : {}) },
  }
}

function withDshReleaseViews(entry, releaseContext) {
  return {
    ...entry,
    compatibility: {
      ...entry.compatibility,
      dshReleaseViews: releaseContext.releases.map(release => projectDshRelease(entry, release)),
    },
  }
}

function compatibilityRank(entry, releaseContext) {
  const latest = releaseContext.releases.find(release => release.latest) ?? releaseContext.releases.at(-1)
  if (!latest) return 2
  const view = entry.compatibility?.dshReleaseViews?.find(item => item.version === latest.version)
    ?? projectDshRelease(entry, latest)
  if (view.basis === 'catalog' && view.status === 'compatible') return 0
  if (view.basis === 'range' && view.rangeStatus === 'compatible') return 1
  if (view.status === 'unknown') return 2
  return 3
}

export function compareCatalogEntries(left, right, options = {}) {
  const releaseContext = options?.releaseContext ?? createDshReleaseContext([], options?.dshVersion)
  const statusRank = entry => ({ approved: 0, blocked: 1, unlisted: 2 }[entry.status] ?? 2)
  const freshness = entry => Date.parse(entry.source?.updatedAt ?? entry.github?.pushedAt ?? entry.github?.updatedAt ?? '') || 0
  return statusRank(left) - statusRank(right)
    || Number(right.featured === true) - Number(left.featured === true)
    || compatibilityRank(left, releaseContext) - compatibilityRank(right, releaseContext)
    || freshness(right) - freshness(left)
    || (right.installCount ?? -1) - (left.installCount ?? -1)
    || (compareVersions(right.version, left.version) ?? 0)
    || left.name.localeCompare(right.name, 'zh-CN')
}

export function searchCatalog(catalog, query = '', options = {}) {
  const needle = String(query).trim().toLowerCase()
  const category = String(options.category ?? '').trim().toLowerCase()
  const releaseContext = options.releaseContext ?? createDshReleaseContext(catalog.entries, options.dshVersion)
  return catalog.entries
    .filter(entry => options.includeUnlisted === true || entry.status !== 'unlisted')
    .filter(entry => category === '' || entry.categories.includes(category))
    .filter(entry => needle === '' || [
      entry.id, entry.name, entry.packageName, entry.description,
      ...(entry.searchTerms ?? []),
      entry.repositoryUrl, entry.details?.pluginType ?? '', entry.details?.installSource ?? '', entry.details?.license ?? '',
      entry.details?.permissions?.level ?? '', entry.details?.permissions?.files ?? '', entry.details?.permissions?.network ?? '',
      entry.details?.permissions?.commands ?? '', ...(entry.details?.permissions?.credentials ?? []),
      ...(entry.details?.externalDependencies ?? []), ...(entry.compatibility?.systems ?? []), ...(entry.compatibility?.profiles ?? []),
      entry.compatibility?.dsh ?? '', ...Object.entries(entry.compatibility?.dshReleases ?? {}).flat(),
      ...entry.categories,
    ].some(value => value.toLowerCase().includes(needle)))
    .sort((left, right) => compareCatalogEntries(left, right, { releaseContext }))
}

export function buildMarketplaceSnapshot(catalog, inventory, query = '', options = {}) {
  const installedByName = new Map(inventory.plugins.map(plugin => [plugin.packageName, plugin]))
  const managedPackages = options.managedPackages instanceof Set ? options.managedPackages : new Set()
  const releaseContext = createDshReleaseContext(catalog.entries, options.dshVersion)
  const entries = searchCatalog(catalog, query, { includeUnlisted: true, releaseContext }).map(sourceEntry => {
    const entry = withDshReleaseViews(sourceEntry, releaseContext)
    const installed = installedByName.get(entry.packageName) ?? null
    const versionComparison = installed?.version ? compareVersions(installed.version, entry.version) : null
    const localProtected = ['link', 'file', 'workspace'].includes(installed?.source)
    const commitMatched = installed?.source === 'git'
      && typeof installed.declaredSpecifier === 'string'
      && installed.declaredSpecifier.toLowerCase().includes(entry.commit)
    const commitDrift = installed?.source === 'git' && !commitMatched
    const updateAvailable = installed !== null
      && (versionComparison === -1 || (commitDrift && versionComparison !== 1))
    const migrationAvailable = localProtected && entry.status === 'approved' && !installed?.official
    const self = entry.packageName === 'dsh-safe-plugin-manager'
    let managementBlockedReason = null
    if (entry.status === 'blocked') managementBlockedReason = entry.statusReason
    else if (entry.status === 'unlisted' && installed === null) managementBlockedReason = entry.statusReason
    else if (installed?.official) managementBlockedReason = '官方组件永久只读'
    const allowedActions = []
    if (managementBlockedReason === null) {
      if (migrationAvailable) allowedActions.push('migrate')
      else {
        if (installed === null && entry.status === 'approved' && !self) allowedActions.push('install')
        if (installed !== null && entry.status === 'approved' && updateAvailable) allowedActions.push('update')
        if (installed !== null && !self) allowedActions.push('disable', 'enable', 'uninstall')
      }
    }
    if (self && allowedActions.length === 0 && managementBlockedReason === null) {
      managementBlockedReason = '管理器自身仅允许更新，禁止停用或卸载'
    }
    const installOrigin = installed === null ? null
      : managedPackages.has(entry.packageName) ? 'marketplace-managed'
      : localProtected ? 'local-development'
      : commitMatched ? 'catalog-source-matched'
      : 'external-or-drifted'
    return {
      ...entry,
      listed: entry.status !== 'unlisted',
      installed: installed !== null,
      installedVersion: installed?.version ?? null,
      installedSource: installed?.source ?? null,
      updateAvailable,
      migrationAvailable,
      commitMatched,
      sourceDrift: commitDrift,
      versionState: versionComparison === null ? 'unknown' : versionComparison < 0 ? 'behind' : versionComparison > 0 ? 'ahead' : 'equal',
      installOrigin,
      allowedActions,
      manageable: allowedActions.length > 0,
      managementBlockedReason,
    }
  })
  const candidateEntries = Array.isArray(options.candidateRegistry?.entries) ? options.candidateRegistry.entries : []
  const candidateSummary = candidateEntries.reduce((summary, entry) => {
    const status = ['discovered', 'reviewing', 'rejected'].includes(entry?.status) ? entry.status : 'unknown'
    summary.total += 1
    summary[status] += 1
    return summary
  }, { total: 0, discovered: 0, reviewing: 0, rejected: 0, unknown: 0 })
  candidateSummary.reviewable = candidateSummary.discovered + candidateSummary.reviewing
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profile: inventory.profile,
    registry: catalog.registry,
    source: catalog.source,
    trustPolicy: catalog.registry.trustPolicy,
    candidateRegistry: options.candidateRegistry?.registry ?? null,
    candidateSource: options.candidateRegistry?.source ?? null,
    dshReleaseContext: releaseContext,
    candidates: candidateEntries,
    candidateSummary,
    entries,
  }
}

function marketplaceSearchValues(entry) {
  return [
    entry.id, entry.name, entry.packageName, entry.description, entry.repositoryUrl,
    ...(entry.searchTerms ?? []),
    entry.details?.pluginType, entry.details?.installSource, entry.details?.license,
    entry.details?.permissions?.level, entry.details?.permissions?.files,
    entry.details?.permissions?.network, entry.details?.permissions?.commands,
    ...(entry.details?.permissions?.credentials ?? []), ...(entry.details?.externalDependencies ?? []),
    ...(entry.compatibility?.systems ?? []), ...(entry.compatibility?.profiles ?? []),
    entry.compatibility?.dsh, ...Object.entries(entry.compatibility?.dshReleases ?? {}).flat(),
    ...(entry.categories ?? []),
  ].map(item => String(item ?? '').toLowerCase())
}

function candidateSearchValues(entry) {
  return [
    entry.id, entry.name, entry.description, entry.repositoryUrl, entry.route,
    ...(entry.discoverySources ?? []), ...(entry.topics ?? []),
  ].map(item => String(item ?? '').toLowerCase())
}

function positiveInteger(value, fallback, maximum, label) {
  if (value === undefined || value === null || value === '') return fallback
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw Object.assign(new TypeError(`${label} must be an integer between 1 and ${maximum}`), { code: 'INVALID_PAGINATION', status: 400 })
  }
  return value
}

export function paginateMarketplaceSnapshot(snapshot, options = {}) {
  if (!snapshot || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.candidates)) {
    throw new TypeError('marketplace snapshot is invalid')
  }
  const view = options.view ?? 'market'
  if (!['market', 'installed', 'candidates'].includes(view)) {
    throw Object.assign(new TypeError('view must be market, installed, or candidates'), { code: 'INVALID_MARKET_VIEW', status: 400 })
  }
  const query = String(options.query ?? '').trim().toLowerCase()
  const category = String(options.category ?? '').trim().toLowerCase()
  if (query.length > 200) throw Object.assign(new TypeError('query is too long'), { code: 'INVALID_MARKET_QUERY', status: 400 })
  if (category.length > 96 || (category && !SIMPLE_ID.test(category))) {
    throw Object.assign(new TypeError('category is invalid'), { code: 'INVALID_MARKET_CATEGORY', status: 400 })
  }
  const requestedPage = positiveInteger(options.page, 1, 10_000, 'page')
  const pageSize = positiveInteger(options.pageSize, MARKET_PAGE_SIZE, MAX_MARKET_PAGE_SIZE, 'pageSize')
  const includeRejectedCandidates = options.includeRejected === true
  const scopedEntries = snapshot.entries.filter(entry => view === 'installed' ? entry.installed : entry.listed !== false)
  const categoryIds = [...new Set(scopedEntries.flatMap(entry => entry.categories ?? []))].sort()
  const featuredOnly = options.featuredOnly === true
  const matchingEntries = scopedEntries
    .filter(entry => !featuredOnly || entry.featured === true)
    .filter(entry => category === '' || entry.categories?.includes(category))
    .filter(entry => query === '' || marketplaceSearchValues(entry).some(item => item.includes(query)))
  const matchingCandidates = view === 'candidates'
    ? snapshot.candidates
      .filter(entry => includeRejectedCandidates || entry.status !== 'rejected')
      .filter(entry => query === '' || candidateSearchValues(entry).some(item => item.includes(query)))
      .sort((left, right) => (Date.parse(right.sourceUpdatedAt || right.discoveredAt) || 0)
        - (Date.parse(left.sourceUpdatedAt || left.discoveredAt) || 0)
        || String(left.name).localeCompare(String(right.name), 'zh-CN'))
    : []
  const matching = view === 'candidates' ? matchingCandidates : matchingEntries
  const total = matching.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, pageCount)
  const pageItems = matching.slice((page - 1) * pageSize, page * pageSize)
  return {
    ...snapshot,
    entries: view === 'candidates' ? [] : pageItems,
    candidates: view === 'candidates' ? pageItems : [],
    catalogPackageNames: snapshot.entries.map(entry => entry.packageName),
    filters: { categoryIds, featuredOnly },
    pagination: {
      view, query, category, featuredOnly, page, pageSize, total, pageCount,
      hasPrevious: page > 1,
      hasNext: page < pageCount,
    },
  }
}

async function readResponseJson(response) {
  if (!response.ok) {
    const error = new Error(`catalog returned HTTP ${response.status}`)
    error.status = response.status
    error.retryable = response.status === 429 || response.status >= 500
    throw error
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_CATALOG_BYTES) throw new Error('catalog response is too large')
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) throw new Error('catalog response is too large')
  try {
    return JSON.parse(text)
  } catch (error) {
    error.catalogInvalid = true
    throw error
  }
}

export function createCatalogService(options = {}) {
  const catalogUrl = options.catalogUrl === null ? null : (options.catalogUrl ?? DEFAULT_CATALOG_URL)
  const bundledUrl = options.bundledUrl ?? new URL('../registry/catalog.json', import.meta.url)
  const request = options.fetch ?? globalThis.fetch
  const installCountsUrl = typeof options.installCountsUrl === 'string' ? options.installCountsUrl : null
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
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
      try {
        let document
        let lastError
        const delays = Array.isArray(retryDelaysMs) ? retryDelaysMs : DEFAULT_RETRY_DELAYS_MS
        for (let attempt = 0; attempt <= delays.length; attempt += 1) {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeoutMs)
          try {
            const response = await request(catalogUrl, {
              headers: { accept: 'application/json', 'user-agent': 'dsh-safe-plugin-manager' },
              signal: controller.signal,
            })
            const rawDocument = await readResponseJson(response)
            try {
              document = validateCatalog(rawDocument)
            } catch (error) {
              error.catalogInvalid = true
              throw error
            }
            lastError = null
            break
          } catch (error) {
            lastError = error
            if (!retryableTransportError(error) || attempt === delays.length) break
            await wait(delays[attempt])
          } finally {
            clearTimeout(timer)
          }
        }
        if (lastError) throw lastError
        value = {
          ...document,
          source: { kind: 'github', url: catalogUrl, fetchedAt: new Date().toISOString(), errorCode: null },
        }
      } catch (error) {
        const code = error?.name === 'AbortError' ? 'CATALOG_TIMEOUT'
          : Number.isInteger(error?.status) ? 'CATALOG_HTTP_ERROR'
            : error?.catalogInvalid === true ? 'CATALOG_INVALID'
              : 'CATALOG_UNAVAILABLE'
        value = await bundled(code)
      }
    }
    let installCounts = { status: installCountsUrl === null ? 'disabled' : 'unavailable', url: installCountsUrl, updatedAt: null }
    if (installCountsUrl !== null && typeof request === 'function') {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 3_000))
      try {
        const response = await request(installCountsUrl, { headers: { accept: 'application/json', 'user-agent': 'dsh-safe-plugin-manager' }, signal: controller.signal })
        if (!response.ok) throw new Error(`counts returned HTTP ${response.status}`)
        const text = await response.text()
        if (Buffer.byteLength(text) > MAX_COUNTS_BYTES) throw new Error('counts response is too large')
        const payload = JSON.parse(text)
        if (payload?.schemaVersion !== 1 || !payload.counts || typeof payload.counts !== 'object') throw new Error('counts response is invalid')
        value = { ...value, entries: value.entries.map(entry => ({ ...entry, installCount: Number.isSafeInteger(payload.counts[entry.id]) && payload.counts[entry.id] >= 0 ? payload.counts[entry.id] : entry.installCount })) }
        installCounts = { status: 'live', url: installCountsUrl, updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null }
      } catch {}
      finally { clearTimeout(timer) }
    }
    value = { ...value, installCounts }
    cached = value
    cachedAt = Date.now()
    return value
  }

  return { load }
}
