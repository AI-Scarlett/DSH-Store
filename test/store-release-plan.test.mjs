import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { validateStoreRelease } from '../scripts/verify-store-release-plan.mjs'

test('Store release gate binds fixed source, exact latest-three compatibility and output hashes', () => {
  const hash = value => createHash('sha256').update(value).digest('hex')
  const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')
  const commit = 'a'.repeat(40), sourceTree = 'b'.repeat(40), sourceHead = 'c'.repeat(40)
  const releases = ['0.2.1-rc.3', '0.2.1-rc.4', '0.2.2-alpha.2']
  const operations = Object.fromEntries(releases.map(release => [release, {
    install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'unknown',
  }]))
  const manifest = {
    name: 'dsh-safe-plugin-manager', version: '0.9.11',
    repository: { url: 'git+https://github.com/AI-Scarlett/DSH-Store.git' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, compatibility: {
      dsh: '0.0.1-rc.5 || 0.2.1-rc.3 || 0.2.1-rc.4 || 0.2.2-alpha.2',
      dshReleases: Object.fromEntries(releases.map(release => [release, 'compatible'])),
      dshOperations: operations,
    } },
  }
  const scanner = Buffer.from('const scanner = /fixture-miner/;\n')
  const sources = { 'src/submission-security-scan.mjs': scanner, 'package.json': json(manifest) }
  const finding = { file: 'src/submission-security-scan.mjs', line: 58, rule: 'crypto-miner', severity: 'critical' }
  const permissions = { level: 'high', files: 'write', network: 'specified-services', commands: 'restricted', credentials: ['none'] }
  const manager = {
    id: 'dsh-safe-plugin-manager', commit, version: '0.9.11', status: 'approved',
    repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store', entryIds: ['dsh-safe-plugin-manager'],
    compatibility: {
      dsh: manifest.dsh.compatibility.dsh,
      dshReleases: Object.fromEntries(releases.map(release => [release, 'compatible'])),
      latestWindow: { state: 'current', releases },
    },
  }
  const review = {
    commit, sourceTree, sourceHead, canonicalPublicRepository: true, manifest,
    analysis: {
      scanComplete: true, filesScanned: 2, runtimeBytes: 1000, budgetFindings: [], unsupportedFiles: 0,
      sourceEvidence: Object.entries(sources).map(([file, bytes]) => ({ file, sha256: hash(bytes) })),
      signals: { protectedDsh: false },
      reviewSignals: { dynamicModuleLoading: false, toolViewExtension: false },
      securityScan: { findings: [finding], findingsTruncated: false },
      toolViewEvidence: [], runtimeEntryFiles: [], binEntryFiles: [],
    },
    disposition: { kind: 'scanner-rule-literal', sha256: hash(scanner) },
    findingReviews: [{ ...finding, sha256: hash(scanner), rationale: 'Disposable fixture of an inert scanner rule signature, not a mining implementation.' }],
    sourceChecks: ['ubuntu-latest', 'macos-latest', 'windows-latest'].flatMap(os =>
      ['10', '11', '12'].map(pnpm => ({ name: 'runtime (' + os + ', ' + pnpm + ')', state: 'SUCCESS' }))),
    ownerReview: {
      decision: 'pin-existing-first-party-catalog-entry',
      status: 'approved-with-existing-elevated-permissions',
      commit, automaticThirdPartyAdmission: false, compatibilityWindow: releases,
      permissionReview: { declared: permissions },
      toolViewReview: { status: 'serialized-review-data-only', evidence: [] },
      realDesktopUi: 'unverified', realProfile: 'unchanged', independentSecurityAudit: 'not-performed',
    },
  }
  const reviewPath = 'docs/reviews/store-0911-source-review-20261028.json'
  const detailPath = 'registry/catalog/details/dsh-safe-plugin-manager.json'
  const detail = { details: { permissions }, compatibility: { dshOperations: operations } }
  const current = {
    'registry/catalog.json': json({ entries: [manager] }),
    [reviewPath]: json(review),
    [detailPath]: json(detail),
  }
  const base = {
    'registry/catalog.json': json({ entries: [{ ...manager, version: '0.9.10' }] }),
    [reviewPath]: null,
    [detailPath]: json({ details: { permissions }, compatibility: { dshOperations: {} } }),
  }
  const plan = {
    schemaVersion: 1, type: 'first-party-store-catalog-release',
    planPath: 'docs/ops/store-0911-catalog-20261028.json',
    sourceReviewPath: reviewPath, version: '0.9.11',
    targetDshRelease: releases[2], latestDshWindow: releases, reviewMode: 'first-party-owner-reviewed',
    baseCommit: 'd'.repeat(40), sourceCommit: commit, sourceTree, sourceHead,
    scope: Object.keys(current),
    preconditions: Object.fromEntries(Object.entries(base).map(([path, bytes]) => [path, bytes === null ? null : hash(bytes)])),
    postconditions: Object.fromEntries(Object.entries(current).map(([path, bytes]) => [path, hash(bytes)])),
    authorization: { source: 'direct-user-request', githubWriteCredential: 'short-lived-token-required' },
  }
  const readBase = path => base[path]
  const readCurrent = path => current[path]
  const sourceFile = path => sources[path]
  const run = paths => validateStoreRelease(plan, paths ?? Object.keys(current), readBase, readCurrent, sourceFile)
  run()
  const mismatchedWindow = structuredClone(plan)
  mismatchedWindow.latestDshWindow[2] = '0.2.2-alpha.3'
  assert.throws(() => validateStoreRelease(mismatchedWindow, Object.keys(current), readBase, readCurrent, sourceFile), /exact DSH|Catalog target/)
  const longLivedCredential = structuredClone(plan)
  longLivedCredential.authorization.githubWriteCredential = 'existing-credential-explicitly-authorized'
  assert.throws(() => validateStoreRelease(longLivedCredential, Object.keys(current), readBase, readCurrent, sourceFile), /Invalid first-party/)
  assert.throws(() => run(['registry/other.json']), /Outside/)
  assert.throws(() => validateStoreRelease(plan, Object.keys(current), readBase, readCurrent, () => Buffer.from('changed')), /Fixed source/)
  assert.throws(() => validateStoreRelease(plan, Object.keys(current), readBase,
    path => path === 'registry/catalog.json' ? Buffer.from('changed') : readCurrent(path), sourceFile), /Reviewed content/)
})
