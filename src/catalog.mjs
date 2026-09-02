import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/
const SIMPLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const COMMIT_SHA = /^[0-9a-f]{40}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
// The index is intentionally kept below the historical 2 MiB response ceiling.
// Detail records have their own bound because they are fetched independently.
export const MAX_CATALOG_INDEX_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_CATALOG_DETAIL_RESPONSE_BYTES = 512 * 1024
export const MAX_CATALOG_BRIDGE_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_CATALOG_RESPONSE_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_CACHE_TTL_MS = 5 * 60_000
const DEFAULT_RETRY_DELAYS_MS = [300, 900, 1_800]
const MAX_COUNTS_BYTES = 256 * 1024
export const DSH_RC_RELEASES = ['rc.7', 'rc.8', '0.1.1-rc.1', '0.1.1-rc.2', '0.1.2-alpha.2', '0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5']
export const DSH_OPERATIONS = ['install', 'start', 'uninstall', 'rollback']
export const DSH_RC_VERSIONS = {
  'rc.7': '0.1.0-rc.7',
  'rc.8': '0.1.0-rc.8',
  '0.1.1-rc.1': '0.1.1-rc.1',
  '0.1.1-rc.2': '0.1.1-rc.2',
  '0.1.2-alpha.2': '0.1.2-alpha.2',
  '0.1.2-alpha.3': '0.1.2-alpha.3',
  '0.1.2-alpha.4': '0.1.2-alpha.4',
  '0.1.2-alpha.5': '0.1.2-alpha.5',
}
const MAX_DSH_RELEASE_KEYS = 64
export const MARKET_PAGE_SIZE = 20
export const MAX_MARKET_PAGE_SIZE = 40
const MAX_DSH_RANGE_LENGTH = 512
const MAX_DSH_RANGE_CLAUSES = 16
const MAX_DSH_RANGE_TOKENS = 32
const DSH_RANGE_OPERATORS = ['>=', '<=', '>', '<', '^', '~', '=']

export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/catalog.json'
export const DEFAULT_CATALOG_INDEX_PATH = 'catalog-index.json'
export const DEFAULT_CATALOG_DETAILS_PATH = 'catalog/details'
export const CATALOG_BRIDGE_ID = 'dsh-safe-plugin-manager'

function catalogRelativePath(value, label) {
  const path = nonEmptyString(value, label, 240)
  if (path.startsWith('/') || path.includes('..') || path.includes('\\') || !/^[A-Za-z0-9._/-]+$/.test(path)) {
    throw new TypeError(`${label} must be a safe relative Catalog path`)
  }
  return path
}

