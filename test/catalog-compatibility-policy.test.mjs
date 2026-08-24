import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyLatestDshCompatibilityPolicy,
  COMPATIBILITY_CANDIDATE_SOURCE,
  COMPATIBILITY_HOLD_PREFIX,
  fetchOfficialDshReleaseWindow,
  officialDshReleaseWindow,
} from '../src/catalog-compatibility-policy.mjs'

const observedAt = '2026-08-24T12:00:00.000Z'
const releaseWindow = {
  packageName: '@deepseek-ai/dsh',
  registryUrl: 'https://registry.npmjs.org/@deepseek-ai%2Fdsh',
  latestVersion: '0.1.1-rc.2',
  releases: ['0.1.0-rc.8', '0.1.1-rc.1', '0.1.1-rc.2'],
  releaseCount: 3,
  authority: 'official-npm-registry-published-versions-through-latest',
}

function entry(overrides = {}) {
  return {
    id: 'dsh-example',
    name: '示例插件（Example Plugin）',
    description: '用于验证兼容策略的示例插件。',
    repositoryUrl: 'https://github.com/ExampleOwner/dsh-example',
    defaultBranch: 'main',
    commit: 'a'.repeat(40),
    version: '1.0.0',
    categories: ['tools'],
    status: 'approved',
    compatibility: {
      dsh: '>=0.1.0-rc.7',
      dshReleases: {
        'rc.7': 'compatible',
        'rc.8': 'incompatible',
        '0.1.1-rc.1': 'unknown',
        '0.1.1-rc.2': 'unknown',
      },
    },
    source: { updatedAt: '2026-08-23T00:00:00.000Z' },
    ...overrides,
  }
}

function documents(catalogEntry = entry(), candidateEntries = []) {
  return {
    catalog: { entries: [catalogEntry] },
    candidates: { entries: candidateEntries },
  }
}

test('official release window follows the latest dist-tag and excludes newer next-only or deprecated releases', () => {
  const result = officialDshReleaseWindow({
    name: '@deepseek-ai/dsh',
    'dist-tags': { latest: '0.1.1-rc.2', next: '0.2.0-rc.1' },
    versions: {
      '0.1.0-rc.7': {},
      '0.1.0-rc.8': {},
      '0.1.1-rc.1': {},
      '0.1.1-rc.2': {},
      '0.2.0-rc.1': {},
      '0.1.0-rc.6': { deprecated: 'do not use' },
    },
  }, 3)
  assert.equal(result.latestVersion, '0.1.1-rc.2')
  assert.deepEqual(result.releases, releaseWindow.releases)
})

test('official registry errors fail closed instead of using Catalog fallback releases', async () => {
  await assert.rejects(() => fetchOfficialDshReleaseWindow({
    fetch: async () => ({ ok: false, status: 503, text: async () => '' }),
    releaseCount: 3,
  }), /official DSH registry returned HTTP 503/)
  assert.throws(() => officialDshReleaseWindow({
    name: '@deepseek-ai/dsh',
    'dist-tags': { latest: '0.1.1-rc.2' },
    versions: { '0.1.1-rc.2': {} },
  }, 0), /window count is invalid/)
})

test('old-only or unknown compatibility is unlisted and moved to a non-installable reviewing candidate', () => {
  const { catalog, candidates } = documents()
  const report = applyLatestDshCompatibilityPolicy(catalog, candidates, releaseWindow, observedAt)
  assert.equal(catalog.entries[0].status, 'unlisted')
  assert.match(catalog.entries[0].statusReason, new RegExp(`^${COMPATIBILITY_HOLD_PREFIX}`))
  assert.equal(candidates.entries.length, 1)
  assert.equal(candidates.entries[0].status, 'reviewing')
  assert.equal(candidates.entries[0].route, 'direct-review')
  assert.deepEqual(candidates.entries[0].discoverySources, [COMPATIBILITY_CANDIDATE_SOURCE])
  assert.equal(report.unlisted.length, 1)
  assert.equal(report.catalogChanged, true)
  assert.equal(report.candidatesChanged, true)
})

