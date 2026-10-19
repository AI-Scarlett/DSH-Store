import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { bundlePatchContract, patchPackageExports } from '../src/bundle-patch-contract.mjs'
import { SOURCE_SCAN_BOUNDS, SCAN_POLICY_VERSION, sourceBudgetFindings } from '../src/source-scan-policy.mjs'
import { reviewFixedSource } from '../src/fixed-source-review.mjs'
import { admissionBinding, admissionDecision, LICENSE_METADATA_REVIEW_REASON, validateAdmissionReviews } from '../src/admission-review.mjs'
import { catalogIdentityHash, catalogMigrationTarget, migrateCatalogIdentity, validateCatalogMigrations } from '../src/catalog-migration.mjs'
import { missingLocalModuleReasons, packageSourceSurface, SCANNABLE_SOURCE, unsupportedPackageEntry } from '../src/package-source-surface.mjs'
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

test('one Patch may expose a declared subpath of its own package as a second component', () => {
  const patch = '- insert:\n    - id: dsh-model-everything\n      name: dsh-model-everything\n    - id: dsh-model-everything-gate\n      name: dsh-model-everything/gate\n      config:\n        enabled: true\n'
  const contract = bundlePatchContract(patch)
  assert.deepEqual(contract.entryIds, ['dsh-model-everything', 'dsh-model-everything-gate'])
  assert.deepEqual(contract.insertedEntries.map(row => [row.name, row.packageName, row.subpath ?? null]), [
    ['dsh-model-everything', 'dsh-model-everything', null],
    ['dsh-model-everything/gate', 'dsh-model-everything', 'gate'],
  ])
  assert.deepEqual(patchPackageExports({ name: 'dsh-model-everything', exports: { './gate': './lib/gate.js' } }, contract.insertedEntries), [
    { entryId: 'dsh-model-everything-gate', name: 'dsh-model-everything/gate', path: 'lib/gate.js' },
  ])
  assert.deepEqual(patchPackageExports({ name: 'dsh-model-everything', exports: { './gate': { types: './lib/types/gate.d.ts', default: './lib/gate.js' } } }, contract.insertedEntries), [
    { entryId: 'dsh-model-everything-gate', name: 'dsh-model-everything/gate', path: 'lib/gate.js' },
    { entryId: 'dsh-model-everything-gate', name: 'dsh-model-everything/gate', path: 'lib/types/gate.d.ts', kind: 'types' },
  ])
  for (const invalid of [
    '- insert:\n    - id: gate\n      name: dsh-model-everything/gate\n',
    '- insert:\n    - id: root\n      name: dsh-model-everything\n    - id: gate\n      name: dsh-model-everything/../outside\n',
    '- insert:\n    - id: invalid\n      name: .\n',
  ]) assert.throws(() => bundlePatchContract(invalid), { code: 'BUNDLE_PATCH_AMBIGUOUS' })
  assert.throws(() => patchPackageExports({ name: 'dsh-other', exports: { './gate': './lib/gate.js' } }, contract.insertedEntries), { code: 'BUNDLE_PATCH_AMBIGUOUS' })
  assert.throws(() => patchPackageExports({ name: 'dsh-model-everything', exports: { './gate': './../outside.js' } }, contract.insertedEntries), { code: 'BUNDLE_PATCH_AMBIGUOUS' })
  assert.throws(() => patchPackageExports({ name: 'dsh-model-everything', exports: { './gate': { types: './../outside.d.ts', default: './lib/gate.js' } } }, contract.insertedEntries), { code: 'BUNDLE_PATCH_AMBIGUOUS' })
  assert.throws(() => patchPackageExports({ name: 'dsh-model-everything', exports: { './*': './lib/*.js' } }, contract.insertedEntries), { code: 'BUNDLE_PATCH_AMBIGUOUS' })
  assert.throws(() => patchPackageExports({ name: 'dsh-model-everything', exports: { './gate': { require: './lib/gate.js' } } }, contract.insertedEntries), { code: 'BUNDLE_PATCH_AMBIGUOUS' })
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

test('literal commands-service injection is additive metadata, while unknown injection remains blocked (#636)', () => {
  const patch = '- insert:\n    - id: memory-gate\n      name: dsh-memory-gate\n      inject:\n        - commands\n      config:\n        mode: assist\n'
  const result = bundlePatchContract(patch)
  assert.deepEqual(result.entryIds, ['memory-gate'])
  assert.deepEqual(result.insertedEntries[0].inject, ['commands'])
  assert.deepEqual(result.configOverrides, [])
  for (const invalid of [
    patch.replace('- commands', '- unknown-service'),
    patch.replace('- commands', '- commands\n        - commands'),
    patch.replace('inject:\n        - commands', 'inject: commands'),
    patch.replace('inject:\n        - commands', 'inject: !!js anything()'),
    '- id: web\n  inject:\n    - commands\n  config: {}',
    patch.replace('mode: assist', 'mode: assist\n      disabled: true'),
  ]) assert.throws(() => bundlePatchContract(invalid), { code: 'BUNDLE_PATCH_AMBIGUOUS' })
})

test('literal repository and network/storage metadata do not change additive Patch ownership', () => {
  const patch = '- insert:\n    - id: tool-vision\n      name: dsh-plugin-vision\n      repository: Example/plugin\n      permissions:\n        network: true\n        storage: false\n'
  const contract = bundlePatchContract(patch)
  assert.deepEqual(contract.entryIds, ['tool-vision'])
  assert.deepEqual(contract.configOverrides, [])
  for (const invalid of [
    patch.replace('network: true', 'network: granted'),
    patch.replace('storage: false', 'commands: true'),
    patch.replace('Example/plugin', '../outside'),
    '- id: official\n  repository: Example/plugin\n  config: {}',
    patch.replace('permissions:', 'disabled: true\n      permissions:'),
  ]) assert.throws(() => bundlePatchContract(invalid), { code: 'BUNDLE_PATCH_AMBIGUOUS' })
})

test('bounded quoted argument sequences are literal configuration data, never evaluated (#1368)', () => {
  const patch = "- insert:\n    - id: mcp-akasha\n      name: '@akasha-book/mcp'\n      config:\n        command: node\n        args: ['<AKASHA_DIR>/mcp.mjs', \"--stdio\"]\n"
  assert.deepEqual(bundlePatchContract(patch).entryIds, ['mcp-akasha'])
  assert.deepEqual(bundlePatchContract("- insert:\n    - id: memory-gate\n      name: dsh-memory-gate\n      inject: ['commands']\n").insertedEntries[0].inject, ['commands'])
  for (const value of ['[!!js run()]', '[*alias]', '[unquoted]', '[{x: y}]', "['a',]", "['a' 'b']", "['unterminated]", "['a', ['b']]"]) {
    assert.throws(() => bundlePatchContract(patch.replace("['<AKASHA_DIR>/mcp.mjs', \"--stdio\"]", value)), { code: 'BUNDLE_PATCH_AMBIGUOUS' })
  }
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

test('dynamic imports in unreferenced tests do not become runtime findings', async () => {
  const input = {
    'index.js': 'export const ready = true\n',
    'test/plugin-entry.test.mjs': 'await import(target)\n',
  }
  const testManifest = { files: ['index.js', 'test'], main: './index.js' }
  const inspect = (sourceFiles, manifestValue) => reviewFixedSource(candidate, manifestValue, treeOf(sourceFiles), policy, async path => sourceFiles[path])
  const isolated = await inspect(input, testManifest)
  assert.equal(isolated.scanComplete, true)
  assert.equal(isolated.reviewSignals.dynamicModuleLoading, false)
  const exposed = await inspect(input, { ...testManifest, main: './test/plugin-entry.test.mjs' })
  assert.equal(exposed.reviewSignals.dynamicModuleLoading, true)
  const reachable = await inspect({ ...input, 'index.js': "import './test/plugin-entry.test.mjs'\n" }, testManifest)
  assert.equal(reachable.reviewSignals.dynamicModuleLoading, true)
})

test('independent package CLI entrypoints remain in dynamic-loading review', async () => {
  const input = {
    'index.js': 'export const ready = true\n',
    'bin.mjs': "const userHook = await import(resolve(args.visit))\n",
  }
  const testManifest = { files: ['index.js', 'bin.mjs'], main: './index.js', bin: './bin.mjs' }
  const result = await reviewFixedSource(candidate, testManifest, treeOf(input), policy, async path => input[path])
  assert.equal(result.scanComplete, true)
  assert.equal(result.sourceEvidence.some(file => file.file === 'bin.mjs'), true)
  assert.equal(result.reviewSignals.dynamicModuleLoading, true)
})

test('runtime dependency lockfiles are hashed as resolution evidence outside the runtime scan', async () => {
  const input = { 'index.js': 'export const ready = true\n', 'package-lock.json': '{"lockfileVersion":3}\n' }
  const gitBlob = value => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest('hex')
  const tree = { truncated: false, tree: Object.entries(input).map(([path, value]) => ({
    path, size: Buffer.byteLength(value), type: 'blob', mode: '100644', sha: gitBlob(value),
  })) }
  const manifestValue = { files: ['index.js'], main: './index.js', dependencies: { yaml: '2.9.1' } }
  const depPolicy = { ...policy, automaticApproval: { ...policy.automaticApproval, allowRuntimeDependencies: false } }
  const result = await reviewFixedSource(candidate, manifestValue, tree, depPolicy, async path => input[path])
  assert.equal(result.scanComplete, true)
  assert.deepEqual(result.runtimeDependencies, { yaml: '2.9.1' })
  assert.deepEqual(result.sourceEvidence.map(item => item.file), ['index.js'])
  assert.equal(result.resolutionEvidence[0].file, 'package-lock.json')
  assert.match(result.reasons.join('\n'), /runtime or optional dependencies require a separate supply-chain review/)
  const missingTree = { ...tree, tree: tree.tree.filter(item => item.path !== 'package-lock.json') }
  const missing = await reviewFixedSource(candidate, manifestValue, missingTree, depPolicy, async path => input[path])
  assert.match(missing.reasons.join('\n'), /one unambiguous fixed lockfile/)
})

test('NOASSERTION repository metadata can pass only with a hash-bound manual fixed-source license review', async () => {
  const input = { 'index.js': 'export const ready = true\n', LICENSE: 'MIT License\n\nCopyright (c) Example\n' }
  const gitBlob = value => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest('hex')
  const tree = { truncated: false, tree: Object.entries(input).map(([path, value]) => ({
    path, size: Buffer.byteLength(value), type: 'blob', mode: '100644', sha: gitBlob(value),
  })) }
  const manifestValue = { files: ['index.js'], main: './index.js', license: 'MIT' }
  const reviewedCandidate = { ...candidate, details: { license: 'MIT' } }
  const scanned = await reviewFixedSource(reviewedCandidate, manifestValue, tree, policy, async path => input[path])
  assert.deepEqual(scanned.licenseEvidence.map(item => item.file), ['LICENSE'])
  const analysis = { ...scanned, ...clean, sourceDigest: scanned.sourceDigest, licenseEvidence: scanned.licenseEvidence,
    repositoryLicense: 'NOASSERTION', manifestLicense: 'MIT', contractVerified: false,
    contractReasons: [LICENSE_METADATA_REVIEW_REASON], reasons: [...clean.reasons, LICENSE_METADATA_REVIEW_REASON] }
  assert.equal(admissionDecision(reviewedCandidate, analysis).state, 'review-required')
  const evidence = { file: 'LICENSE', sha256: scanned.licenseEvidence[0].sha256, line: 1 }
  const registry = reviewed(analysis, { licenseReview: { license: 'MIT', metadata: 'NOASSERTION', evidence,
    rationale: 'The exact MIT text in the fixed Commit was reviewed; NOASSERTION is unavailable metadata, not a license conflict.' } })
  assert.equal(admissionDecision(reviewedCandidate, analysis, registry).state, 'reviewed')
  assert.equal(admissionDecision(reviewedCandidate, { ...analysis, licenseEvidence: [] }, registry).state, 'review-required')
  const conflict = { ...analysis, contractReasons: ['manifest and GitHub repository license metadata conflict'],
    reasons: [...clean.reasons, 'manifest and GitHub repository license metadata conflict'] }
  assert.equal(admissionDecision(reviewedCandidate, conflict, reviewed(conflict, { licenseReview: registry.reviews[0].licenseReview })).state, 'review-required')
  assert.throws(() => validateAdmissionReviews(reviewed(analysis, { licenseReview: { ...registry.reviews[0].licenseReview, metadata: 'GPL-3.0' } })), /license review/)
})

test('TypeScript NodeNext source imports resolve emitted .js specifiers to TypeScript siblings', () => {
  const entries = [{ type: 'blob', mode: '100644', relativePath: 'src/engine.ts' }]
  assert.deepEqual(missingLocalModuleReasons(['./engine.js'], 'src/tool.ts', entries), [])
  assert.deepEqual(missingLocalModuleReasons(['./engine.js'], 'lib/tool.js', entries), ['local module is missing from the distributable surface: lib/tool.js -> ./engine.js'])
  const diagram = { type: 'blob', mode: '100644', relativePath: 'skills/reference/flow.mmd' }
  assert.equal(SCANNABLE_SOURCE.test(diagram.relativePath), true)
  assert.equal(unsupportedPackageEntry(diagram), false)
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

test('complete fixed source cannot authorize an unreviewed CDN script through the permission-review lane (#910)', async () => {
  const input = { ...files, 'index.js': "const src='https://cdn.example.test/sdk.min.js'; const s=document.createElement('script'); s.src=src; document.head.append(s)" }
  const result = await scan(input)
  assert.equal(result.scanComplete, true)
  assert.equal(result.signals.network, true)
  assert.equal(result.reviewSignals.dynamicModuleLoading, true)
  assert.ok(result.reasons.includes('dynamic module loading or code evaluation requires separate review'))
  const analysis = { ...result, approved: result.reasons.length === 0, contractVerified: true }
  assert.equal(admissionDecision(candidate, analysis).state, 'review-required')
  const registry = reviewed(analysis, { permissions: { level: 'medium', files: 'none', network: 'specified-services', commands: 'none', credentials: ['none'] } })
  assert.equal(admissionDecision(candidate, analysis, registry).state, 'review-required')
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

test('a complete Tool-view ownership review can finish the known-capability lane without permitting official keys', () => {
  const file = { file: 'lib/client.js', sha256: '4'.repeat(64) }
  const tool = { file: 'lib/index.js', sha256: '5'.repeat(64), line: 10 }
  const analysis = { ...clean, sourceEvidence: [file, tool], toolViewEvidence: [file], reasons: [...clean.reasons,
    'Tool-view extension requires key ownership review; registration alone is not a protected component mutation'] }
  const ownership = { key: 'draw_image', owner: candidate.packageName, registration: { ...file, line: 12 }, tool,
    rationale: 'The registered view key belongs to a tool declared in this same fixed package, not an official tool.' }
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis)).state, 'review-required')
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis, { toolViewOwnership: [ownership] })).state, 'reviewed')
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis, { toolViewOwnership: [{ ...ownership, owner: 'another-package' }] })).state, 'review-required')
  assert.equal(admissionDecision(candidate, { ...analysis, toolViewEvidence: [...analysis.toolViewEvidence, { file: 'other.js', sha256: '6'.repeat(64) }] }, reviewed(analysis, { toolViewOwnership: [ownership] })).state, 'review-required')
  assert.throws(() => validateAdmissionReviews(reviewed(analysis, { toolViewOwnership: [{ ...ownership, key: 'bash' }] })), /ownership/)
})

