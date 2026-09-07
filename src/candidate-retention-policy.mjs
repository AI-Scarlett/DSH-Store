import { createHash } from 'node:crypto'
import { dshReleaseVersion } from './catalog.mjs'

export const REJECTED_CANDIDATE_RETENTION_AUTHORITY = 'candidate-fixed-commit-package-manifests'

const COMPATIBILITY_VALUES = new Set(['compatible', 'incompatible', 'unknown'])

function possibleManifestPath(path) {
  if (!(path === 'package.json' || path.endsWith('/package.json'))) return false
  return !/(?:^|\/)(?:node_modules|vendor|fixtures?|examples?|test-data|dist|build)(?:\/|$)/i.test(path)
}

function repositoryParts(repositoryUrl) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(repositoryUrl)
  if (!match) throw new Error(`candidate retention requires a canonical GitHub repository: ${repositoryUrl}`)
  return { owner: match[1], repository: match[2] }
}

function compatibilityByVersion(manifest) {
  const matrix = manifest?.dsh?.compatibility?.dshReleases
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return new Map()
  const byVersion = new Map()
  for (const [release, status] of Object.entries(matrix)) {
    const version = dshReleaseVersion(release)
    if (version === null || !COMPATIBILITY_VALUES.has(status)) continue
    const statuses = byVersion.get(version) ?? new Set()
    statuses.add(status)
    byVersion.set(version, statuses)
  }
  return byVersion
}

export function evaluateCandidateManifests(manifests, latestReleases) {
  if (!Array.isArray(manifests) || !Array.isArray(latestReleases) || latestReleases.length < 1) {
    throw new Error('candidate compatibility evaluation requires manifests and official releases')
  }
  let declaredMatrices = 0
  for (const item of manifests) {
    const matrix = item?.manifest?.dsh?.compatibility?.dshReleases
    if (matrix && typeof matrix === 'object' && !Array.isArray(matrix)) declaredMatrices += 1
    const byVersion = compatibilityByVersion(item?.manifest)
    for (const release of latestReleases) {
      const statuses = byVersion.get(release)
      if (statuses?.size === 1 && statuses.has('compatible')) {
        return {
          status: 'compatible',
          compatibleRelease: release,
          manifestPath: item.path,
          manifestsChecked: manifests.length,
          declaredMatrices,
        }
      }
    }
  }
  return {
    status: 'unsupported',
    compatibleRelease: null,
    manifestPath: null,
    manifestsChecked: manifests.length,
    declaredMatrices,
  }
}

export function candidateRetentionBucket(candidate, bucketCount) {
  if (!Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > 256) {
    throw new Error('candidate retention bucket count is invalid')
  }
  const key = String(candidate?.repositoryUrl ?? '').trim().toLowerCase()
  if (key === '') throw new Error('candidate retention requires a repository URL')
  const prefix = createHash('sha256').update(key).digest().readUInt32BE(0)
  return prefix % bucketCount
}

export function candidateRetentionBucketAt(observedAt, scheduleHours, bucketCount) {
  const timestamp = Date.parse(observedAt ?? '')
  if (!Number.isFinite(timestamp)) throw new Error('candidate retention observedAt is invalid')
  if (!Number.isInteger(scheduleHours) || scheduleHours < 1 || scheduleHours > 24) {
    throw new Error('candidate retention schedule is invalid')
  }
  if (!Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > 256) {
    throw new Error('candidate retention bucket count is invalid')
  }
  return Math.floor(timestamp / (scheduleHours * 60 * 60 * 1000)) % bucketCount
}

export function isDurableRejectedCandidateDecision(candidate) {
  return Array.isArray(candidate?.discoverySources)
    && candidate.discoverySources.some(source => typeof source === 'string' && source.startsWith('user-request-'))
}

export function selectRejectedCandidateRetentionBatch(candidates, observedAt, policy, scheduleHours) {
  const bucketCount = policy?.scanBuckets
  const bucket = candidateRetentionBucketAt(observedAt, scheduleHours, bucketCount)
  const entries = candidates.entries.filter(candidate => candidate.status === 'rejected'
    && !isDurableRejectedCandidateDecision(candidate)
    && candidateRetentionBucket(candidate, bucketCount) === bucket)
  if (entries.length > policy.maxCandidatesPerRun) {
    throw new Error(`candidate retention bucket ${bucket} exceeds the per-run bound`)
  }
  return { bucket, bucketCount, entries }
}

export async function inspectRejectedCandidateCompatibility(candidate, window, policy, github) {
  if (!/^[0-9a-f]{40}$/.test(candidate?.latestCommit ?? '')) {
    return { status: 'unsupported', reason: 'candidate has no fixed Commit compatibility evidence', manifestsChecked: 0 }
  }
  const { owner, repository } = repositoryParts(candidate.repositoryUrl)
  const tree = await github.api(`repos/${owner}/${repository}/git/trees/${candidate.latestCommit}?recursive=1`, {
    maxBytes: 8 * 1024 * 1024,
  })
  const entries = Array.isArray(tree?.tree) ? tree.tree : []
  if (tree?.truncated === true || entries.length === 0 || entries.length > policy.maxTreeEntries) {
    return { status: 'unknown', reason: 'candidate tree is outside the bounded compatibility inspection surface', manifestsChecked: 0 }
  }
  const manifestPaths = entries
    .filter(item => item?.type === 'blob' && typeof item.path === 'string' && possibleManifestPath(item.path))
    .map(item => item.path)
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right, 'en'))
  if (manifestPaths.length > policy.maxManifestCandidates) {
    return { status: 'unknown', reason: 'candidate has too many package manifests for bounded compatibility inspection', manifestsChecked: 0 }
  }
  const manifests = []
  for (let index = 0; index < manifestPaths.length; index += policy.concurrency) {
    const batch = manifestPaths.slice(index, index + policy.concurrency)
    const texts = await Promise.all(batch.map(path => github.raw(
      candidate.repositoryUrl,
      candidate.latestCommit,
      path,
      { maxBytes: policy.maxManifestBytes },
    )))
    for (let offset = 0; offset < batch.length; offset += 1) {
      try {
        const manifest = JSON.parse(texts[offset])
        if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
          manifests.push({ path: batch[offset], manifest })
        }
      } catch {
        // A malformed package manifest cannot provide exact compatibility evidence.
      }
    }
  }
  const result = evaluateCandidateManifests(manifests, window.releases)
  return result.status === 'compatible'
    ? { ...result, reason: `exact compatible declaration found for ${result.compatibleRelease}` }
    : { ...result, reason: `no exact compatible declaration for official DSH releases ${window.releases.join(', ')}` }
}