test('an exact compatible alias in any of the latest three releases keeps an approved entry listed', () => {
  const supported = entry({
    compatibility: {
      dsh: '>=0.1.0-rc.7',
      dshReleases: { 'rc.8': 'compatible', '0.1.1-rc.1': 'unknown', '0.1.1-rc.2': 'unknown' },
    },
  })
  const { catalog, candidates } = documents(supported)
  const report = applyLatestDshCompatibilityPolicy(catalog, candidates, releaseWindow, observedAt)
  assert.equal(catalog.entries[0].status, 'approved')
  assert.equal(candidates.entries.length, 0)
  assert.equal(report.unlisted.length, 0)
  assert.equal(report.catalogChanged, false)
})

test('a managed hold restores automatically and removes only its managed candidate', () => {
  const held = entry({
    status: 'unlisted',
    statusReason: `${COMPATIBILITY_HOLD_PREFIX} prior window`,
    compatibility: {
      dsh: '>=0.1.0-rc.7',
      dshReleases: { 'rc.8': 'unknown', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'unknown' },
    },
  })
  const managed = {
    id: 'exampleowner-dsh-example',
    name: held.name,
    description: held.description,
    repositoryUrl: held.repositoryUrl,
    defaultBranch: held.defaultBranch,
    latestCommit: held.commit,
    sourceUpdatedAt: held.source.updatedAt,
    discoveredAt: observedAt,
    discoverySources: [COMPATIBILITY_CANDIDATE_SOURCE],
    topics: ['dsh-compatibility-review'],
    status: 'reviewing',
    route: 'direct-review',
    statusReason: `${COMPATIBILITY_HOLD_PREFIX} prior window`,
  }
  const { catalog, candidates } = documents(held, [managed])
  const report = applyLatestDshCompatibilityPolicy(catalog, candidates, releaseWindow, observedAt)
  assert.equal(catalog.entries[0].status, 'approved')
  assert.equal(Object.hasOwn(catalog.entries[0], 'statusReason'), false)
  assert.equal(candidates.entries.length, 0)
  assert.equal(report.restored.length, 1)
  assert.equal(report.catalogChanged, true)
  assert.equal(report.candidatesChanged, true)
})

test('a pre-existing candidate for the same repository is preserved byte-for-byte', () => {
  const historicalCandidate = {
    id: 'historical-candidate',
    name: 'Historical Candidate',
    description: 'A DeepSeek Harness plugin',
    repositoryUrl: entry().repositoryUrl,
    defaultBranch: 'main',
    latestCommit: 'b'.repeat(40),
    sourceUpdatedAt: null,
    discoveredAt: '2026-08-20T00:00:00.000Z',
    discoverySources: ['fixed-commit-review'],
    topics: ['dsh-plugin'],
    status: 'rejected',
    route: 'blocked',
    statusReason: 'Bundle entry collision from an earlier review',
  }
  const original = structuredClone(historicalCandidate)
  const { catalog, candidates } = documents(entry(), [historicalCandidate])
  const report = applyLatestDshCompatibilityPolicy(catalog, candidates, releaseWindow, observedAt)
  assert.deepEqual(candidates.entries, [original])
  assert.equal(report.unlisted[0].candidateDisposition, 'existing-candidate-preserved')
  assert.equal(report.candidatesChanged, false)
})

test('multiple held plugins from one repository share one candidate and partial restoration keeps it', () => {
  const first = entry({ id: 'dsh-example-one' })
  const second = entry({ id: 'dsh-example-two', commit: 'b'.repeat(40) })
  const catalog = { entries: [first, second] }
  const candidates = { entries: [] }
  const initial = applyLatestDshCompatibilityPolicy(catalog, candidates, releaseWindow, observedAt)
  assert.equal(initial.unlisted.length, 2)
  assert.equal(candidates.entries.length, 1)
  assert.equal(candidates.entries[0].latestCommit, null)
  assert.match(candidates.entries[0].statusReason, /dsh-example-one, dsh-example-two/)

  first.compatibility.dshReleases['0.1.1-rc.2'] = 'compatible'
  const followUp = applyLatestDshCompatibilityPolicy(catalog, candidates, releaseWindow, '2026-08-25T00:00:00.000Z')
  assert.equal(first.status, 'approved')
  assert.equal(second.status, 'unlisted')
  assert.equal(followUp.restored.length, 1)
  assert.equal(candidates.entries.length, 1)
  assert.equal(candidates.entries[0].latestCommit, second.commit)
  assert.match(candidates.entries[0].statusReason, /dsh-example-two/)
  assert.doesNotMatch(candidates.entries[0].statusReason, /dsh-example-one/)
})