test('a credential false positive needs exact evidence for every observed file and cannot mask another source', () => {
  const f = { file: 'lib/paths.js', sha256: '6'.repeat(64), line: 4 }
  const analysis = { ...clean, signals: { ...clean.signals, credentials: true }, sourceEvidence: [f], capabilityEvidence: [{ ...f, signal: 'credentials' }],
    reasons: [...clean.reasons, 'runtime source contains the credentials permission signal'] }
  const d = { ...f, signal: 'credentials', kind: 'false-positive', rationale: 'This exact module reads only executable and home directory paths, not credentials.' }
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis)).state, 'review-required')
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis, { capabilityDispositions: [d] })).state, 'reviewed')
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis, { capabilityDispositions: [{ ...d, sha256: '9'.repeat(64) }] })).state, 'review-required')
  const other = { ...analysis, capabilityEvidence: [...analysis.capabilityEvidence, { file: 'secret.js', line: 1, signal: 'credentials' }] }
  assert.equal(admissionDecision(candidate, other, reviewed(other, { capabilityDispositions: [d] })).state, 'review-required')
})

test('manual fixed-source review can declare a web-session token as a distinct credential capability', () => {
  const f = { file: 'lib/login-store.js', sha256: '6'.repeat(64), line: 12 }
  const analysis = { ...clean, signals: { ...clean.signals, credentials: true }, sourceEvidence: [f],
    capabilityEvidence: [{ ...f, signal: 'credentials' }],
    reasons: [...clean.reasons, 'runtime source contains the credentials permission signal'] }
  const permissions = { level: 'high', files: 'read-only', network: 'none', commands: 'none', credentials: ['web-session-token'] }
  const registry = reviewed(analysis, { permissions })
  assert.doesNotThrow(() => validateAdmissionReviews(registry))
  assert.equal(admissionDecision(candidate, analysis, registry).state, 'reviewed')
})

