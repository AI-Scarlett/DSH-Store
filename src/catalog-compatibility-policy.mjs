import { createHash } from 'node:crypto'
import { compareVersions, dshReleaseVersion } from './catalog.mjs'

export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'
export const DSH_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
export const COMPATIBILITY_CANDIDATE_SOURCE = 'catalog-latest-three-compatibility-v1'
export const COMPATIBILITY_HOLD_PREFIX = 'DSH_LATEST_THREE_COMPATIBILITY_HOLD:'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const DEFAULT_RELEASE_COUNT = 3
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAX_BYTES = 1024 * 1024

function boundedText(value, maximum = 600) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
}

function candidateId(repositoryUrl) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i.exec(repositoryUrl)
  if (!match) throw new Error(`compatibility policy requires a canonical GitHub repository: ${repositoryUrl}`)
  return `${match[1]}-${match[2]}`.toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

function uniqueCandidateId(entry, candidates) {
  const repositoryKey = entry.repositoryUrl.toLowerCase()
  const ids = new Map(candidates.entries.map(candidate => [candidate.id, candidate.repositoryUrl.toLowerCase()]))
  const preferred = candidateId(entry.repositoryUrl)
  if (!ids.has(preferred) || ids.get(preferred) === repositoryKey) return preferred
  const suffix = createHash('sha256').update(repositoryKey).digest('hex').slice(0, 10)
  const fallback = `${preferred.slice(0, 85)}-${suffix}`
  if (ids.has(fallback) && ids.get(fallback) !== repositoryKey) {
    throw new Error(`compatibility candidate ID collision for ${entry.repositoryUrl}`)
  }
  return fallback
}

function releaseCount(value) {
  if (value === undefined) return DEFAULT_RELEASE_COUNT
  if (!Number.isInteger(value) || value < 1 || value > 12) throw new Error('official DSH release window count is invalid')
  return value
}

export function officialDshReleaseWindow(metadata, requestedCount = DEFAULT_RELEASE_COUNT) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('official DSH package metadata must be an object')
  }
  if (metadata.name !== DSH_PACKAGE_NAME) throw new Error('official DSH package metadata has an unexpected package name')
  const latestVersion = metadata['dist-tags']?.latest
  if (typeof latestVersion !== 'string' || !SEMVER.test(latestVersion)) {
    throw new Error('official DSH package metadata does not declare a valid latest dist-tag')
  }
  if (!metadata.versions?.[latestVersion]) throw new Error('official DSH latest dist-tag has no published version record')
  const count = releaseCount(requestedCount)
  const versions = Object.entries(metadata.versions ?? {})
    .filter(([version, record]) => SEMVER.test(version)
      && record && typeof record === 'object' && !Array.isArray(record)
      && typeof record.deprecated !== 'string'
      && (compareVersions(version, latestVersion) ?? 1) <= 0)
    .map(([version]) => version)
    .sort((left, right) => compareVersions(left, right) ?? left.localeCompare(right, 'en'))
  if (!versions.includes(latestVersion)) throw new Error('official DSH latest release is deprecated or unavailable')
  if (versions.length < count) throw new Error(`official DSH registry exposes fewer than ${count} active releases through latest`)
  return {
    packageName: DSH_PACKAGE_NAME,
    registryUrl: DSH_REGISTRY_URL,
    latestVersion,
    releases: versions.slice(-count),
    releaseCount: count,
    authority: 'official-npm-registry-published-versions-through-latest',
  }
}

