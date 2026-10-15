import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { bundlePatchContract } from '../src/bundle-patch-contract.mjs'
import { SOURCE_SCAN_BOUNDS, SCAN_POLICY_VERSION, sourceBudgetFindings } from '../src/source-scan-policy.mjs'
import { reviewFixedSource } from '../src/fixed-source-review.mjs'
import { admissionBinding, admissionDecision, validateAdmissionReviews } from '../src/admission-review.mjs'
import { catalogIdentityHash, catalogMigrationTarget, migrateCatalogIdentity, validateCatalogMigrations } from '../src/catalog-migration.mjs'
import { packageSourceSurface } from '../src/package-source-surface.mjs'
import { permissionSignals } from '../src/automation-source-policy.mjs'
import { applyLatestDshCompatibilityPolicy } from '../src/catalog-compatibility-policy.mjs'
import { exactHostCompatibility } from '../src/catalog.mjs'
import { reassessCatalog } from '../scripts/reassess-admission.mjs'

const candidate = { id: 'demo', repositoryUrl: 'https://github.com/example/demo', commit: 'a'.repeat(40), manifestPath: 'package.json', packageName: 'dsh-demo', version: '1.0.0', entryIds: ['demo'] }
const policy = { sourceBounds: SOURCE_SCAN_BOUNDS, automaticApproval: { allowSymlinks: false, allowSubmodules: false, permissionSignals: { files: false, network: false, commands: false, credentials: false, protectedDsh: false } } }
const manifest = { files: ['index.js', 'lib', 'locale', 'cordis.patch.yml'], main: './index.js', exports: { './locale/*.json': './locale/*.json' } }
const files = { 'package.json': JSON.stringify(manifest), 'index.js': 'export const demo = true', 'lib/client.js': '/*' + 'x'.repeat(442971) + '*/', 'locale/en.json': '{}', 'cordis.patch.yml': '- insert: []' }
function treeOf(input) { return { truncated: false, tree: Object.entries(input).map(([path, text]) => ({ path, size: Buffer.byteLength(text), type: 'blob', mode: '100644' })) } }
async function scan(input = files, bounds = SOURCE_SCAN_BOUNDS, tree = treeOf(input)) {
  return reviewFixedSource(candidate, manifest, tree, { ...policy, sourceBounds: bounds }, async path => input[path])
}
const clean = { approved: false, contractVerified: true, scanComplete: true, sourceDigest: '1'.repeat(64), policyDigest: '2'.repeat(64),
  signals: { files: true, network: false, commands: false, credentials: false, protectedDsh: false },
  reasons: ['runtime source contains the files permission signal'], securityScan: { verdict: 'pass', findings: [] }, sourceEvidence: [] }
function reviewed(analysis = clean, overrides = {}) {
  return { schemaVersion: 1, policyVersion: SCAN_POLICY_VERSION, reviews: [{ repositoryUrl: candidate.repositoryUrl, commit: candidate.commit,
    binding: admissionBinding(candidate, analysis), verdict: 'approved', reviewer: 'fixture-reviewer', reviewedAt: '2026-10-15T00:00:00Z',
    rationale: 'Reviewed complete immutable source and bounded permission usage.', evidenceUrls: [`${candidate.repositoryUrl}/commit/${candidate.commit}`],
    permissions: { level: 'medium', files: 'read-only', network: 'none', commands: 'none', credentials: ['none'] }, ...overrides }] }
}

test('configuration targets and nested config IDs never acquire inserted entry ownership (#1415)', () => {
  const result = bundlePatchContract('- id: web\n  config:\n    searchProvider: aggregated\n    fetchProvider: aggregated\n    nested:\n      id: not-owned\n- insert:\n    - id: web-search-fetch\n      name: dsh-web-search-fetch\n      config:\n        id: config-only\n')
  assert.deepEqual(result.entryIds, ['web-search-fetch'])
  assert.deepEqual(result.configOverrides.map(r => r.id), ['web'])
  assert.equal(result.configOverrides[0].replacesEntireConfig, true)
})