test('dependencies require an independently reviewed complete source closure and an installation resolution bound to source', () => {
  const proof = { file: 'package-lock.json', sha256: '7'.repeat(64), line: 1, rationale: 'Reviewed installed dependency resolution is constrained to this exact immutable package closure.' }
  const files = [{ file: 'index.js', sha256: '8'.repeat(64), bytes: 12 }]
  const node = { name: 'dependency', version: '1.2.3', repositoryUrl: 'https://github.com/example/dependency', commit: 'd'.repeat(40),
    sourceDigest: createHash('sha256').update(JSON.stringify(files)).digest('hex'), license: 'MIT', installScriptsReviewed: 'none', files, dependencies: [],
    coverage: 'complete', securityVerdict: 'pass', moduleLoading: 'static', signals: { files: false, network: false, commands: false, credentials: false, protectedDsh: false, nativeOrExecutableArtifacts: false },
    distribution: { registryUrl: 'https://registry.npmjs.org/dependency/-/dependency-1.2.3.tgz', integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      shasum: 'e'.repeat(40), tarballSha256: 'f'.repeat(64), tarballBytes: 1024, archiveEntries: 3, uncompressedBytes: 64 },
    rationale: 'Complete pinned dependency distribution inspected without executing any package code.' }
  const analysis = { ...clean, runtimeDependencies: { dependency: '1.2.3' }, sourceEvidence: [],
    resolutionEvidence: [{ file: proof.file, bytes: 20, blob: 'c'.repeat(40), sha256: proof.sha256 }],
    reasons: [...clean.reasons, 'runtime or optional dependencies require a separate supply-chain review'] }
  const supplyChain = { complete: true, direct: { dependency: '1.2.3' }, installResolution: proof, packages: [node] }
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis)).state, 'review-required')
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis, { supplyChain })).state, 'reviewed')
  const unboundLicenseOnly = { ...analysis, resolutionEvidence: [], licenseEvidence: [{ file: 'LICENSE', bytes: 12,
    blob: 'a'.repeat(40), sha256: proof.sha256 }] }
  const falselyBound = { ...supplyChain, installResolution: { ...proof, file: 'LICENSE' } }
  assert.equal(admissionDecision(candidate, unboundLicenseOnly, reviewed(unboundLicenseOnly, { supplyChain: falselyBound })).state, 'review-required')
  assert.equal(admissionDecision(candidate, { ...analysis, reviewSignals: { dynamicModuleLoading: true } },
    reviewed({ ...analysis, reviewSignals: { dynamicModuleLoading: true } }, { supplyChain })).state, 'review-required')
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis, { supplyChain: { ...supplyChain, direct: { dependency: '1.2.4' } } })).state, 'review-required')
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis, { supplyChain: { ...supplyChain, packages: [{ ...node, dependencies: ['missing@2.0.0'] }] } })).state, 'review-required')
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis, { supplyChain: { ...supplyChain, installResolution: { ...proof, sha256: 'f'.repeat(64) } } })).state, 'review-required')
  assert.throws(() => validateAdmissionReviews(reviewed(analysis, { supplyChain: { ...supplyChain, packages: [{ ...node, sourceDigest: '0'.repeat(64) }] } })), /supply-chain/)
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis, { supplyChain: { ...supplyChain, packages: [{ ...node, signals: { ...node.signals, protectedDsh: true } }] } })).state, 'review-required')
  assert.equal(admissionDecision(candidate, analysis, reviewed(analysis, { supplyChain: { ...supplyChain, packages: [{ ...node, signals: { ...node.signals, network: true } }] } })).state, 'review-required')
  const dynamic = { ...analysis, reasons: [...analysis.reasons, 'dynamic module loading or code evaluation requires separate review'] }
  assert.equal(admissionDecision(candidate, dynamic, reviewed(dynamic, { supplyChain })).state, 'review-required')

  const dependencyFiles = [
    { file: 'index.js', sha256: '8'.repeat(64), bytes: 12 },
    { file: 'package.json', sha256: '9'.repeat(64), bytes: 16 },
    { file: 'bin/cli.mjs', sha256: 'a'.repeat(64), bytes: 30 },
  ]
  const reviewedBinNode = { ...node, files: dependencyFiles,
    sourceDigest: createHash('sha256').update(JSON.stringify(dependencyFiles)).digest('hex'),
    moduleLoading: 'static-node-library-reviewed-bin', runtimeContext: 'node-library', runtimeEntryFiles: ['index.js'],
    binEntrypointReview: { complete: true, packageManifest: { file: 'package.json', sha256: '9'.repeat(64), line: 1 },
      files: [{ file: 'bin/cli.mjs', sha256: 'a'.repeat(64) }],
      bins: [{ name: 'yaml', file: 'bin/cli.mjs', sha256: 'a'.repeat(64), rationale: 'The explicit CLI only loads local parser helpers when a user invokes the executable.' }],
      rationale: 'The npm manifest bin map and every declared CLI target were reviewed against the complete hashed tarball file list.' } }
  const reviewedBinChain = { ...supplyChain, packages: [reviewedBinNode] }
  const reviewedBinRegistry = reviewed(analysis, { supplyChain: reviewedBinChain })
  assert.equal(validateAdmissionReviews(reviewedBinRegistry), reviewedBinRegistry)
  assert.equal(admissionDecision(candidate, analysis, reviewedBinRegistry).state, 'reviewed')
  assert.throws(() => validateAdmissionReviews(reviewed(analysis, { supplyChain: { ...supplyChain,
    packages: [{ ...reviewedBinNode, binEntrypointReview: { ...reviewedBinNode.binEntrypointReview,
      bins: [{ ...reviewedBinNode.binEntrypointReview.bins[0], sha256: 'b'.repeat(64) }] } }] } })), /runtime supply-chain review/)
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
  registry.migrations[0].to.entryIds = ['renamed-demo']
  assert.deepEqual(migrateCatalogIdentity(entry, snapshot, { name: '@scope/dsh-demo', license: 'MIT' }, registry).entry.entryIds, ['renamed-demo'])
  registry.migrations[0].to.entryIds = ['bad/id']
  assert.throws(() => validateCatalogMigrations(registry))
  delete registry.migrations[0].to.entryIds
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

