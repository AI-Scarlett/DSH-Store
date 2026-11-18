import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessUpstreamVersion,
  admissionReviewRegistryStaleForEntry,
  buildCatalogVersionUpdate,
  catalogChangeReviewContract,
  catalogUpdateIdentityMatches,
  catalogUpdatePolicy,
  holdExternalOnlyAfterDisconnectedHistory,
  sourceDeclaredCompatibility,
} from '../src/catalog-update-review.mjs'
import {
  applyLatestDshCompatibilityPolicy,
  COMPATIBILITY_CANDIDATE_SOURCE,
  COMPATIBILITY_HOLD_PREFIX,
  supportsDshReleaseWindow,
} from '../src/catalog-compatibility-policy.mjs'

const entry = (overrides = {}) => ({
  id: 'demo',
  name: '演示插件（Demo Plugin）',
  packageName: 'dsh-demo',
  repositoryUrl: 'https://github.com/example/dsh-demo',
  defaultBranch: 'main',
  manifestPath: 'package.json',
  installPath: null,
  commit: 'a'.repeat(40),
  version: '1.2.0',
  status: 'approved',
  updatePolicy: 'user-reviewed',
  entryIds: ['demo'],
  compatibility: {
    dsh: '>=0.1.0',
    dshReleases: { '0.1.1-rc.2': 'compatible' },
    dshOperations: { '0.1.1-rc.2': { install: 'passed', start: 'passed', uninstall: 'unknown', rollback: 'unknown' } },
    node: '>=22',
    systems: ['macOS'],
    profiles: ['web'],
  },
  assurance: {
    discovery: { status: 'verified' },
    installability: { status: 'verified' },
    runtime: { status: 'verified' },
    securityReview: { status: 'unknown' },
  },
  details: {
    license: 'MIT',
    permissions: { files: 'write', network: 'none', commands: 'none', credentials: ['none'] },
  },
  risk: { installScripts: [], review: 'fixture' },
  ...overrides,
})

test('upstream version authority distinguishes newer SemVer from source-only changes and regressions', () => {
  assert.equal(assessUpstreamVersion(entry(), {
    commit: 'b'.repeat(40), manifest: { name: 'dsh-demo', version: '1.3.0' },
  }).status, 'newer-version')
  assert.equal(assessUpstreamVersion(entry(), {
    commit: 'b'.repeat(40), manifest: { name: 'dsh-demo', version: '1.2.0' },
  }).status, 'source-changed-without-version-bump')
  assert.equal(assessUpstreamVersion(entry(), {
    commit: 'b'.repeat(40), manifest: { name: 'dsh-demo', version: '1.1.9' },
  }).status, 'upstream-version-behind')
  assert.equal(assessUpstreamVersion(entry(), {
    commit: 'b'.repeat(40), manifest: { name: 'other', version: '9.0.0' },
  }).status, 'update-blocked')
  assert.equal(assessUpstreamVersion(entry(), {
    commit: 'b'.repeat(40), manifest: { name: 'dsh-demo', version: '1.3.0-not valid' },
  }).status, 'update-blocked')
})

test('new versions and same-version source changes both enter fixed-source review with distinct contracts', () => {
  assert.deepEqual(catalogChangeReviewContract({ status: 'newer-version' }), {
    reviewable: true, expectedVersionComparison: 1, changeKind: 'version-update',
  })
  assert.deepEqual(catalogChangeReviewContract({ status: 'source-changed-without-version-bump' }), {
    reviewable: true, expectedVersionComparison: 0, changeKind: 'same-version-source-update',
  })
  assert.equal(catalogChangeReviewContract({ status: 'upstream-version-behind' }).reviewable, false)
})

test('Catalog update policy preserves low-risk automation and higher-risk local review', () => {
  assert.equal(catalogUpdatePolicy(entry()), 'user-reviewed')
  assert.equal(catalogUpdatePolicy(entry({ status: 'blocked', updatePolicy: 'external-only' })), 'external-only')
  assert.equal(catalogUpdatePolicy(entry({
    updatePolicy: null,
    details: { license: 'MIT', permissions: { files: 'none', network: 'none', commands: 'none', credentials: ['none'] } },
  })), 'source-verified')
  assert.equal(catalogUpdatePolicy(entry({
    status: 'unlisted', updatePolicy: null,
    statusReason: `${COMPATIBILITY_HOLD_PREFIX} fixture`,
    details: { license: 'MIT', permissions: { files: 'none', network: 'none', commands: 'none', credentials: ['none'] } },
  })), 'source-verified', 'a reversible compatibility hold must retain its fixed-source review path')
})

