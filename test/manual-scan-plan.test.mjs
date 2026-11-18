import assert from 'node:assert/strict'
import test from 'node:test'
import { validateManualScanPlan } from '../scripts/manual-scan-plan.mjs'

const digest = 'a'.repeat(64)
const releases = ['0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3']

function planFixture() {
  return {
    schemaVersion: 1,
    type: 'manual-dsh-known-plugin-rescan',
    scan: {
      status: 'complete',
      planId: 'manual-dsh-scan-20261114',
      baseCommit: 'b'.repeat(40),
      sourceUrl: 'https://cdn.dsh.so/plugins-index.json',
      sourceGeneratedAt: '2026-11-14T00:29:40.007Z',
      sourceIndexSha256: digest,
      mainResultsSha256: 'c'.repeat(64),
      supplementalResultsSha256: 'd'.repeat(64),
      officialWindowSha256: 'e'.repeat(64),
      targetCount: 1,
      completedTargetCount: 1,
      outcomes: { eligible: 1 },
      latestDshReleases: releases,
      selectedCount: 1,
    },
    selected: [{
      repositoryUrl: 'https://github.com/example/dsh-plugin',
      commit: 'f'.repeat(40),
      packageName: 'dsh-plugin',
      version: '1.2.3',
      manifestPath: 'package.json',
      entryIds: ['dsh-plugin-entry'],
      outcome: 'eligible',
      scanComplete: true,
      admissionState: 'source-verified',
      sourceBinding: '1'.repeat(64),
      sourceDigest: '2'.repeat(64),
      compatibility: {
        dsh: '>=0.2.2-rc.1',
        dshReleases: {
          '0.2.2-rc.1': 'compatible',
          '0.2.2-rc.2': 'unknown',
          '0.2.2-rc.3': 'unknown',
        },
      },
    }],
  }
}

test('manual scan plans bind a complete scan and immutable eligible sources', () => {
  const validated = validateManualScanPlan(planFixture())
  assert.equal(validated.selected[0].repositoryUrl, 'https://github.com/example/dsh-plugin')
  assert.deepEqual(validated.scan.latestDshReleases, releases)
})

test('manual scan plan rejects incomplete scans, malformed commits, and compatibility outside the scanned window', () => {
  const pending = planFixture()
  pending.scan.outcomes = { eligible: 0, 'pending-transient': 1 }
  assert.throws(() => validateManualScanPlan(pending), /outcome counts must cover all targets with no pending transient result/)

  const mutableCommit = planFixture()
  mutableCommit.selected[0].commit = 'main'
  assert.throws(() => validateManualScanPlan(mutableCommit), /Commit must be full and immutable/)

  const oldCompatibility = planFixture()
  oldCompatibility.selected[0].compatibility.dshReleases = { '0.1.9-rc.1': 'compatible' }
  assert.throws(() => validateManualScanPlan(oldCompatibility), /no compatible result in the scanned official latest-three window/)
})

test('manual scan plan rejects duplicate bundle IDs and noncanonical repositories', () => {
  const duplicate = planFixture()
  duplicate.selected.push({
    ...duplicate.selected[0],
    repositoryUrl: 'https://github.com/other/dsh-plugin',
    commit: '3'.repeat(40),
  })
  duplicate.scan.targetCount = 2
  duplicate.scan.completedTargetCount = 2
  duplicate.scan.outcomes = { eligible: 2 }
  duplicate.scan.selectedCount = 2
  assert.throws(() => validateManualScanPlan(duplicate), /selected Bundle entry ID collision/)

  const noncanonical = planFixture()
  noncanonical.selected[0].repositoryUrl = 'https://github.com/example/dsh-plugin.git'
  assert.throws(() => validateManualScanPlan(noncanonical), /repository must be canonical/)
})

function authorRecheckPlan() {
  return {
    schemaVersion: 1,
    type: 'author-requested-catalog-recheck',
    planId: 'author-recheck-1653-20261118',
    baseCommit: 'a'.repeat(40),
    request: {
      repository: 'AI-Scarlett/DSH-Store', issueNumber: 1653, commentId: 6967944300, userId: 4898852,
      updatedAt: '2026-11-18T03:16:30Z', bodySha256: digest,
      quote: '可以重新扫一次固定 commit 验证。',
    },
    catalog: {
      id: 'dsh-deepseek-cost', repositoryUrl: 'https://github.com/skyrocks/dsh-deepseek-cost',
      commit: 'b'.repeat(40), version: '0.2.0', status: 'blocked', updatePolicy: 'external-only',
    },
    source: { commit: 'c'.repeat(40), version: '0.2.5' },
    withdrawal: {
      catalogId: 'dsh-favorites', repositoryUrl: 'https://github.com/andyzhuang233/dsh-favorites',
      issueNumber: 581, commentId: 6971546684, userId: 160030887,
      updatedAt: '2026-11-18T07:00:18Z', bodySha256: 'd'.repeat(64),
      requestUrl: 'https://github.com/AI-Scarlett/DSH-Store/issues/581#issuecomment-6971546684',
      expectedRepositoryState: 'not-found',
      quote: '仓库已删除。请关闭此修复单并下架对应条目。',
    },
    authorization: { source: 'direct-user-request', request: 'process current author feedback' },
  }
}