test('declaration imports resolve declaration siblings without hiding missing runtime JS (#1411, #1296)', async () => {
  const { missingLocalModuleReasons, unsupportedPackageEntry } = await import('../src/package-source-surface.mjs')
  const entries = [{ type: 'blob', mode: '100644', relativePath: 'lib/types/index.d.ts' }]
  assert.deepEqual(missingLocalModuleReasons(['../index.js'], 'lib/types/client/index.d.ts', entries), [])
  assert.deepEqual(missingLocalModuleReasons(['../index.ts'], 'lib/types/client/index.d.ts', entries), [])
  assert.equal(missingLocalModuleReasons(['../index.ts'], 'lib/types/client/index.js', entries).length, 1)
  assert.equal(missingLocalModuleReasons(['../index.js'], 'lib/types/client/index.js', entries).length, 1)
  assert.equal(missingLocalModuleReasons(['../../../../outside.js'], 'lib/types/client/index.d.ts', entries).length, 1)
  for (const name of ['NOTICE', 'skills/example/UPSTREAM_LICENSE']) assert.equal(unsupportedPackageEntry({ type: 'blob', mode: '100644', relativePath: name }), false)
  assert.equal(unsupportedPackageEntry({ type: 'blob', mode: '100644', relativePath: 'unknown-artifact' }), true)
})

