import { readFile } from 'node:fs/promises'

const SIMPLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const COMMIT_SHA = /^[0-9a-f]{40}$/
const MAX_CANDIDATE_BYTES = 5 * 1024 * 1024
const FORBIDDEN_INSTALL_FIELDS = ['packageName', 'manifestPath', 'installPath', 'entryIds', 'compatibility', 'details', 'risk', 'updatePolicy']

export const DEFAULT_CANDIDATES_URL =
  'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/candidates.json'

function nonEmptyString(value, label, max = 2_000) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new TypeError(`${label} must be a non-empty string no longer than ${max} characters`)
  }
  return value.trim()
}

function isoDate(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null
  const text = nonEmptyString(value, label, 80)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(Date.parse(text))) throw new TypeError(`${label} must be an ISO date-time`)
  return new Date(text).toISOString()
}

function stringArray(value, label, minimum = 0) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const normalized = [...new Set(value.map((item, index) => nonEmptyString(item, `${label}[${index}]`, 160)))]
  if (normalized.length < minimum) throw new TypeError(`${label} must contain at least ${minimum} value`)
  return normalized
}

function canonicalGithubRepository(value) {
  const source = nonEmptyString(value, 'repositoryUrl', 300).replace(/^git\+/, '').replace(/\.git\/?$/i, '').replace(/\/$/, '')
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/#]+)$/i.exec(source)
  if (!match) throw new TypeError('repositoryUrl must be an https://github.com/<owner>/<repository> URL')
  return `https://github.com/${match[1]}/${match[2]}`
}

function validateCandidate(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`entries[${index}] must be an object`)
  const forbidden = FORBIDDEN_INSTALL_FIELDS.filter(field => Object.hasOwn(value, field))
  if (forbidden.length > 0) throw new TypeError(`entries[${index}] candidate contains forbidden install fields: ${forbidden.join(', ')}`)
  const id = nonEmptyString(value.id, `entries[${index}].id`, 96)
  if (!SIMPLE_ID.test(id)) throw new TypeError(`entries[${index}].id is invalid`)
  const status = ['discovered', 'reviewing', 'rejected'].includes(value.status) ? value.status : null
  const route = ['direct-review', 'monorepo-review', 'adapter-required', 'blocked'].includes(value.route) ? value.route : null
  if (!status) throw new TypeError(`entries[${index}].status is invalid`)
  if (!route) throw new TypeError(`entries[${index}].route is invalid`)
  const latestCommit = value.latestCommit === null || value.latestCommit === undefined ? null : String(value.latestCommit).toLowerCase()
  if (latestCommit !== null && !COMMIT_SHA.test(latestCommit)) throw new TypeError(`entries[${index}].latestCommit must be a full Git commit SHA`)
  return {
    id,
    name: nonEmptyString(value.name, `entries[${index}].name`, 160),
    description: nonEmptyString(value.description, `entries[${index}].description`),
    repositoryUrl: canonicalGithubRepository(value.repositoryUrl),
    defaultBranch: nonEmptyString(value.defaultBranch ?? 'main', `entries[${index}].defaultBranch`, 120),
    latestCommit,
    sourceUpdatedAt: isoDate(value.sourceUpdatedAt, `entries[${index}].sourceUpdatedAt`, true),
    discoveredAt: isoDate(value.discoveredAt, `entries[${index}].discoveredAt`),
    discoverySources: stringArray(value.discoverySources, `entries[${index}].discoverySources`, 1),
    topics: stringArray(value.topics ?? [], `entries[${index}].topics`),
    status,
    route,
    statusReason: value.statusReason === null || value.statusReason === undefined ? null : nonEmptyString(value.statusReason, `entries[${index}].statusReason`, 600),
    installable: false,
    allowedActions: [],
  }
}

export function validateCandidateRegistry(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new TypeError('candidate registry must be an object')
  if (document.schemaVersion !== 1) throw new TypeError('candidate registry schemaVersion must be 1')
  if (!document.registry || typeof document.registry !== 'object' || Array.isArray(document.registry)) throw new TypeError('candidate registry metadata is required')
  const boundary = document.registry.trustBoundary
  if (boundary?.installActionsDisabled !== true || boundary?.catalogPromotionRequired !== true || boundary?.unknownIsNotVerified !== true) {
    throw new TypeError('candidate registry trust boundary must fail closed')
  }
  if (!Array.isArray(document.entries)) throw new TypeError('candidate entries must be an array')
  const entries = document.entries.map(validateCandidate)
  const ids = new Set()
  const repositories = new Set()
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new TypeError(`duplicate candidate id ${entry.id}`)
    if (repositories.has(entry.repositoryUrl.toLowerCase())) throw new TypeError(`duplicate candidate repository ${entry.repositoryUrl}`)
    ids.add(entry.id)
    repositories.add(entry.repositoryUrl.toLowerCase())
  }
  return {
    schemaVersion: 1,
    registry: {
      name: nonEmptyString(document.registry.name, 'registry.name', 160),
      repositoryUrl: canonicalGithubRepository(document.registry.repositoryUrl),
      updatedAt: isoDate(document.registry.updatedAt, 'registry.updatedAt'),
      trustBoundary: { installActionsDisabled: true, catalogPromotionRequired: true, unknownIsNotVerified: true },
    },
    entries,
  }
}

export function searchCandidates(registry, query = '') {
  const needle = String(query).trim().toLowerCase()
  return registry.entries
    .filter(entry => entry.status !== 'rejected')
    .filter(entry => needle === '' || [entry.id, entry.name, entry.description, entry.repositoryUrl, entry.route, ...entry.discoverySources, ...entry.topics]
      .some(value => String(value).toLowerCase().includes(needle)))
    .sort((left, right) => (Date.parse(right.sourceUpdatedAt ?? right.discoveredAt) || 0) - (Date.parse(left.sourceUpdatedAt ?? left.discoveredAt) || 0)
      || left.name.localeCompare(right.name, 'zh-CN'))
}

export function createCandidateService(options = {}) {
  const candidateUrl = options.candidateUrl === null ? null : (options.candidateUrl ?? DEFAULT_CANDIDATES_URL)
  const bundledUrl = options.bundledUrl ?? new URL('../registry/candidates.json', import.meta.url)
  const request = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 10_000

  async function bundled(errorCode = null) {
    const document = validateCandidateRegistry(JSON.parse(await readFile(bundledUrl, 'utf8')))
    return { ...document, source: { kind: 'bundled', url: candidateUrl, fetchedAt: new Date().toISOString(), errorCode } }
  }

  async function load({ force = false } = {}) {
    void force
    if (candidateUrl === null || typeof request !== 'function') return bundled(candidateUrl === null ? null : 'CANDIDATES_UNAVAILABLE')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await request(candidateUrl, { headers: { accept: 'application/json', 'user-agent': 'dsh-safe-plugin-manager' }, signal: controller.signal })
      if (!response.ok) throw new Error(`candidate registry returned HTTP ${response.status}`)
      const text = await response.text()
      if (Buffer.byteLength(text) > MAX_CANDIDATE_BYTES) throw new Error('candidate registry is too large')
      const document = validateCandidateRegistry(JSON.parse(text))
      return { ...document, source: { kind: 'github', url: candidateUrl, fetchedAt: new Date().toISOString(), errorCode: null } }
    } catch {
      return bundled('CANDIDATES_UNAVAILABLE')
    } finally {
      clearTimeout(timer)
    }
  }

  return { load }
}
