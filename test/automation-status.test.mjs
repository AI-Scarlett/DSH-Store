import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAutomationStatus } from '../src/automation-status.mjs'

const catalog = {
  registry: { updatedAt: '2026-08-22T00:00:00Z' },
  entries: [
    { id: 'new-plugin', name: '通知助手（Notify Helper）', description: '任务完成后发送通知。', packageName: 'dsh-notify-helper', version: '1.0.0', status: 'approved', repositoryUrl: 'https://github.com/example/dsh-notify-helper' },
    { id: 'blocked', name: '受限插件（Blocked Plugin）', description: '权限证据不足。', packageName: 'dsh-blocked', version: '1.0.0', status: 'blocked', repositoryUrl: 'https://github.com/example/dsh-blocked' },
  ],
}

test('public status separates successful execution from actual Catalog changes', () => {
  const status = buildAutomationStatus({
    catalog, candidates: { entries: [{ id: 'candidate' }] }, generatedAt: '2026-08-22T03:00:00Z', sourceCommit: 'a'.repeat(40),
    runs: {
      catalogAutomation: [{ databaseId: 42, status: 'completed', conclusion: 'success', createdAt: '2026-08-22T02:00:00Z', updatedAt: '2026-08-22T02:05:00Z', url: 'https://github.com/example/repo/actions/runs/42', headSha: 'b'.repeat(40) }],
      marketplaceWatchdog: [{ databaseId: 43, status: 'completed', conclusion: 'success', createdAt: '2026-08-22T02:50:00Z', updatedAt: '2026-08-22T02:55:00Z', url: 'https://github.com/example/repo/actions/runs/43', headSha: 'c'.repeat(40) }],
    },
    reports: [{ runId: 42, report: {
      observedAt: '2026-08-22T02:01:00Z',
      addedEntries: [{ id: 'new-plugin' }],
      updatedEntries: [{ id: 'new-plugin', fromVersion: '0.9.0', toVersion: '1.0.0', policy: 'user-reviewed' }],
      compatibilityUnlisted: [{ id: 'blocked' }],
      compatibilityRestored: [{ id: 'new-plugin' }],
      prunedCandidates: [{ id: 'candidate-pruned' }],
      compatibilityPolicy: {
        authority: 'official-npm-registry-published-versions-through-latest',
        latestVersion: '0.1.1-rc.2',
        latestReleases: ['0.1.0-rc.8', '0.1.1-rc.1', '0.1.1-rc.2'],
        checkedApprovedEntries: 1,
        managedHeldEntries: 1,
      },
      candidateRetention: {
        authority: 'candidate-fixed-commit-package-manifests',
        bucket: 7,
        bucketCount: 24,
        checkedCandidates: 55,
        retainedCompatible: 4,
        retainedUnknown: 3,
        prunedUnsupported: 48,
        registryRemovals: 48,
      },
      rejectedCandidates: [],
      deferredUpdates: [],
      transientFailures: [],
      sourceVersionChecks: {
        authority: 'canonical-github-default-branch-manifest-at-fixed-commit',
        checkedEntries: 2,
        currentEntries: 1,
        newerVersionCandidates: 1,
        catalogUpdates: 1,
        newerVersionsDeferred: 0,
        sourceChangedWithoutVersionBump: 0,
        upstreamVersionBehind: 0,
        unresolvedEntries: 0,
      },
    } }],
  })
  assert.equal(status.overall.status, 'passed')
  assert.equal(status.scheduleHours, 8)
  assert.deepEqual(status.latestChanges.added, ['new-plugin'])
  assert.deepEqual(status.latestChanges.updated, ['new-plugin'])
  assert.equal(status.latestChanges.sourceVersionChecks.checkedEntries, 2)
  assert.equal(status.latestChanges.sourceVersionChecks.catalogUpdates, 1)
  assert.equal(status.latestChanges.sourceVersionChecks.unresolvedEntries, 0)
  assert.deepEqual(status.latestChanges.compatibilityUnlisted, ['blocked'])
  assert.deepEqual(status.latestChanges.compatibilityRestored, ['new-plugin'])
  assert.deepEqual(status.latestChanges.prunedCandidates, ['candidate-pruned'])
  assert.equal(status.latestChanges.candidateRetention.registryRemovals, 48)
  assert.deepEqual(status.latestChanges.compatibilityPolicy.latestReleases, ['0.1.0-rc.8', '0.1.1-rc.1', '0.1.1-rc.2'])
  assert.equal(status.recentAdditions[0].name, '通知助手（Notify Helper）')
  assert.equal(status.recentAdditions[0].runUrl, 'https://github.com/example/repo/actions/runs/42')
  assert.equal(status.recentUpdates[0].fromVersion, '0.9.0')
  assert.equal(status.recentUpdates[0].toVersion, '1.0.0')
  assert.equal(status.recentUpdates[0].policy, 'user-reviewed')
  assert.deepEqual(status.catalog, { entries: 2, approved: 1, blocked: 1, unlisted: 0, candidates: 1, updatedAt: '2026-08-22T00:00:00.000Z' })
})

test('missing workflow evidence remains explicitly unknown', () => {
  const status = buildAutomationStatus({ catalog, candidates: { entries: [] }, generatedAt: '2026-08-22T03:00:00Z', sourceCommit: 'local' })
  assert.equal(status.overall.status, 'unknown')
  assert.equal(status.scanner, null)
  assert.equal(status.recentAdditions.length, 0)
  assert.equal(status.recentUpdates.length, 0)
})
