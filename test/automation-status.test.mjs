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
    reports: [{ runId: 42, report: { observedAt: '2026-08-22T02:01:00Z', addedEntries: [{ id: 'new-plugin' }], updatedEntries: [], rejectedCandidates: [], deferredUpdates: [], transientFailures: [] } }],
  })
  assert.equal(status.overall.status, 'passed')
  assert.deepEqual(status.latestChanges.added, ['new-plugin'])
  assert.equal(status.latestChanges.updated.length, 0)
  assert.equal(status.recentAdditions[0].name, '通知助手（Notify Helper）')
  assert.equal(status.recentAdditions[0].runUrl, 'https://github.com/example/repo/actions/runs/42')
  assert.deepEqual(status.catalog, { entries: 2, approved: 1, blocked: 1, candidates: 1, updatedAt: '2026-08-22T00:00:00.000Z' })
})

test('missing workflow evidence remains explicitly unknown', () => {
  const status = buildAutomationStatus({ catalog, candidates: { entries: [] }, generatedAt: '2026-08-22T03:00:00Z', sourceCommit: 'local' })
  assert.equal(status.overall.status, 'unknown')
  assert.equal(status.scanner, null)
  assert.equal(status.recentAdditions.length, 0)
})