test('repository rebind requires immutable source and owner identities and remains exact-Commit scoped', async () => {
  const { catalogMigrationSource, verifyMigrationRepositories } = await import('../src/catalog-migration.mjs')
  const entry = { ...candidate, defaultBranch: 'main', details: { license: 'MIT' } }
  const r = { id: entry.id, repositoryUrl: entry.repositoryUrl, fromCommit: entry.commit, toCommit: 'b'.repeat(40),
    previousIdentityHash: catalogIdentityHash(entry), reviewer: 'fixture-reviewer', reviewedAt: '2026-10-15T00:00:00Z',
    rationale: 'Author explicitly requested the stable repository identity for this same package.', evidenceUrls: ['https://github.com/example/demo/issues/1'],
    from: { packageName: entry.packageName, manifestPath: entry.manifestPath, license: 'MIT' },
    to: { repositoryUrl: 'https://github.com/example/stable', defaultBranch: 'master', packageName: entry.packageName, manifestPath: 'package.json', license: 'MIT' },
    repositoryIdentity: { fromId: 101, toId: 102, ownerUserId: 42 } }
  const registry = { schemaVersion: 1, migrations: [r] }
  const from = { id: 101, owner: { id: 42 } }, to = { id: 102, owner: { id: 42 }, html_url: r.to.repositoryUrl, default_branch: 'master' }
  assert.equal(catalogMigrationSource(entry, registry).repositoryUrl, r.to.repositoryUrl)
  verifyMigrationRepositories(r, from, to)
  assert.throws(() => verifyMigrationRepositories(r, from, { ...to, owner: { id: 43 } }), /identity/)
  assert.throws(() => verifyMigrationRepositories(r, from, { ...to, id: 999 }), /identity/)
  const snapshot = { commit: r.toCommit, repositoryUrl: r.to.repositoryUrl }
  assert.equal(migrateCatalogIdentity(entry, snapshot, { name: entry.packageName, license: 'MIT' }, registry).entry.repositoryUrl, r.to.repositoryUrl)
  assert.equal(migrateCatalogIdentity(entry, { ...snapshot, repositoryUrl: entry.repositoryUrl }, {}, registry).applied, false)
  assert.throws(() => catalogMigrationSource(entry, { ...registry, migrations: [r, { ...r, toCommit: 'c'.repeat(40) }] }), /ambiguous/)
})