function catalogDocumentBuffer(document) {
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`)
}

export function catalogBridgeBuffer(document) {
  return Buffer.from(`${JSON.stringify(document)}\n`)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

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
  // A split v2 Catalog is validated detail-by-detail under the current wire
  // contract. Its hydrated view intentionally keeps current partial evidence;
  // it is not an old monolithic payload that must use the 0.8.2 bridge.
  if (document.sourceFormat === 'split-v2') return true
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

function validateCatalogRegistry(registry, { index = false, bridge = false } = {}) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new TypeError('catalog registry metadata is required')
  }
  const trustPolicy = registry.trustPolicy
  if (trustPolicy?.candidateInstallDisabled !== true || trustPolicy?.unknownIsNotVerified !== true
    || trustPolicy?.promotionIndependentOfVerification !== true) {
    throw new TypeError('catalog registry trustPolicy must fail closed')
  }
  const categories = registry.categories && typeof registry.categories === 'object'
    ? Object.fromEntries(Object.entries(registry.categories).map(([key, label]) => {
        const id = nonEmptyString(key, 'registry.categories key', 96)
        if (!SIMPLE_ID.test(id)) throw new TypeError(`registry category id ${id} is invalid`)
        return [id, nonEmptyString(label, `registry.categories.${key}`, 120)]
      }))
    : {}
  const registryUpdatedAt = isoDateOrNull(registry.updatedAt, 'registry.updatedAt')
  if (!registryUpdatedAt) throw new TypeError('registry.updatedAt must be an ISO date-time')
  const normalized = {
    name: nonEmptyString(registry.name, 'registry.name', 160),
    repositoryUrl: canonicalGithubRepository(registry.repositoryUrl),
    updatedAt: registryUpdatedAt,
    sourceUpdates: {
      mode: registry.sourceUpdates?.mode === 'client-on-demand' ? 'client-on-demand' : 'client-on-demand',
      defaultPolicy: registry.sourceUpdates?.defaultPolicy === 'risk-derived' ? 'risk-derived' : 'risk-derived',
    },
    trustPolicy: {
      candidateInstallDisabled: true,
      unknownIsNotVerified: true,
      promotionIndependentOfVerification: true,
    },
    categories,
  }
  if (typeof registry.homepageUrl === 'string') normalized.homepageUrl = registry.homepageUrl.slice(0, 400)
  if (typeof registry.installCountsUrl === 'string') normalized.installCountsUrl = new URL(registry.installCountsUrl).href
  if (index) {
    normalized.detailsPath = catalogRelativePath(
      registry.detailsPath ?? DEFAULT_CATALOG_DETAILS_PATH,
      'registry.detailsPath',
    ).replace(/^\/+|\/+$/g, '')
  }
  const hasIndexPath = Object.hasOwn(registry, 'indexPath')
  if (bridge || hasIndexPath) {
    if (!hasIndexPath) throw new TypeError('Catalog bridge registry.indexPath is required')
    normalized.indexPath = catalogRelativePath(registry.indexPath, 'registry.indexPath')
    if (!/^[0-9a-f]{64}$/.test(registry.indexSha256 ?? '')) {
      throw new TypeError('Catalog bridge registry.indexSha256 must be a SHA-256 digest')
    }
    if (!Number.isInteger(registry.indexBytes) || registry.indexBytes < 1
      || registry.indexBytes > MAX_CATALOG_INDEX_RESPONSE_BYTES) {
      throw new TypeError('Catalog bridge registry.indexBytes is invalid')
    }
    if (!Number.isInteger(registry.indexEntryCount) || registry.indexEntryCount < 1
      || registry.indexEntryCount > 1_000_000) {
      throw new TypeError('Catalog bridge registry.indexEntryCount is invalid')
    }
    normalized.indexSha256 = registry.indexSha256
    normalized.indexBytes = registry.indexBytes
    normalized.indexEntryCount = registry.indexEntryCount
  }
  return normalized
}

function validateLegacyCatalog(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('catalog must be an object')
  }
  if (document.schemaVersion !== 1) throw new TypeError('catalog schemaVersion must be 1')
  if (!Array.isArray(document.entries)) throw new TypeError('catalog entries must be an array')
  const bridge = Boolean(document.registry && Object.hasOwn(document.registry, 'indexPath'))
  const registry = validateCatalogRegistry(document.registry, { bridge })
  const entries = document.entries.map((entry, index) => validateEntry(entry, index, registry.updatedAt))
  if (bridge && entries.length !== 1 && entries.length !== registry.indexEntryCount) {
    throw new TypeError('Catalog bridge must contain either the transitional bootstrap entry or the complete compatibility directory')
  }
  const ids = new Set()
  const packages = new Set()
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new TypeError(`duplicate catalog id ${entry.id}`)
    if (packages.has(entry.packageName)) throw new TypeError(`duplicate catalog package ${entry.packageName}`)
    if (entry.categories.length === 0) throw new TypeError(`catalog entry ${entry.id} must declare at least one category`)
    for (const category of entry.categories) {
      if (!Object.hasOwn(registry.categories, category)) throw new TypeError(`catalog entry ${entry.id} uses unknown category ${category}`)
    }
    ids.add(entry.id)
    packages.add(entry.packageName)
  }
  return {
    schemaVersion: 1,
    ...(bridge ? { catalogType: 'legacy-bridge' } : {}),
    registry,
    entries,
  }
}

function bilingualNameParts(value, fallback) {
  const current = nonEmptyString(value, 'catalog entry name', 160)
  const formatted = /^(?<zh>.+[\u3400-\u9fff].*)（(?<en>[^（）]*[A-Za-z0-9@][^（）]*)）$/u.exec(current)
  if (formatted) return { nameZh: formatted.groups.zh.trim(), nameEn: formatted.groups.en.trim() }
  if (/[\u3400-\u9fff]/u.test(current)) return { nameZh: current, nameEn: fallback }
  return { nameZh: current, nameEn: fallback }
}

function validateCatalogIndexEntry(value, index, registry) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`index.entries[${index}] must be an object`)
  const id = nonEmptyString(value.id, `index.entries[${index}].id`, 96)
  if (!SIMPLE_ID.test(id)) throw new TypeError(`index.entries[${index}].id is invalid`)
  const packageName = nonEmptyString(value.packageName, `index.entries[${index}].packageName`, 214)
  if (!PACKAGE_NAME.test(packageName) || packageName.includes('..')) throw new TypeError(`index.entries[${index}].packageName is invalid`)
  const version = nonEmptyString(value.version, `index.entries[${index}].version`, 80)
  if (!VERSION.test(version)) throw new TypeError(`index.entries[${index}].version is invalid`)
  const detailPath = nonEmptyString(value.detailPath, `index.entries[${index}].detailPath`, 240)
  if (detailPath.startsWith('/') || detailPath.includes('..') || detailPath.includes('\\')) throw new TypeError(`index.entries[${index}].detailPath is invalid`)
  const prefix = `${registry.detailsPath}/`
  if (!detailPath.startsWith(prefix)) throw new TypeError(`index.entries[${index}].detailPath must be inside ${registry.detailsPath}`)
  if (detailPath !== `${prefix}${id}.json`) throw new TypeError(`index.entries[${index}].detailPath must resolve from the plugin id`)
  const order = value.order
  if (!Number.isInteger(order) || order < 0 || order > 1_000_000) throw new TypeError(`index.entries[${index}].order must be a non-negative integer`)
  const names = {
    nameZh: nonEmptyString(value.nameZh, `index.entries[${index}].nameZh`, 160),
    nameEn: nonEmptyString(value.nameEn, `index.entries[${index}].nameEn`, 160),
  }
  return {
    id,
    ...names,
    packageName,
    version,
    featured: value.featured === true,
    order,
    repositoryUrl: canonicalGithubRepository(value.repositoryUrl),
    detailPath,
    status: enumValue(value.status, `index.entries[${index}].status`, ['approved', 'blocked', 'unlisted']),
    categories: stringArray(value.categories ?? [], `index.entries[${index}].categories`, { simple: true }),
    searchTerms: stringArray(value.searchTerms ?? [], `index.entries[${index}].searchTerms`, { max: 120 }).slice(0, 40),
  }
}

export function validateCatalogIndex(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new TypeError('catalog index must be an object')
  if (document.schemaVersion !== 2 || document.catalogType !== 'index') throw new TypeError('catalog index schemaVersion must be 2')
  if (!Array.isArray(document.entries)) throw new TypeError('catalog index entries must be an array')
  const registry = validateCatalogRegistry(document.registry, { index: true })
  const entries = document.entries.map((entry, index) => validateCatalogIndexEntry(entry, index, registry))
  const ids = new Set()
  const packages = new Set()
  const details = new Set()
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new TypeError(`duplicate catalog index id ${entry.id}`)
    if (packages.has(entry.packageName)) throw new TypeError(`duplicate catalog index package ${entry.packageName}`)
    if (details.has(entry.detailPath)) throw new TypeError(`duplicate catalog index detail path ${entry.detailPath}`)
    for (const category of entry.categories) if (!Object.hasOwn(registry.categories, category)) throw new TypeError(`catalog index entry ${entry.id} uses unknown category ${category}`)
    ids.add(entry.id); packages.add(entry.packageName); details.add(entry.detailPath)
  }
  return { schemaVersion: 2, catalogType: 'index', registry, entries }
}

export function validateCatalog(document) {
  if (document?.schemaVersion === 2 || document?.catalogType === 'index') return validateCatalogIndex(document)
  return validateLegacyCatalog(document)
}

export function validateCatalogDetail(document, indexEntry, registry) {
  const detail = validateLegacyCatalog({ schemaVersion: 1, registry, entries: [document] }).entries[0]
  if (indexEntry) {
    for (const field of ['id', 'packageName', 'version', 'repositoryUrl', 'status']) {
      if (detail[field] !== indexEntry[field]) throw new TypeError(`catalog detail ${field} does not match index entry ${indexEntry.id}`)
    }
    if (detail.featured !== indexEntry.featured) throw new TypeError(`catalog detail featured does not match index entry ${indexEntry.id}`)
  }
  return detail
}

function legacyAssurance(assurance) {
  return Object.fromEntries(Object.entries(assurance ?? {}).map(([gate, record]) => {
    const value = { status: record?.status === 'partial' ? 'unknown' : record?.status ?? 'unknown' }
    if (record?.status === 'partial') value.evidenceStatus = 'partial'
    for (const field of ['method', 'checkedAt', 'evidenceUrl', 'dshRelease']) {
      if (record?.[field] != null) value[field] = record[field]
    }
    return [gate, value]
  }))
}

function legacyWireEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    packageName: entry.packageName,
    description: entry.description,
    searchTerms: entry.searchTerms,
    repositoryUrl: entry.repositoryUrl,
    defaultBranch: entry.defaultBranch,
    manifestPath: entry.manifestPath,
    installPath: entry.installPath,
    updatePolicy: entry.updatePolicy,
    commit: entry.commit,
    version: entry.version,
    categories: entry.categories,
    featured: entry.featured,
    installCount: entry.installCount,
    source: entry.source,
    assurance: legacyAssurance(entry.assurance),
    entryIds: entry.entryIds,
    status: entry.status,
    ...(entry.statusReason ? { statusReason: entry.statusReason } : {}),
    compatibility: {
      dsh: entry.compatibility.dsh,
      dshReleases: entry.compatibility.dshReleases,
      node: entry.compatibility.node,
      systems: entry.compatibility.systems,
      profiles: entry.compatibility.profiles,
    },
    details: {
      pluginType: entry.details.pluginType,
      installSource: entry.details.installSource,
      license: entry.details.license,
      permissions: entry.details.permissions,
      externalDependencies: entry.details.externalDependencies,
      reviewStatus: entry.details.reviewStatus,
    },
    risk: {
      installScripts: entry.risk.installScripts,
      review: entry.risk.review,
    },
  }
}

function registryWithoutSplitMetadata(registry) {
  const {
    detailsPath: _detailsPath,
    indexPath: _indexPath,
    indexSha256: _indexSha256,
    indexBytes: _indexBytes,
    indexEntryCount: _indexEntryCount,
    ...base
  } = registry
  return base
}

export function splitCatalogDocument(document, options = {}) {
  const catalog = validateLegacyCatalog(document)
  const rawDetailsPath = String(options.detailsPath ?? DEFAULT_CATALOG_DETAILS_PATH)
  let detailsStart = 0
  let detailsEnd = rawDetailsPath.length
  while (detailsStart < detailsEnd && rawDetailsPath.charCodeAt(detailsStart) === 47) detailsStart += 1
  while (detailsEnd > detailsStart && rawDetailsPath.charCodeAt(detailsEnd - 1) === 47) detailsEnd -= 1
  const detailsPath = catalogRelativePath(rawDetailsPath.slice(detailsStart, detailsEnd), 'detailsPath')
  const indexPath = catalogRelativePath(options.indexPath ?? DEFAULT_CATALOG_INDEX_PATH, 'indexPath')
  const bridgeId = options.bridgeId ?? (catalog.entries.some(entry => entry.id === CATALOG_BRIDGE_ID)
    ? CATALOG_BRIDGE_ID
    : catalog.entries[0]?.id)
  const bridgeEntry = catalog.entries.find(entry => entry.id === bridgeId)
  if (!bridgeEntry) throw new TypeError(`Catalog bridge entry is missing: ${bridgeId}`)
  const baseRegistry = registryWithoutSplitMetadata(catalog.registry)
  const index = {
    schemaVersion: 2,
    catalogType: 'index',
    registry: { ...baseRegistry, detailsPath },
    entries: catalog.entries.map((entry, order) => {
      const names = bilingualNameParts(entry.name, entry.packageName)
      return {
        id: entry.id, ...names, packageName: entry.packageName, version: entry.version,
        featured: entry.featured === true, order, repositoryUrl: entry.repositoryUrl,
        detailPath: `${detailsPath}/${entry.id}.json`, status: entry.status,
        categories: entry.categories, searchTerms: entry.searchTerms,
      }
    }),
  }
  const validatedIndex = validateCatalogIndex(index)
  const indexBuffer = catalogDocumentBuffer(validatedIndex)
  const bridge = {
    schemaVersion: 1,
    registry: {
      ...baseRegistry,
      indexPath,
      indexSha256: sha256(indexBuffer),
      indexBytes: indexBuffer.length,
      indexEntryCount: validatedIndex.entries.length,
    },
    entries: catalog.entries.map(legacyWireEntry),
  }
  validateLegacyCatalog(bridge)
  assertLegacyCatalogCompatibility(bridge)
  if (catalogBridgeBuffer(bridge).length > MAX_CATALOG_BRIDGE_RESPONSE_BYTES) {
    throw new TypeError('Catalog compatibility bridge exceeds the historical 2 MiB response ceiling')
  }
  return {
    bridge,
    index: validatedIndex,
    details: validatedIndex.entries.map(indexEntry => ({
      path: indexEntry.detailPath,
      entry: catalog.entries.find(entry => entry.id === indexEntry.id),
    })),
  }
}

export function hydrateCatalog(indexDocument, detailDocuments) {
  const index = validateCatalogIndex(indexDocument)
  // File/network loaders preserve index order. Pairing array records by that
  // order makes a detail file with a wrong id fail as an identity mismatch
  // instead of being mistaken for a missing file. Map callers may still use
  // ids explicitly.
  const detailFor = detailDocuments instanceof Map
    ? indexEntry => detailDocuments.get(indexEntry.id)
    : (() => {
        const details = Array.isArray(detailDocuments) ? detailDocuments : []
        let position = 0
        return () => details[position++]
      })()
  const entries = index.entries.map(indexEntry => validateCatalogDetail(detailFor(indexEntry), indexEntry, index.registry))
  return { schemaVersion: 1, sourceFormat: 'split-v2', registry: index.registry, entries }
}

export function validateCatalogBridgeIndex(bridgeDocument, indexDocument, indexBytes) {
  const bridge = validateLegacyCatalog(bridgeDocument)
  if (!bridge.registry.indexPath) throw new TypeError('Catalog document is not a legacy bridge')
  const index = validateCatalogIndex(indexDocument)
  const bytes = Buffer.isBuffer(indexBytes) ? indexBytes : Buffer.from(indexBytes)
  if (bytes.length !== bridge.registry.indexBytes) throw new TypeError('Catalog bridge index byte length does not match')
  if (sha256(bytes) !== bridge.registry.indexSha256) throw new TypeError('Catalog bridge index SHA-256 does not match')
  if (index.entries.length !== bridge.registry.indexEntryCount) throw new TypeError('Catalog bridge index entry count does not match')
  for (const field of ['name', 'repositoryUrl', 'updatedAt']) {
    if (index.registry[field] !== bridge.registry[field]) throw new TypeError(`Catalog bridge registry.${field} does not match the index`)
  }
  for (const field of ['sourceUpdates', 'trustPolicy', 'categories']) {
    if (JSON.stringify(index.registry[field]) !== JSON.stringify(bridge.registry[field])) {
      throw new TypeError(`Catalog bridge registry.${field} does not match the index`)
    }
  }
  const bootstrap = bridge.entries[0]
  const indexed = index.entries.find(entry => entry.id === bootstrap.id)
  if (!indexed) throw new TypeError(`Catalog bridge entry is not present in the index: ${bootstrap.id}`)
  for (const field of ['id', 'packageName', 'version', 'repositoryUrl', 'status']) {
    if (indexed[field] !== bootstrap[field]) throw new TypeError(`Catalog bridge ${field} does not match the index entry`)
  }
  if (indexed.featured !== bootstrap.featured) throw new TypeError('Catalog bridge featured flag does not match the index entry')
  return index
}

async function loadCatalogIndexFromFiles(indexUrl) {
  const rootBytes = await readFile(indexUrl)
  let rootDocument
  try {
    rootDocument = JSON.parse(rootBytes.toString('utf8'))
  } catch (error) {
    throw Object.assign(new Error('Catalog bridge is invalid'), { code: 'CATALOG_INVALID', cause: error })
  }
  if (rootDocument?.schemaVersion === 2) {
    return { document: validateCatalogIndex(rootDocument), indexUrl, bridge: null }
  }
  const legacy = validateLegacyCatalog(rootDocument)
  if (!legacy.registry.indexPath) return { document: legacy, indexUrl, bridge: null }
  const resolvedIndexUrl = new URL(legacy.registry.indexPath, indexUrl)
  let bytes
  try {
    bytes = await readFile(resolvedIndexUrl)
  } catch (error) {
    throw Object.assign(new Error('Catalog index is missing'), { code: 'CATALOG_INDEX_MISSING', cause: error })
  }
  try {
    const indexDocument = JSON.parse(bytes.toString('utf8'))
    return {
      document: validateCatalogBridgeIndex(rootDocument, indexDocument, bytes),
      indexUrl: resolvedIndexUrl,
      bridge: legacy,
    }
  } catch (error) {
    if (error?.code === 'CATALOG_INDEX_MISSING') throw error
    throw Object.assign(new Error(`Catalog index is invalid: ${error.message}`), {
      code: 'CATALOG_INDEX_INVALID', cause: error,
    })
  }
}

export async function loadCatalogFromFiles(options = {}) {
  const indexUrl = options.indexUrl ?? new URL('../registry/catalog.json', import.meta.url)
  const loaded = await loadCatalogIndexFromFiles(indexUrl)
  if (loaded.document.schemaVersion !== 2) return loaded.document
  const index = loaded.document
  const details = await Promise.all(index.entries.map(async entry => {
    const detailUrl = new URL(entry.detailPath, loaded.indexUrl)
    let source
    try {
      source = await readFile(detailUrl, 'utf8')
    } catch (error) {
      throw Object.assign(new Error(`catalog detail is missing for ${entry.id}`), {
        code: 'CATALOG_DETAIL_MISSING', cause: error,
      })
    }
    try {
      return JSON.parse(source)
    } catch (error) {
      throw Object.assign(new Error(`catalog detail is invalid for ${entry.id}`), {
        code: 'CATALOG_DETAIL_INVALID', cause: error,
      })
    }
  }))
  return hydrateCatalog(index, details)
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

function catalogIndexSearchValues(entry) {
  return [
    entry.id, entry.nameZh, entry.nameEn, entry.packageName, entry.version,
    entry.repositoryUrl, ...(entry.searchTerms ?? []), ...(entry.categories ?? []),
  ].map(value => String(value ?? '').toLowerCase())
}

/**
 * Selects one page from the small index without hydrating any detail records.
 * The explicit order is the source of truth for the default marketplace order;
 * this keeps page boundaries stable while detail files are loaded lazily.
 */
export function selectMarketplaceIndexEntries(index, options = {}) {
  const catalog = validateCatalogIndex(index)
  const view = options.view ?? 'market'
  if (!['market', 'installed'].includes(view)) {
    throw Object.assign(new TypeError('index view must be market or installed'), { code: 'INVALID_MARKET_VIEW', status: 400 })
  }
  const query = String(options.query ?? '').trim().toLowerCase()
  const category = String(options.category ?? '').trim().toLowerCase()
  if (query.length > 200) throw Object.assign(new TypeError('query is too long'), { code: 'INVALID_MARKET_QUERY', status: 400 })
  if (category.length > 96 || (category && !SIMPLE_ID.test(category))) {
    throw Object.assign(new TypeError('category is invalid'), { code: 'INVALID_MARKET_CATEGORY', status: 400 })
  }
  const requestedPage = positiveInteger(options.page, 1, 10_000, 'page')
  const pageSize = positiveInteger(options.pageSize, MARKET_PAGE_SIZE, MAX_MARKET_PAGE_SIZE, 'pageSize')
  const installedPackages = new Set((options.inventory?.plugins ?? []).filter(plugin => plugin.installed !== false).map(plugin => plugin.packageName))
  const featuredOnly = options.featuredOnly === true
  const scoped = catalog.entries
    .filter(entry => view === 'installed' ? installedPackages.has(entry.packageName) : entry.status !== 'unlisted')
    .filter(entry => !featuredOnly || entry.featured === true)
    .filter(entry => category === '' || entry.categories.includes(category))
    .filter(entry => query === '' || catalogIndexSearchValues(entry).some(value => value.includes(query)))
    .sort((left, right) => left.order - right.order || left.nameZh.localeCompare(right.nameZh, 'zh-CN') || left.id.localeCompare(right.id))
  const total = scoped.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, pageCount)
  return {
    index: catalog,
    entries: scoped.slice((page - 1) * pageSize, page * pageSize),
    categoryIds: [...new Set(scoped.flatMap(entry => entry.categories))].sort(),
    pagination: {
      view, query, category, featuredOnly, page, pageSize, total, pageCount,
      hasPrevious: page > 1, hasNext: page < pageCount,
    },
  }
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
    catalogPackageNames: options.catalogPackageNames ?? snapshot.entries.map(entry => entry.packageName),
    filters: { categoryIds, featuredOnly },
    pagination: {
      view, query, category, featuredOnly, page, pageSize, total, pageCount,
      hasPrevious: page > 1,
      hasNext: page < pageCount,
    },
  }
}

async function readResponseDocument(response, maximum = MAX_CATALOG_RESPONSE_BYTES) {
  if (!response.ok) {
    const error = new Error(`catalog returned HTTP ${response.status}`)
    error.status = response.status
    error.retryable = response.status === 429 || response.status >= 500
    throw error
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximum) throw new Error('catalog response is too large')
  const text = await response.text()
  if (Buffer.byteLength(text) > maximum) throw new Error('catalog response is too large')
  try {
    return { document: JSON.parse(text), bytes: Buffer.from(text) }
  } catch (error) {
    error.catalogInvalid = true
    throw error
  }
}

async function readResponseJson(response, maximum = MAX_CATALOG_RESPONSE_BYTES) {
  return (await readResponseDocument(response, maximum)).document
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
  let indexCached = null
  let indexCachedAt = 0
  const detailCache = new Map()
  const detailPromises = new Map()

  async function bundledIndex(errorCode = null) {
    const loaded = await loadCatalogIndexFromFiles(bundledUrl)
    return {
      ...loaded.document,
      source: {
        kind: 'bundled', url: catalogUrl, indexUrl: loaded.indexUrl.href,
        fetchedAt: new Date().toISOString(), errorCode,
      },
    }
  }

  async function fetchIndex() {
    if (catalogUrl === null || typeof request !== 'function') {
      return bundledIndex(catalogUrl === null ? null : 'FETCH_UNAVAILABLE')
    }
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
          // Keep the v1 compatibility reader bounded at its old 4 MiB limit;
          // newly published v2 indexes are checked against the stricter 2 MiB
          // budget immediately after parsing.
          const root = await readResponseDocument(response, MAX_CATALOG_RESPONSE_BYTES)
          const rawDocument = root.document
          if (rawDocument?.schemaVersion === 2
            && root.bytes.length > MAX_CATALOG_INDEX_RESPONSE_BYTES) {
            throw new Error('catalog index response is too large')
          }
          try {
            document = validateCatalog(rawDocument)
            let indexUrl = catalogUrl
            if (document.schemaVersion === 1 && document.registry.indexPath) {
              indexUrl = new URL(document.registry.indexPath, catalogUrl).href
              const indexResponse = await request(indexUrl, {
                headers: { accept: 'application/json', 'user-agent': 'dsh-safe-plugin-manager' },
                signal: controller.signal,
              })
              const indexPayload = await readResponseDocument(indexResponse, MAX_CATALOG_INDEX_RESPONSE_BYTES)
              document = validateCatalogBridgeIndex(rawDocument, indexPayload.document, indexPayload.bytes)
            }
            document = {
              ...document,
              source: {
                kind: 'github', url: catalogUrl, indexUrl,
                fetchedAt: new Date().toISOString(), errorCode: null,
              },
            }
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
      return document
    } catch (error) {
      const code = error?.name === 'AbortError' ? 'CATALOG_TIMEOUT'
        : Number.isInteger(error?.status) ? 'CATALOG_HTTP_ERROR'
          : error?.catalogInvalid === true ? 'CATALOG_INVALID'
            : 'CATALOG_UNAVAILABLE'
      return bundledIndex(code)
    }
  }

  async function loadIndex({ force = false } = {}) {
    if (!force && indexCached && Date.now() - indexCachedAt < cacheTtlMs) return indexCached
    if (force) {
      cached = null
      cachedAt = 0
      detailCache.clear()
      detailPromises.clear()
    }
    indexCached = await fetchIndex()
    indexCachedAt = Date.now()
    return indexCached
  }

  async function loadDetails(ids, { index = null, force = false } = {}) {
    const catalog = index ?? await loadIndex({ force })
    if (catalog.schemaVersion === 1) {
      const requested = new Set(ids ?? catalog.entries.map(entry => entry.id))
      return catalog.entries.filter(entry => requested.has(entry.id))
    }
    const requestedIds = [...new Set(ids ?? catalog.entries.map(entry => entry.id))]
    const entriesById = new Map(catalog.entries.map(entry => [entry.id, entry]))
    const missing = requestedIds.filter(id => !entriesById.has(id))
    if (missing.length > 0) throw Object.assign(new Error(`catalog detail is not indexed: ${missing.join(', ')}`), { code: 'CATALOG_DETAIL_NOT_INDEXED' })
    const values = await Promise.all(requestedIds.map(async id => {
      const indexEntry = entriesById.get(id)
      const sourceIdentity = `${catalog.source?.kind ?? 'unknown'}:${catalog.source?.indexUrl ?? catalog.source?.url ?? 'unknown'}:${catalog.registry.updatedAt}`
      const cacheKey = `${sourceIdentity}:${id}`
      if (!force && detailCache.has(cacheKey)) return detailCache.get(cacheKey)
      if (!force && detailPromises.has(cacheKey)) return detailPromises.get(cacheKey)
      const promise = (async () => {
        let raw
        if (catalog.source?.kind === 'bundled' || catalogUrl === null) {
          raw = JSON.parse(await readFile(new URL(indexEntry.detailPath, catalog.source?.indexUrl ?? bundledUrl), 'utf8'))
        } else {
          const detailUrl = new URL(indexEntry.detailPath, catalog.source.indexUrl ?? catalog.source.url).href
          const response = await request(detailUrl, {
            headers: { accept: 'application/json', 'user-agent': 'dsh-safe-plugin-manager' },
            signal: AbortSignal.timeout(timeoutMs),
          })
          raw = await readResponseJson(response, MAX_CATALOG_DETAIL_RESPONSE_BYTES)
        }
        const value = validateCatalogDetail(raw, indexEntry, catalog.registry)
        detailCache.set(cacheKey, value)
        return value
      })()
      if (!force) detailPromises.set(cacheKey, promise)
      try {
        return await promise
      } finally {
        if (detailPromises.get(cacheKey) === promise) detailPromises.delete(cacheKey)
      }
    }))
    return values
  }

  async function overlayInstallCounts(value, entries = value.entries) {
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
        const counts = new Map(entries.map(entry => [entry.id, Number.isSafeInteger(payload.counts[entry.id]) && payload.counts[entry.id] >= 0 ? payload.counts[entry.id] : entry.installCount]))
        entries.forEach(entry => { entry.installCount = counts.get(entry.id) })
        installCounts = { status: 'live', url: installCountsUrl, updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null }
      } catch {}
      finally { clearTimeout(timer) }
    }
    return { ...value, entries, installCounts }
  }

  async function load({ force = false } = {}) {
    if (!force && cached && Date.now() - cachedAt < cacheTtlMs) return cached
    const index = await loadIndex({ force })
    let value
    if (index.schemaVersion === 1) {
      value = index
    } else {
      try {
        const details = await loadDetails(index.entries.map(entry => entry.id), { index })
        value = hydrateCatalog(index, details)
        value.source = index.source
      } catch {
        // Never mix a remote index with local detail files. Use the complete
        // bundled snapshot as one atomic fallback instead.
        const fallback = await bundledIndex('CATALOG_DETAILS_UNAVAILABLE')
        if (fallback.schemaVersion === 1) value = fallback
        else {
          const details = await loadDetails(fallback.entries.map(entry => entry.id), { index: fallback })
          value = hydrateCatalog(fallback, details)
          value.source = fallback.source
        }
      }
    }
    value = await overlayInstallCounts(value)
    cached = value
    cachedAt = Date.now()
    return value
  }

  return { load, loadIndex, loadDetails }
}
