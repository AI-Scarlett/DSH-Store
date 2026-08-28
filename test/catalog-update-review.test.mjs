import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessUpstreamVersion,
  buildCatalogVersionUpdate,
  catalogUpdateIdentityMatches,
  catalogUpdatePolicy,
  isAutomatedPolicyBlocked,
  sourceDeclaredCompatibility,
} from '../src/catalog-update-review.mjs'

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

test('Catalog update policy preserves low-risk automation and higher-risk local review', () => {
  assert.equal(catalogUpdatePolicy(entry()), 'user-reviewed')
  assert.equal(catalogUpdatePolicy(entry({ status: 'blocked', updatePolicy: 'external-only' })), 'external-only')
  assert.equal(catalogUpdatePolicy(entry({
    updatePolicy: null,
    details: { license: 'MIT', permissions: { files: 'none', network: 'none', commands: 'none', credentials: ['none'] } },
  })), 'source-verified')
})

test('only the exact automation-created blocked shape is promotion-eligible', () => {
  const automated = entry({
    status: 'blocked',
    updatePolicy: 'external-only',
    statusReason: 'Automatic policy blocked installation: runtime source exceeded the bound',
    assurance: {
      ...entry().assurance,
      discovery: { status: 'verified', method: 'automated-fixed-source-policy-v1' },
    },
    details: { ...entry().details, reviewStatus: 'automated-scan' },
    risk: { installScripts: [], review: 'automatic-policy-blocked-not-installable' },
  })
  assert.equal(isAutomatedPolicyBlocked(automated), true)
  assert.equal(isAutomatedPolicyBlocked({
    ...automated,
    assurance: { discovery: { method: 'automated-fixed-source-update-v2' } },
  }), true)
  assert.equal(isAutomatedPolicyBlocked({ ...automated, risk: { ...automated.risk, review: 'manual-review' } }), false)
  assert.equal(isAutomatedPolicyBlocked({ ...automated, statusReason: 'Maintainer blocked this entry' }), false)
  assert.equal(isAutomatedPolicyBlocked({ ...automated, assurance: { discovery: { method: 'manual-review' } } }), false)
})

test('a failed external-only refresh preserves later automatic repair eligibility', () => {
  const automated = entry({
    status: 'blocked',
    updatePolicy: 'external-only',
    statusReason: 'Automatic policy blocked installation: runtime source exceeded the bound',
    assurance: { discovery: { method: 'automated-fixed-source-policy-v1' } },
    details: { ...entry().details, reviewStatus: 'automated-scan' },
    risk: { installScripts: [], review: 'automatic-policy-blocked-not-installable' },
  })
  const refreshed = buildCatalogVersionUpdate(
    automated,
    { ...automated, commit: 'b'.repeat(40), version: '1.3.0' },
    { approved: false },
    '2026-08-29T01:00:00Z',
    'external-only',
  )
  assert.equal(refreshed.assurance.discovery.method, 'automated-fixed-source-update-v2')
  assert.equal(isAutomatedPolicyBlocked(refreshed), true)
})

test('a newer fully approved source promotes only an automation-created block', () => {
  const automated = entry({
    status: 'blocked',
    updatePolicy: 'external-only',
    statusReason: 'Automatic policy blocked installation: license mismatch',
    assurance: {
      ...entry().assurance,
      discovery: { status: 'verified', method: 'automated-fixed-source-policy-v1' },
    },
    details: {
      ...entry().details,
      license: 'SEE LICENSE IN LICENSE',
      permissions: { level: 'unknown', files: 'unknown', network: 'unknown', commands: 'unknown', credentials: ['unknown'] },
      externalDependencies: ['legacy-runtime'],
      reviewStatus: 'automated-scan',
    },
    risk: { installScripts: [], review: 'automatic-policy-blocked-not-installable' },
  })
  const candidate = {
    ...automated,
    defaultBranch: 'main',
    commit: 'b'.repeat(40),
    version: '2.0.0',
    compatibility: {
      dsh: '^0.1.1-rc.2',
      dshReleases: { '0.1.1-rc.2': 'compatible' },
      node: '>=24', systems: [], profiles: ['web'],
    },
    details: { ...automated.details, license: 'MIT' },
    risk: { installScripts: [] },
  }
  const updated = buildCatalogVersionUpdate(
    automated,
    candidate,
    { approved: true, sourceUpdatedAt: '2026-08-29T00:00:00Z' },
    '2026-08-29T01:00:00Z',
    'source-verified',
    { promoteAutomatedBlock: true },
  )
  assert.equal(updated.status, 'approved')
  assert.equal(updated.updatePolicy, 'source-verified')
  assert.equal(Object.hasOwn(updated, 'statusReason'), false)
  assert.equal(updated.details.license, 'MIT')
  assert.deepEqual(updated.details.permissions, {
    level: 'low', files: 'none', network: 'none', commands: 'none', credentials: ['none'],
  })
  assert.deepEqual(updated.details.externalDependencies, [])
  assert.equal(updated.risk.review, 'automated-fixed-source-policy-v1')
  assert.equal(updated.compatibility.dshReleases['0.1.1-rc.2'], 'compatible')

  assert.throws(() => buildCatalogVersionUpdate(
    { ...automated, risk: { ...automated.risk, review: 'manual-review' } },
    candidate,
    { approved: true },
    '2026-08-29T01:00:00Z',
    'source-verified',
    { promoteAutomatedBlock: true },
  ), /requires the original automatic block/)
  assert.throws(() => buildCatalogVersionUpdate(
    automated,
    candidate,
    { approved: false },
    '2026-08-29T01:00:00Z',
    'source-verified',
    { promoteAutomatedBlock: true },
  ), /requires the original automatic block/)
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
  assert.equal(updated.assurance.discovery.method, 'automated-fixed-source-update-v2')
  assert.equal(updated.assurance.installability.status, 'unknown')
  assert.equal(updated.assurance.runtime.status, 'unknown')
  assert.equal(updated.compatibility.dshReleases['0.1.1-rc.2'], 'unknown')
  assert.deepEqual(updated.compatibility.dshOperations['0.1.1-rc.2'], {
    install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown',
  })
  assert.deepEqual(updated.risk.installScripts, ['prepare'])
})

test('self-manager version refresh preserves its explicit compatibility matrix', () => {
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
  const candidate = { ...original, commit: 'b'.repeat(40), version: '1.3.0' }
  const updated = buildCatalogVersionUpdate(original, candidate, {}, '2026-08-22T06:00:00Z', 'user-reviewed', {
    preserveCompatibility: true,
  })
  assert.deepEqual(updated.compatibility, original.compatibility)
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
  assert.equal(compatibility.dshOperations['rc.8'].install, 'unknown')
})

test('source compatibility still fails closed on genuinely conflicting aliases', () => {
  assert.throws(() => sourceDeclaredCompatibility(entry(), {
    compatibility: {
      dshReleases: { 'rc.8': 'unknown', '0.1.0-rc.8': 'incompatible' },
    },
  }), /conflicting aliases for 0\.1\.0-rc\.8/)
})