test('missing literal runtime dependencies make coverage incomplete even when every visible file was read', async () => {
  const input = { ...files, 'index.js': "import './absent.js'" }
  const result = await scan(input)
  assert.equal(result.filesScanned, 5)
  assert.equal(result.scanComplete, false)
  assert.match(result.reasons.join('\n'), /local module is missing/)
})

test('literal indentless YAML insertion sequence is valid while selectors, mixed roots and tags remain blocked (#1279)', () => {
  assert.deepEqual(bundlePatchContract("- insert:\n  - id: dsh-tavily\n    name: '@moguiyu/dsh-tavily'\n").entryIds, ['dsh-tavily'])
  assert.deepEqual(bundlePatchContract('- insert:\n  - id: demo\n    name: dsh-demo\n    config:\n      tags:\n      - one\n      - two\n      mode: literal\n').entryIds, ['demo'])
  for (const patch of ['- insert:\n  - id: x\n    name: dsh-x\n  config: {}', '- insert: []\nother: value', '- insert:\n  - id: x\n    name: dsh-x\n    config:\n      path: !!js anything()']) assert.throws(() => bundlePatchContract(patch))
})

test('recognized notice filenames are scanned as potential code rather than granting an unobserved runtime escape', async () => {
  const result = await scan({ ...files, NOTICE: "fetch('https://example.test')" })
  assert.equal(result.scanComplete, true)
  assert.equal(result.filesScanned, 6)
  assert.equal(result.signals.network, true)
  const missing = await scan({ ...files, NOTICE: "require('./hidden-code')" })
  assert.equal(missing.scanComplete, false)
  assert.match(missing.reasons.join('\n'), /NOTICE -> .\/hidden-code/)
})