export async function fetchOfficialDshReleaseWindow(options = {}) {
  const request = options.fetch ?? globalThis.fetch
  if (typeof request !== 'function') throw new Error('official DSH registry fetch is unavailable')
  const registryUrl = options.registryUrl ?? DSH_REGISTRY_URL
  if (registryUrl !== DSH_REGISTRY_URL) throw new Error('official DSH registry URL does not match the policy authority')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await request(registryUrl, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-safe-plugin-manager-catalog-automation' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`official DSH registry returned HTTP ${response.status}`)
    const text = await response.text()
    if (Buffer.byteLength(text) > (options.maxBytes ?? DEFAULT_MAX_BYTES)) {
      throw new Error('official DSH registry response exceeded the automation bound')
    }
    let metadata
    try { metadata = JSON.parse(text) } catch { throw new Error('official DSH registry returned invalid JSON') }
    return officialDshReleaseWindow(metadata, options.releaseCount)
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('official DSH registry request timed out')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function catalogReleaseStatus(entry, version) {
  const statuses = Object.entries(entry?.compatibility?.dshReleases ?? {})
    .filter(([release]) => dshReleaseVersion(release) === version)
    .map(([, status]) => status)
  if (statuses.length === 0) return 'unknown'
  if (new Set(statuses).size !== 1) throw new Error(`Catalog entry ${entry.id} has conflicting compatibility aliases for ${version}`)
  return statuses[0]
}

export function supportsDshReleaseWindow(entry, releases) {
  return releases.some(version => catalogReleaseStatus(entry, version) === 'compatible')
}

export function compatibilityHoldReason(releases) {
  return boundedText(`${COMPATIBILITY_HOLD_PREFIX} Temporarily unlisted because the Catalog has no compatible result for any of the official latest ${releases.length} DSH releases (${releases.join(', ')}). Add an exact compatible dshReleases record at a new fixed Commit; range-only or unknown compatibility is not installable evidence.`)
}

function isManagedHold(entry) {
  return entry?.status === 'unlisted' && String(entry.statusReason ?? '').startsWith(COMPATIBILITY_HOLD_PREFIX)
}

function isManagedCandidate(candidate) {
  return candidate?.status === 'reviewing'
    && candidate?.route === 'direct-review'
    && String(candidate.statusReason ?? '').startsWith(COMPATIBILITY_HOLD_PREFIX)
    && Array.isArray(candidate.discoverySources)
    && candidate.discoverySources.includes(COMPATIBILITY_CANDIDATE_SOURCE)
}

function managedCandidate(entries, candidates, releases, observedAt, previous = null) {
  const entry = entries[0]
  const commits = [...new Set(entries.map(item => item.commit))]
  const sourceUpdatedAt = entries.map(item => item.source?.updatedAt).filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
  const affected = entries.map(item => item.id).sort((left, right) => left.localeCompare(right, 'en'))
  const repositoryName = entry.repositoryUrl.replace('https://github.com/', '')
  const reason = boundedText(`${compatibilityHoldReason(releases)} Affected Catalog entries: ${affected.join(', ')}.`)
  return {
    id: uniqueCandidateId(entry, candidates),
    name: entries.length === 1 ? entry.name : `兼容性复核：${repositoryName}（${entries.length} 个 Catalog 条目）`,
    description: entries.length === 1
      ? entry.description
      : `该仓库中的 ${entries.length} 个 DSH STORE 条目因最新三个 DSH 版本兼容记录不足而暂时下架：${affected.join('、')}。`,
    repositoryUrl: entry.repositoryUrl,
    defaultBranch: entry.defaultBranch,
    latestCommit: commits.length === 1 ? commits[0] : null,
    sourceUpdatedAt,
    discoveredAt: previous?.discoveredAt ?? observedAt,
    discoverySources: [COMPATIBILITY_CANDIDATE_SOURCE],
    topics: [...new Set([...entries.flatMap(item => item.categories ?? []), 'dsh-compatibility-review'])].slice(0, 50),
    status: 'reviewing',
    route: 'direct-review',
    statusReason: reason,
  }
}

function transitionRecord(entry, releases, candidateDisposition) {
  return {
    id: entry.id,
    name: entry.name,
    repositoryUrl: entry.repositoryUrl,
    version: entry.version,
    catalogCommit: entry.commit,
    requiredDshReleases: [...releases],
    candidateDisposition,
  }
}

export function applyLatestDshCompatibilityPolicy(catalog, candidates, window, observedAt) {
  if (!catalog || !Array.isArray(catalog.entries)) throw new Error('compatibility policy requires Catalog entries')
  if (!candidates || !Array.isArray(candidates.entries)) throw new Error('compatibility policy requires Candidate Registry entries')
  if (!window || !Array.isArray(window.releases) || window.releases.length !== window.releaseCount) {
    throw new Error('compatibility policy requires a complete official DSH release window')
  }
  const candidateByRepository = new Map(candidates.entries.map(candidate => [candidate.repositoryUrl.toLowerCase(), candidate]))
  const report = {
    authority: window.authority,
    registryUrl: window.registryUrl,
    latestVersion: window.latestVersion,
    latestReleases: [...window.releases],
    requiredCompatibleReleases: 1,
    checkedApprovedEntries: 0,
    managedHeldEntries: 0,
    managedCandidatesCreated: 0,
    managedCandidatesRefreshed: 0,
    managedCandidatesRemoved: 0,
    existingCandidatesPreserved: 0,
    catalogChanged: false,
    candidatesChanged: false,
    unlisted: [],
    restored: [],
    refreshed: [],
  }
  const heldByRepository = new Map()
  for (const entry of catalog.entries) {
    const managedHold = isManagedHold(entry)
    if (entry.status !== 'approved' && !managedHold) continue
    if (entry.status === 'approved') report.checkedApprovedEntries += 1
    const supported = supportsDshReleaseWindow(entry, window.releases)
    if (supported) {
      if (!managedHold) continue
      entry.status = 'approved'
      delete entry.statusReason
      report.catalogChanged = true
      report.restored.push(transitionRecord(entry, window.releases, null))
      continue
    }

    const reason = compatibilityHoldReason(window.releases)
    if (entry.status === 'approved') {
      entry.status = 'unlisted'
      entry.statusReason = reason
      report.catalogChanged = true
      report.unlisted.push(transitionRecord(entry, window.releases, null))
    } else if (entry.statusReason !== reason) {
      entry.statusReason = reason
      report.catalogChanged = true
      report.refreshed.push(transitionRecord(entry, window.releases, null))
    }
    const repositoryKey = entry.repositoryUrl.toLowerCase()
    const group = heldByRepository.get(repositoryKey) ?? []
    group.push(entry)
    heldByRepository.set(repositoryKey, group)
    report.managedHeldEntries += 1
  }

  const transitionByRepository = new Map()
  for (const item of [...report.unlisted, ...report.restored, ...report.refreshed]) {
    const key = item.repositoryUrl.toLowerCase()
    const records = transitionByRepository.get(key) ?? []
    records.push(item)
    transitionByRepository.set(key, records)
  }
  for (const [repositoryKey, entries] of heldByRepository) {
    const existingCandidate = candidateByRepository.get(repositoryKey)
    let disposition = 'existing-candidate-preserved'
    if (!existingCandidate) {
      const candidate = managedCandidate(entries, candidates, window.releases, observedAt)
      candidates.entries.push(candidate)
      candidateByRepository.set(repositoryKey, candidate)
      disposition = 'managed-candidate-created'
      report.candidatesChanged = true
      report.managedCandidatesCreated += 1
    } else if (isManagedCandidate(existingCandidate)) {
      if (existingCandidate.discoverySources.length !== 1) {
        throw new Error(`managed compatibility candidate for ${entries[0].repositoryUrl} has additional discovery history`)
      }
      const desired = managedCandidate(entries, candidates, window.releases, observedAt, existingCandidate)
      if (JSON.stringify(existingCandidate) !== JSON.stringify(desired)) {
        Object.assign(existingCandidate, desired)
        disposition = 'managed-candidate-refreshed'
        report.candidatesChanged = true
        report.managedCandidatesRefreshed += 1
        if (!(transitionByRepository.get(repositoryKey)?.length > 0)) {
          for (const entry of entries) report.refreshed.push(transitionRecord(entry, window.releases, disposition))
        }
      } else {
        disposition = 'managed-candidate-unchanged'
      }
    } else {
      report.existingCandidatesPreserved += 1
    }
    for (const item of transitionByRepository.get(repositoryKey) ?? []) item.candidateDisposition = disposition
  }
  for (const [repositoryKey, candidate] of candidateByRepository) {
    if (!isManagedCandidate(candidate) || heldByRepository.has(repositoryKey)) continue
    if (candidate.discoverySources.length !== 1) {
      throw new Error(`managed compatibility candidate for ${candidate.repositoryUrl} has additional discovery history`)
    }
    candidates.entries = candidates.entries.filter(item => item !== candidate)
    report.candidatesChanged = true
    report.managedCandidatesRemoved += 1
    for (const item of transitionByRepository.get(repositoryKey) ?? []) item.candidateDisposition = 'managed-candidate-removed'
  }
  for (const item of [...report.restored, ...report.unlisted, ...report.refreshed]) {
    if (item.candidateDisposition === null) {
      item.candidateDisposition = candidateByRepository.has(item.repositoryUrl.toLowerCase())
        ? 'existing-candidate-preserved'
        : 'no-managed-candidate'
    }
  }
  return report
}