test('ambiguous, duplicate, disabled, tagged and malformed operations cannot be interpreted as additive', () => {
  for (const source of [
    '- id: web\n  name: dsh-evil', '- id: web\n  disabled: true', '- id: web\n  insert: []', '- insert: [{id: x}]',
    '- insert:\n    - id: x\n      name: dsh-x\n      disabled: true',
    '- insert:\n    - id: x\n      name: dsh-x\n      name: dsh-y',
    '- id: x\n  config: &alias\n    foo: bar', '- id: x\n  config:\n    foo: *alias',
    '- id: x\n  config:\n    foo: one\n      hidden: two', '- id: x\n  config:\n    foo: "unterminated',
    '- id: x\n  config:\n    foo: one\n    foo: two',
  ]) assert.throws(() => bundlePatchContract(source), { code: 'BUNDLE_PATCH_AMBIGUOUS' }, source)
})

test('bounded locale exports and 442975-byte bundle are fully scanned without source restructuring (#1411)', async () => {
  assert.equal(Buffer.byteLength(files['lib/client.js']), 442975)
  const result = await scan()
  assert.equal(result.scanComplete, true)
  assert.equal(result.filesScanned, 5)
  assert.deepEqual(result.budgetFindings, [])
  assert.equal(result.sourceEvidence.length, 5)
  assert.ok(result.sourceEvidence.every(r => /^[a-f0-9]{64}$/.test(r.sha256)))
  for (const path of ['./locale/../*.json', './missing/*.json', './locale/**.json']) {
    assert.equal(packageSourceSurface({ ...manifest, exports: path }, treeOf(files)).complete, false)
  }
  assert.equal(packageSourceSurface({ ...manifest, files: ['index.js'], exports: './locale/*.json' }, treeOf(files)).complete, false)
})

test('partial scan reports true observed signals, separate file/total limits, and unknown negatives', async () => {
  const input = { ...files, 'index.js': 'fetch(endpoint)' }
  const result = await scan(input, { ...SOURCE_SCAN_BOUNDS, maxFileBytes: 1000 })
  assert.equal(result.scanComplete, false)
  assert.equal(result.filesScanned, 4)
  assert.equal(result.signals.network, true)
  assert.equal(result.signals.commands, null)
  assert.equal(result.budgetFindings[0].rule, 'source-file-bytes')
  assert.equal(result.budgetFindings[0].responsibility, 'store-scanner')
  assert.equal(result.budgetFindings[0].actual, 442975)
  assert.equal(result.capabilityEvidence.find(r => r.signal === 'network').line, 1)
  assert.ok(sourceBudgetFindings(treeOf(input).tree, { ...SOURCE_SCAN_BOUNDS, maxFileBytes: 1000, maxTotalRuntimeBytes: 2000 }).findings.some(r => r.rule === 'source-total-bytes'))
})

test('fixed tree bytes and blob identity must both match before evidence is accepted', async () => {
  const tree = treeOf(files)
  tree.tree[0].sha = 'f'.repeat(40)
  const result = await scan(files, SOURCE_SCAN_BOUNDS, tree)
  assert.equal(result.scanComplete, false)
  assert.match(result.reasons.join('\n'), /blob hash does not match/)
})

test('known noncredential environment keys are distinguished from unknown or secret access', () => {
  assert.equal(permissionSignals('const home = process.env.DSH_HOME', 'index.js').credentials, false)
  assert.equal(permissionSignals('const home = process.env.DSH_HOME', 'index.js').files, true)
  for (const source of ['const token = process.env.API_KEY', 'const env = process.env', 'process.env[name]', 'const { API_KEY } = process.env']) assert.equal(permissionSignals(source, 'index.js').credentials, true)
})

test('complete reviewed capability lane is bound to Commit, policy, source, operations and observed permissions', () => {
  assert.equal(admissionDecision(candidate, clean).state, 'review-required')
  const registry = reviewed()
  assert.equal(admissionDecision(candidate, clean, registry).state, 'reviewed')
  for (const analysis of [{ ...clean, sourceDigest: '3'.repeat(64) }, { ...clean, policyDigest: '4'.repeat(64) }, { ...clean, scanComplete: false }, { ...clean, contractVerified: false }]) assert.notEqual(admissionDecision(candidate, analysis, registry).state, 'reviewed')
  assert.notEqual(admissionDecision({ ...candidate, commit: 'b'.repeat(40) }, clean, registry).state, 'reviewed')
  assert.notEqual(admissionDecision({ ...candidate, configOverrides: ['web'] }, clean, registry).state, 'reviewed')
  const contradictory = reviewed(clean, { permissions: { ...registry.reviews[0].permissions, files: 'none' } })
  assert.equal(admissionDecision(candidate, clean, contradictory).state, 'review-required')
  for (const reason of ['dynamic module loading or code evaluation requires separate review', 'runtime or optional dependencies require a separate supply-chain review', 'install lifecycle scripts are present: prepare']) {
    const analysis = { ...clean, reasons: [reason] }
    assert.equal(admissionDecision(candidate, analysis, reviewed(analysis)).state, 'review-required')
  }
  assert.throws(() => validateAdmissionReviews(reviewed(clean, { repositoryUrl: 'https://github.com/example/demo/extra' })))
})