test('Catalog update identity includes package, repository, manifest, install path, and Bundle entries', () => {
  const candidate = {
    packageName: 'dsh-demo',
    repositoryUrl: 'https://github.com/example/dsh-demo',
    manifestPath: 'package.json',
    installPath: null,
    entryIds: ['demo'],
  }
  assert.equal(catalogUpdateIdentityMatches(entry(), candidate), true)
  assert.equal(catalogUpdateIdentityMatches(entry(), { ...candidate, entryIds: ['other'] }), false)
  assert.equal(catalogUpdateIdentityMatches(entry(), { ...candidate, installPath: 'packages/demo' }), false)
})

test('a Catalog version refresh resets old runtime and compatibility evidence', () => {
  const candidate = {
    ...entry(),
    defaultBranch: 'stable',
    commit: 'b'.repeat(40),
    version: '1.3.0',
    compatibility: { dsh: '>=0.1.1', node: '>=24', systems: ['Linux'], profiles: ['web'] },
    risk: { installScripts: ['prepare'] },
  }
  const updated = buildCatalogVersionUpdate(entry(), candidate, {
    sourceUpdatedAt: '2026-08-22T05:00:00Z',
  }, '2026-08-22T06:00:00Z', 'user-reviewed')
  assert.equal(updated.version, '1.3.0')
  assert.equal(updated.commit, 'b'.repeat(40))
  assert.equal(updated.assurance.discovery.method, 'automated-fixed-source-update-v3')
  assert.equal(updated.assurance.installability.status, 'unknown')
  assert.equal(updated.assurance.runtime.status, 'unknown')
  assert.equal(updated.compatibility.dshReleases['0.1.1-rc.2'], 'unknown')
  assert.deepEqual(updated.compatibility.dshOperations['0.1.1-rc.2'], {
    install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown',
  })
  assert.deepEqual(updated.risk.installScripts, ['prepare'])
})

test('a compatible same-version fixed Commit requires current admission before restoring its hold', () => {
  const original = entry({
    status: 'unlisted',
    statusReason: `${COMPATIBILITY_HOLD_PREFIX} fixture`,
    compatibility: {
      dsh: '>=0.1.1', dshReleases: { '0.1.2-alpha.5': 'unknown', '0.1.2-rc.1': 'unknown' },
      dshOperations: {}, node: '>=22', systems: [], profiles: ['web'],
    },
  })
  const candidate = {
    ...original,
    commit: 'b'.repeat(40),
    compatibility: {
      ...original.compatibility,
      dshReleases: { '0.1.2-alpha.5': 'compatible', '0.1.2-rc.1': 'compatible' },
    },
  }
  const updated = buildCatalogVersionUpdate(original, candidate, {}, '2026-09-04T02:00:00Z', 'user-reviewed')
  assert.equal(updated.version, original.version)
  assert.equal(updated.commit, candidate.commit)
  assert.equal(updated.assurance.discovery.method, 'automated-fixed-source-update-v3')
  const catalog = { entries: [updated] }
  const candidates = { entries: [{
    id: 'example-dsh-demo', name: original.name, description: original.description,
    repositoryUrl: original.repositoryUrl, defaultBranch: 'main', latestCommit: original.commit,
    sourceUpdatedAt: null, discoveredAt: '2026-09-04T01:00:00Z',
    discoverySources: [COMPATIBILITY_CANDIDATE_SOURCE], topics: ['dsh-compatibility-review'],
    status: 'reviewing', route: 'direct-review', statusReason: `${COMPATIBILITY_HOLD_PREFIX} fixture`,
  }] }
  const window = {
    authority: 'fixture', registryUrl: 'https://registry.npmjs.org', latestVersion: '0.1.2-rc.1',
    releaseCount: 2, releases: ['0.1.2-alpha.5', '0.1.2-rc.1'],
  }
  const blocked = applyLatestDshCompatibilityPolicy(catalog, candidates, window, '2026-09-04T02:00:00Z')
  assert.equal(blocked.restored.length, 0)
  assert.equal(updated.status, 'unlisted', 'new Commit and compatibility alone cannot restore admission')
  const authority = { policyDigest: 'c'.repeat(64), reviewRegistryDigest: 'd'.repeat(64) }
  updated.admission = { engine: 'bounded-source-v3', binding: 'e'.repeat(64), ...authority,
    state: 'source-verified', sourceContract: 'verified', coverage: 'complete', capabilities: 'low-risk-static' }
  const report = applyLatestDshCompatibilityPolicy(catalog, candidates, window, '2026-09-04T02:00:00Z', authority)
  assert.equal(catalog.entries[0].status, 'approved')
  assert.equal(report.restored.length, 1)
  assert.equal(candidates.entries.length, 0)
})

