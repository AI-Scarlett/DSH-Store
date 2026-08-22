import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessUpstreamVersion,
  buildCatalogVersionUpdate,
  catalogUpdateIdentityMatches,
  catalogUpdatePolicy,
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
