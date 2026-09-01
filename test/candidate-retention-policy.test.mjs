import assert from 'node:assert/strict'
import test from 'node:test'
import {
  candidateRetentionBucket,
  candidateRetentionBucketAt,
  evaluateCandidateManifests,
  inspectRejectedCandidateCompatibility,
  isDurableRejectedCandidateDecision,
  selectRejectedCandidateRetentionBatch,
} from '../src/candidate-retention-policy.mjs'

const releases = ['0.1.0-rc.8', '0.1.1-rc.1', '0.1.1-rc.2']
const window = { releases }
const policy = {
  scanBuckets: 24,
  maxCandidatesPerRun: 96,
  maxTreeEntries: 1200,
  maxManifestCandidates: 48,
  maxManifestBytes: 262144,
  concurrency: 8,
}

function candidate(overrides = {}) {
  return {
    id: 'example-dsh-plugin',
    repositoryUrl: 'https://github.com/example/dsh-plugin',
    latestCommit: 'a'.repeat(40),
    status: 'rejected',
    ...overrides,
  }
}

function github(manifests, options = {}) {
  return {
    api: async () => ({
      truncated: options.truncated === true,
      tree: Object.keys(manifests).map(path => ({ type: 'blob', path })),
    }),
    raw: async (repositoryUrl, commit, path) => JSON.stringify(manifests[path]),
  }
}

test('manifest evaluation requires an exact unambiguous compatible result in the latest-three window', () => {
  const rangeOnly = [{ path: 'package.json', manifest: { dsh: { compatibility: { dsh: '>=0.1.0-rc.8' } } } }]
  assert.equal(evaluateCandidateManifests(rangeOnly, releases).status, 'unsupported')
  const exact = [{ path: 'package.json', manifest: { dsh: { compatibility: { dshReleases: { 'rc.8': 'compatible' } } } } }]
  assert.equal(evaluateCandidateManifests(exact, releases).status, 'compatible')
  const conflict = [{ path: 'package.json', manifest: { dsh: { compatibility: { dshReleases: {
    'rc.8': 'compatible', '0.1.0-rc.8': 'incompatible',
  } } } } }]
  assert.equal(evaluateCandidateManifests(conflict, releases).status, 'unsupported')
})

test('fixed-Commit inspection keeps exact-compatible candidates and prunes bounded range-only candidates', async () => {
  const compatible = await inspectRejectedCandidateCompatibility(candidate(), window, policy, github({
    'package.json': { dsh: { compatibility: { dshReleases: { '0.1.1-rc.2': 'compatible' } } } },
  }))
  assert.equal(compatible.status, 'compatible')
  assert.equal(compatible.compatibleRelease, '0.1.1-rc.2')

  const unsupported = await inspectRejectedCandidateCompatibility(candidate(), window, policy, github({
    'package.json': { dsh: { compatibility: { dsh: '>=0.1.0-rc.8 <0.2.0' } } },
  }))
  assert.equal(unsupported.status, 'unsupported')
  assert.match(unsupported.reason, /no exact compatible declaration/)
})

test('truncated source stays unknown and is retained for a later retry', async () => {
  const result = await inspectRejectedCandidateCompatibility(candidate(), window, policy, github({
    'package.json': {},
  }, { truncated: true }))
  assert.equal(result.status, 'unknown')
})

test('hash buckets cover only rejected candidates without storing a cursor', () => {
  const observedAt = '2026-08-24T16:00:00.000Z'
  const activeBucket = candidateRetentionBucketAt(observedAt, 8, 24)
  const selected = candidate({ repositoryUrl: 'https://github.com/example/selected' })
  let suffix = 0
  while (candidateRetentionBucket(selected, 24) !== activeBucket) {
    suffix += 1
    selected.repositoryUrl = `https://github.com/example/selected-${suffix}`
  }
  const other = candidate({ id: 'other', repositoryUrl: 'https://github.com/example/other' })
  while (candidateRetentionBucket(other, 24) === activeBucket) other.repositoryUrl += '-x'
  const reviewing = candidate({ id: 'reviewing', repositoryUrl: selected.repositoryUrl + '-reviewing', status: 'reviewing' })
  const batch = selectRejectedCandidateRetentionBatch({ entries: [selected, other, reviewing] }, observedAt, policy, 8)
  assert.equal(batch.bucket, activeBucket)
  assert.deepEqual(batch.entries, [selected])
})

test('explicit user-request rejection decisions remain durable audit records', () => {
  const observedAt = '2026-08-24T16:00:00.000Z'
  const activeBucket = candidateRetentionBucketAt(observedAt, 8, 24)
  const requested = candidate({ discoverySources: ['user-request-2026-08-21', 'github-fixed-commit-review'] })
  let suffix = 0
  while (candidateRetentionBucket(requested, 24) !== activeBucket) {
    suffix += 1
    requested.repositoryUrl = `https://github.com/example/requested-${suffix}`
  }
  assert.equal(isDurableRejectedCandidateDecision(requested), true)
  const batch = selectRejectedCandidateRetentionBatch({ entries: [requested] }, observedAt, policy, 8)
  assert.deepEqual(batch.entries, [])
})