test('synthetic secret findings need an exact reviewed rule, line and source hash; directory names grant no exception', () => {
  const sha256 = createHash('sha256').update('synthetic fixture').digest('hex')
  const analysis = { ...clean, sourceEvidence: [{ file: 'tests/fixture.js', sha256 }],
    reasons: [...clean.reasons, 'fixed-source security findings require quarantine'],
    securityScan: { verdict: 'fail', findings: [{ rule: 'service-secret', file: 'tests/fixture.js', line: 7, severity: 'critical' }] } }
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis)).state, 'rejected')
  const registry = reviewed(analysis, { dispositions: [{ kind: 'synthetic-fixture', file: 'tests/fixture.js', rule: 'service-secret', line: 7, sha256, rationale: 'Synthetic literal has no real credential and is an exact fixed-source fixture.' }] })
  assert.equal(admissionDecision(candidate, analysis, registry).state, 'reviewed')
  registry.reviews[0].dispositions[0].line = 8
  assert.equal(admissionDecision(candidate, analysis, registry).state, 'rejected')
  const protectedAnalysis = { ...clean, signals: { ...clean.signals, protectedDsh: true } }
  assert.equal(admissionDecision(candidate, protectedAnalysis, reviewed(protectedAnalysis)).state, 'rejected')
})

test('identity migration binds old identity, exact pair and new source; migration never grants admission', () => {
  const entry = { ...candidate, details: { license: 'MIT' } }
  const snapshot = { commit: 'b'.repeat(40) }
  const registry = { schemaVersion: 1, migrations: [{ id: entry.id, repositoryUrl: entry.repositoryUrl, fromCommit: entry.commit, toCommit: snapshot.commit,
    previousIdentityHash: catalogIdentityHash(entry), reviewer: 'fixture-reviewer', reviewedAt: '2026-10-15T00:00:00Z', rationale: 'Author renamed the package and moved its manifest at this exact source.', evidenceUrls: [`${candidate.repositoryUrl}/commit/${snapshot.commit}`],
    from: { packageName: 'dsh-demo', manifestPath: 'package.json', license: 'MIT' }, to: { packageName: '@scope/dsh-demo', manifestPath: 'plugin/package.json', installPath: 'plugin', license: 'MIT' } }] }
  assert.equal(catalogMigrationTarget(entry, snapshot, registry).manifestPath, 'plugin/package.json')
  const result = migrateCatalogIdentity(entry, snapshot, { name: '@scope/dsh-demo', license: 'MIT' }, registry)
  assert.equal(result.applied, true)
  assert.equal(result.entry.status, undefined)
  assert.equal(result.entry.packageName, '@scope/dsh-demo')
  assert.equal(migrateCatalogIdentity({ ...entry, version: '2.0.0' }, { commit: 'c'.repeat(40) }, {}, registry).applied, false)
  assert.throws(() => migrateCatalogIdentity(entry, snapshot, { name: 'wrong', license: 'MIT' }, registry), /preconditions/)
  registry.migrations[0].to.manifestPath = '../outside'
  assert.throws(() => validateCatalogMigrations(registry))
})

test('latest-three is a recheck window while exact historical host evidence controls installation', () => {
  const entry = { ...candidate, status: 'approved', compatibility: { dshReleases: { '0.1.0': 'compatible' } } }
  const report = applyLatestDshCompatibilityPolicy({ entries: [entry] }, { entries: [] }, { authority: 'fixture', releases: ['0.2.0', '0.2.1', '0.2.2'], releaseCount: 3 }, '2026-10-15T00:00:00Z')
  assert.equal(entry.status, 'approved')
  assert.equal(entry.compatibility.latestWindow.state, 'recheck-required')
  assert.equal(report.stale.length, 1)
  assert.equal(exactHostCompatibility(entry, '0.1.0').status, 'compatible')
  assert.equal(exactHostCompatibility(entry, '0.2.2').status, 'unknown')
  const census = reassessCatalog({ entries: [entry] })
  assert.equal(census.sourceReview, 'not-performed')
  assert.equal(census.records[0].installabilityChanged, false)
})