function reviewedFixedSourceUpdatePlan() {
  return {
    schemaVersion: 1,
    type: 'reviewed-fixed-source-catalog-update',
    planId: 'store-0948-reviewed-update-20261119',
    baseCommit: 'a'.repeat(40),
    target: {
      id: 'dsh-safe-plugin-manager',
      repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store',
      commit: 'b'.repeat(40),
      version: '0.9.44',
      detailPath: 'registry/catalog/details/dsh-safe-plugin-manager.json',
    },
    source: {
      repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store',
      commit: 'c'.repeat(40),
      sourceTree: 'd'.repeat(40),
      packageName: 'dsh-safe-plugin-manager',
      version: '0.9.48',
      manifestPath: 'package.json',
      entryIds: ['dsh-safe-plugin-manager'],
      sourceBinding: 'e'.repeat(64),
      sourceDigest: 'f'.repeat(64),
    },
    review: {
      commit: 'c'.repeat(40),
      binding: 'e'.repeat(64),
      verdict: 'approved',
      documentPath: 'docs/reviews/store-0948-source-review-20261119.json',
      documentSha256: digest,
    },
    scope: [
      'registry/catalog-index.json',
      'registry/catalog.json',
      'registry/catalog/details/dsh-safe-plugin-manager.json',
    ],
    preconditions: {
      files: {
        'registry/catalog-index.json': '1'.repeat(64),
        'registry/catalog.json': '2'.repeat(64),
        'registry/catalog/details/dsh-safe-plugin-manager.json': '3'.repeat(64),
        'registry/admission-reviews.json': '4'.repeat(64),
        'docs/reviews/store-0948-source-review-20261119.json': digest,
      },
    },
    authorization: {
      source: 'direct-user-request',
      request: '用户要求处理自研插件高版本暂缓更新并由 Codex 负责本次审查。',
      reviewer: 'Codex on behalf of AI-Scarlett',
      reviewedAt: '2026-11-19T00:00:00Z',
      rationale: 'The exact fixed source was completely reviewed and the approved registry record is hash-bound.',
    },
    rollback: {
      type: 'git-revert',
      description: 'Revert only this exact Catalog policy PR and preserve the review history.',
    },
  }
}

test('author-requested Catalog recheck plans bind a blocked external-only listing, exact source, and deletion request', () => {
  const validated = validateManualScanPlan(authorRecheckPlan())
  assert.equal(validated.request.commentId, 6967944300)
  assert.equal(validated.catalog.updatePolicy, 'external-only')
  assert.equal(validated.withdrawal.commentId, 6971546684)
})

test('author-requested Catalog recheck plans fail closed on admission, source, or request scope changes', () => {
  const admitted = authorRecheckPlan()
  admitted.catalog.updatePolicy = 'source-verified'
  assert.throws(() => validateManualScanPlan(admitted), /blocked external-only/)

  const floating = authorRecheckPlan()
  floating.source.commit = 'main'
  assert.throws(() => validateManualScanPlan(floating), /source identity/)

  const nonDeletion = authorRecheckPlan()
  nonDeletion.withdrawal.quote = 'Please close this issue.'
  assert.throws(() => validateManualScanPlan(nonDeletion), /close and unlist/)
})

test('reviewed fixed-source Catalog updates bind first-party identity, review, file hashes, and exact scope', () => {
  const plan = reviewedFixedSourceUpdatePlan()
  assert.equal(validateManualScanPlan(plan).source.commit, 'c'.repeat(40))

  const thirdParty = reviewedFixedSourceUpdatePlan()
  thirdParty.target.repositoryUrl = 'https://github.com/example/DSH-Store'
  assert.throws(() => validateManualScanPlan(thirdParty), /exact first-party DSH-Store/)

  const unboundDocument = reviewedFixedSourceUpdatePlan()
  unboundDocument.review.documentSha256 = '9'.repeat(64)
  assert.throws(() => validateManualScanPlan(unboundDocument), /document hash differs/)

  const expandedScope = reviewedFixedSourceUpdatePlan()
  expandedScope.scope.push('registry/candidates.json')
  assert.throws(() => validateManualScanPlan(expandedScope), /exact Catalog bridge, index, and detail/)
})
