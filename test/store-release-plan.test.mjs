import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { validateStoreRelease } from '../scripts/verify-store-release-plan.mjs'

test('Store release gate rejects scope, source and output drift using disposable in-memory fixtures', () => {
  const hash = value => createHash('sha256').update(value).digest('hex')
  const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')
  const commit = 'a'.repeat(40), sourceTree = 'b'.repeat(40), sourceHead = 'c'.repeat(40)
  const scanner = Buffer.from('const signature = /fixture-miner/;\n')
  const manifest = { name: 'dsh-safe-plugin-manager', version: '0.9.5', repository: { url: 'git+https://github.com/AI-Scarlett/DSH-Store.git' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }
  const sources = { 'src/submission-security-scan.mjs': scanner, 'package.json': json(manifest) }
  const finding = { file: 'src/submission-security-scan.mjs', line: 58, rule: 'crypto-miner', severity: 'critical' }
  const manager = { id: 'dsh-safe-plugin-manager', commit, version: '0.9.5', status: 'approved', repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store', entryIds: ['dsh-safe-plugin-manager'], compatibility: { dshReleases: { '0.2.1-alpha.4': 'compatible' } } }
  const review = { commit, sourceTree, sourceHead, canonicalPublicRepository: true, manifest,
    analysis: { scanComplete: true, filesScanned: 2, runtimeBytes: 1000, budgetFindings: [], unsupportedFiles: 0,
      sourceEvidence: Object.entries(sources).map(([file, bytes]) => ({ file, sha256: hash(bytes) })),
      signals: { protectedDsh: false }, reviewSignals: { dynamicModuleLoading: false }, securityScan: { findings: [finding], findingsTruncated: false } },
    disposition: { kind: 'scanner-rule-literal', sha256: hash(scanner) },
    findingReviews: [{ ...finding, sha256: hash(scanner), rationale: 'Disposable fixture representing an inert scanner rule signature.' }],
    sourceChecks: ['ubuntu-latest', 'macos-latest', 'windows-latest'].flatMap(os => ['10', '11', '12'].map(pnpm => ({ name: `runtime (${os}, ${pnpm})`, state: 'SUCCESS' }))),
  }
  const reviewPath = 'docs/reviews/store-095-source-review-20261016.json'
  const current = { 'registry/catalog.json': json({ entries: [manager] }), [reviewPath]: json(review) }
  const base = { 'registry/catalog.json': json({ entries: [{ ...manager, version: '0.9.4' }] }), [reviewPath]: null }
  const plan = { schemaVersion: 1, type: 'first-party-store-catalog-release', baseCommit: 'd'.repeat(40), sourceCommit: commit, sourceTree, sourceHead,
    scope: Object.keys(current), preconditions: Object.fromEntries(Object.entries(base).map(([path, bytes]) => [path, bytes === null ? null : hash(bytes)])),
    postconditions: Object.fromEntries(Object.entries(current).map(([path, bytes]) => [path, hash(bytes)])),
    authorization: { source: 'direct-user-request', githubWriteCredential: 'existing-credential-explicitly-authorized', credentialExceptionRequest: '你直接上线啊 不要用短期的' } }
  const run = (paths = Object.keys(current), source = path => sources[path], readCurrent = path => current[path]) => validateStoreRelease(plan, paths, path => base[path], readCurrent, source)
  run()
  const shortLived = structuredClone(plan)
  shortLived.authorization = { source: 'direct-user-request', githubWriteCredential: 'short-lived-token-required' }
  validateStoreRelease(shortLived, Object.keys(current), path => base[path], path => current[path], path => sources[path])
  assert.throws(() => validateStoreRelease({ ...shortLived, version: '0.9.6' }, Object.keys(current), path => base[path], path => current[path], path => sources[path]), /Incomplete/ )
  assert.throws(() => run(['registry/other.json']), /Outside/)
  assert.throws(() => run(undefined, () => Buffer.from('changed')), /Fixed source/)
  assert.throws(() => run(undefined, undefined, path => path === 'registry/catalog.json' ? Buffer.from('changed') : current[path]), /Reviewed content/)
})