test('self-manager version refresh imports its new explicit compatibility matrix', () => {
  const original = entry({
    id: 'dsh-safe-plugin-manager',
    compatibility: {
      dsh: '>=0.1.0-rc.7 <0.2.0',
      dshReleases: { 'rc.7': 'compatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible' },
      dshOperations: {
        'rc.7': { install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed' },
        'rc.8': { install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed' },
        '0.1.1-rc.1': { install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed' },
        '0.1.1-rc.2': { install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed' },
      },
      node: '>=22', systems: ['macOS'], profiles: ['web'],
    },
  })
  const candidate = {
    ...original,
    commit: 'b'.repeat(40),
    version: '1.3.0',
    compatibility: {
      ...original.compatibility,
      dshReleases: {
        ...original.compatibility.dshReleases,
        '0.1.2-alpha.3': 'compatible',
        '0.1.2-alpha.4': 'compatible',
        '0.1.2-alpha.5': 'compatible',
      },
    },
  }
  const updated = buildCatalogVersionUpdate(original, candidate, {}, '2026-08-22T06:00:00Z', 'user-reviewed')
  assert.equal(updated.compatibility.dshReleases['0.1.2-alpha.5'], 'compatible')
  assert.deepEqual(updated.compatibility.dshOperations['0.1.2-alpha.5'], {
    install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown',
  })
  assert.deepEqual(updated.compatibility.dshOperations['0.1.1-rc.2'], {
    install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed',
  })
  assert.equal(supportsDshReleaseWindow(updated, [
    '0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5',
  ]), true)
})

test('version refresh imports an upstream per-release declaration while leaving operations unknown', () => {
  const candidate = {
    ...entry(),
    commit: 'c'.repeat(40),
    version: '1.4.0',
    compatibility: {
      dsh: '>=0.1.1-rc.1 <0.2.0',
      dshReleases: { '0.1.1-rc.2': 'compatible' },
      node: '>=24', systems: ['Linux'], profiles: ['web'],
    },
  }
  const updated = buildCatalogVersionUpdate(entry(), candidate, {}, '2026-08-22T06:00:00Z', 'user-reviewed')
  assert.equal(updated.compatibility.dshReleases['0.1.1-rc.2'], 'compatible')
  assert.equal(updated.compatibility.dshReleases['0.1.1-rc.1'], 'unknown')
  assert.equal(updated.compatibility.dshOperations['0.1.1-rc.2'].install, 'unknown')
})

test('source compatibility canonicalizes aliases internally while preserving legacy Store release keys', () => {
  const candidate = {
    compatibility: {
      dsh: '>=0.1.0-rc.8 <0.2.0',
      dshReleases: {
        '0.1.0-rc.8': 'incompatible',
        '0.1.1-rc.1': 'incompatible',
        '0.1.1-rc.2': 'compatible',
      },
      dshOperations: {
        '0.1.1-rc.2': { install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed' },
      },
      node: '>=22', systems: ['Linux'], profiles: ['web'],
    },
  }
  const compatibility = sourceDeclaredCompatibility(entry({
    compatibility: {
      dsh: '>=0.1.0-rc.7',
      dshReleases: { 'rc.8': 'incompatible' },
      dshOperations: { 'rc.8': { install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown' } },
    },
  }), candidate)
  assert.equal(compatibility.dshReleases['rc.7'], 'unknown')
  assert.equal(compatibility.dshReleases['rc.8'], 'incompatible')
  assert.equal(Object.hasOwn(compatibility.dshReleases, '0.1.0-rc.8'), false)
  assert.equal(compatibility.dshReleases['0.1.1-rc.2'], 'compatible')
  assert.deepEqual(compatibility.dshOperations['0.1.1-rc.2'], {
    install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed',
  })
  assert.equal(compatibility.dshOperations['rc.8'].install, 'unknown')
})

test('source compatibility still fails closed on genuinely conflicting aliases', () => {
  assert.throws(() => sourceDeclaredCompatibility(entry(), {
    compatibility: {
      dshReleases: { 'rc.8': 'unknown', '0.1.0-rc.8': 'incompatible' },
    },
  }), /conflicting aliases for 0\.1\.0-rc\.8/)
  assert.throws(() => sourceDeclaredCompatibility(entry(), {
    compatibility: {
      dshOperations: {
        '0.1.7-rc.1': { install: 'passed', start: 'pending', uninstall: 'passed', rollback: 'passed' },
      },
    },
  }), /must be passed, failed, or unknown/)
})

test('a complete new automatic review refreshes a stale blocked classification while preserving curated identity', async () => {
  const { isAutomaticPolicyBlocked, refreshAutomaticPolicyReview } = await import('../src/catalog-update-review.mjs')
  const previous = entry({ status: 'blocked', statusReason: 'Automatic policy blocked installation: old prepare', updatePolicy: 'external-only', risk: { review: 'automatic-policy-blocked-not-installable', installScripts: [] } })
  const reviewed = { ...previous, id: 'generated-id', status: 'approved', statusReason: undefined, updatePolicy: 'source-verified', details: { permissions: { level: 'low' }, externalDependencies: [] }, assurance: { discovery: { method: 'automated-fixed-source-policy-v1' } } }
  assert.equal(isAutomaticPolicyBlocked(previous), true)
  const refreshed = refreshAutomaticPolicyReview(previous, reviewed)
  assert.equal(refreshed.id, previous.id)
  assert.equal(refreshed.status, 'approved')
  assert.equal(refreshed.statusReason, undefined)
  assert.deepEqual(refreshed.details.externalDependencies, [])
  const manual = { ...previous, statusReason: 'Maintainer selected display-only', risk: { review: 'manual' } }
  assert.equal(refreshAutomaticPolicyReview(manual, reviewed), manual)
  assert.throws(() => refreshAutomaticPolicyReview(previous, { ...reviewed, assurance: {} }), /complete automatic/)
})

test('a complete automatic scan refreshes review-required fixed-source decisions and their binding', async () => {
  const { refreshAutomaticPolicyReview } = await import('../src/catalog-update-review.mjs')
  const previous = entry({
    status: 'blocked',
    statusReason: 'Fixed-source recheck blocked installation: prior capability signals',
    updatePolicy: 'external-only',
    risk: { review: 'automatic-policy-blocked-not-installable', installScripts: [] },
    admission: { state: 'review-required', binding: 'old-binding' },
  })
  const reviewed = {
    ...previous,
    commit: 'b'.repeat(40),
    status: 'blocked',
    statusReason: 'Fixed-source recheck blocked installation: current capability signals',
    admission: { state: 'review-required', binding: 'new-binding' },
    assurance: { discovery: { method: 'automated-fixed-source-policy-v1' } },
  }

  assert.equal(refreshAutomaticPolicyReview(previous, reviewed).admission.binding, 'new-binding')
})

test('a new fixed Commit replaces the prior manual rejection with the current source decision', async () => {
  const { refreshAutomaticPolicyReview } = await import('../src/catalog-update-review.mjs')
  const previous = entry({
    commit: 'a'.repeat(40),
    status: 'blocked',
    statusReason: 'FIXED_SOURCE_REVIEW_REJECTED: old fixed source had an unsafe trust boundary',
    updatePolicy: 'external-only',
    risk: { review: 'manual-rejection', installScripts: [] },
    admission: { state: 'rejected', binding: 'old-binding', reviewRegistryDigest: 'old-registry' },
  })
  const reviewed = {
    ...previous,
    commit: 'b'.repeat(40),
    status: 'blocked',
    statusReason: 'Fixed-source recheck blocked installation: current source requires review',
    updatePolicy: 'external-only',
    risk: { review: 'automatic-policy-blocked-not-installable', installScripts: [] },
    admission: { state: 'review-required', binding: 'new-binding', reviewRegistryDigest: 'new-registry' },
    assurance: { discovery: { method: 'automated-fixed-source-policy-v1' } },
  }

  const refreshed = refreshAutomaticPolicyReview(previous, reviewed)
  assert.equal(refreshed.commit, 'b'.repeat(40))
  assert.equal(refreshed.admission.state, 'review-required')
  assert.equal(refreshed.admission.binding, 'new-binding')
  assert.match(refreshed.statusReason, /current source/)
  assert.equal(refreshAutomaticPolicyReview(previous, {
    ...reviewed,
    commit: previous.commit,
    admission: { ...reviewed.admission, reviewRegistryDigest: previous.admission.reviewRegistryDigest },
  }), previous, 'an unchanged fixed-source decision does not erase a manual terminal state')
})

test('a new admission-review registry digest refreshes a manual decision for the same fixed Commit', async () => {
  const { refreshAutomaticPolicyReview } = await import('../src/catalog-update-review.mjs')
  const previous = entry({
    status: 'blocked',
    statusReason: 'FIXED_SOURCE_REVIEW_REJECTED: prior decision for this source',
    updatePolicy: 'external-only',
    risk: { review: 'manual-rejection', installScripts: [] },
    admission: { state: 'rejected', binding: 'same-source-binding', reviewRegistryDigest: 'old-registry' },
  })
  const reviewed = {
    ...previous,
    statusReason: 'Fixed-source recheck blocked installation: current manual verdict',
    admission: { state: 'reviewed', binding: 'same-source-binding', reviewRegistryDigest: 'new-registry' },
    assurance: { discovery: { method: 'automated-fixed-source-policy-v1' } },
  }

  const refreshed = refreshAutomaticPolicyReview(previous, reviewed)
  assert.equal(refreshed.admission.state, 'reviewed')
  assert.equal(refreshed.admission.reviewRegistryDigest, 'new-registry')
})

test('a changed admission-review registry triggers only the matching fixed Commit recheck', () => {
  const original = entry({
    status: 'blocked',
    admission: { state: 'rejected', reviewRegistryDigest: 'old-registry' },
  })
  const record = { repositoryUrl: original.repositoryUrl.toUpperCase(), commit: original.commit.toUpperCase() }
  assert.equal(admissionReviewRegistryStaleForEntry(original, [record], 'new-registry'), true)
  assert.equal(admissionReviewRegistryStaleForEntry(original, [{ ...record, commit: 'b'.repeat(40) }], 'new-registry'), false)
  assert.equal(admissionReviewRegistryStaleForEntry(original, [record], 'old-registry'), false)
  assert.equal(admissionReviewRegistryStaleForEntry({ ...original, admission: undefined }, [record], 'new-registry'), false)
})

test('a stale review-required fixed-source decision is selected for one automatic recheck', async () => {
  const { isPendingAutomaticPolicyRecheck } = await import('../src/catalog-update-review.mjs')
  const stale = entry({
    status: 'blocked',
    statusReason: 'Fixed-source recheck blocked installation: prior capability signals',
    updatePolicy: 'external-only',
    risk: { review: 'automatic-policy-blocked-not-installable' },
    admission: { state: 'review-required' },
  })

  assert.equal(isPendingAutomaticPolicyRecheck(stale), true)
  assert.equal(isPendingAutomaticPolicyRecheck({ ...stale, statusReason: 'Automatic policy blocked installation: current findings' }), false)
  assert.equal(isPendingAutomaticPolicyRecheck({ ...stale, risk: { review: 'manual' } }), false)
  assert.equal(isPendingAutomaticPolicyRecheck({ ...stale, updatePolicy: 'user-reviewed' }), false)
})

test('a connected fixed-source review can replace the specific disconnected-history hold', async () => {
  const { refreshAutomaticPolicyReview } = await import('../src/catalog-update-review.mjs')
  const original = entry({ status: 'blocked', updatePolicy: 'external-only' })
  const held = holdExternalOnlyAfterDisconnectedHistory(original, 'a'.repeat(40), 'b'.repeat(40))
  const reviewed = {
    ...held,
    statusReason: 'Fixed-source recheck blocked installation: current source findings',
    risk: { ...held.risk, review: 'automatic-policy-blocked-not-installable' },
    assurance: { discovery: { method: 'automated-fixed-source-policy-v1' } },
  }

  assert.equal(refreshAutomaticPolicyReview(held, reviewed).statusReason, reviewed.statusReason)
})

test('a disconnected third-party source refresh remains blocked and external-only', () => {
  const previous = 'a'.repeat(40)
  const candidate = 'b'.repeat(40)
  const original = entry({
    status: 'approved', updatePolicy: 'external-only', risk: { review: 'manual', installScripts: [] },
  })
  const held = holdExternalOnlyAfterDisconnectedHistory(original, previous, candidate, ['commands permission signal'])
  assert.equal(held.status, 'blocked')
  assert.equal(held.updatePolicy, 'external-only')
  assert.equal(held.risk.review, 'disconnected-history-external-only')
  assert.match(held.statusReason, /has no common ancestor/)
  assert.match(held.statusReason, /commands permission signal/)
  assert.equal(original.status, 'approved')
  assert.throws(() => holdExternalOnlyAfterDisconnectedHistory({ ...original, updatePolicy: 'source-verified' }, previous, candidate), /external-only/)
})
