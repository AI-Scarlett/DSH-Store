import assert from 'node:assert/strict'
import test from 'node:test'
import { renderCatalogAutomationNotification } from '../scripts/render-catalog-automation-notification.mjs'

test('Catalog notification separates additions, historical updates, and deferred versions', () => {
  const catalog = {
    entries: [
      { id: 'new-plugin', name: '通知助手（Notify Helper）', version: '1.0.0', status: 'blocked', repositoryUrl: 'https://github.com/example/new-plugin' },
      { id: 'old-plugin', name: '历史工具（History Tool）', version: '2.0.0', status: 'approved', repositoryUrl: 'https://github.com/example/old-plugin' },
      { id: 'old-compat', name: '旧版兼容插件（Old Compatibility）', version: '1.2.0', status: 'unlisted', repositoryUrl: 'https://github.com/example/old-compat' },
      { id: 'restored-compat', name: '恢复兼容插件（Restored Compatibility）', version: '1.3.0', status: 'approved', repositoryUrl: 'https://github.com/example/restored-compat' },
    ],
  }
  const report = {
    observedAt: '2026-08-24T10:24:33.000Z',
    baseCommit: 'a'.repeat(40),
    sourceVersionChecks: {
      checkedEntries: 480,
      newerVersionCandidates: 2,
      catalogUpdates: 1,
      newerVersionsDeferred: 1,
      sourceChangedWithoutVersionBump: 3,
      unresolvedEntries: 0,
    },
    addedEntries: [{ id: 'new-plugin', reasons: ['runtime dependency requires review'] }],
    updatedEntries: [{ id: 'old-plugin', fromVersion: '1.0.0', toVersion: '2.0.0' }],
    compatibilityPolicy: {
      latestReleases: ['0.1.0-rc.8', '0.1.1-rc.1', '0.1.1-rc.2'],
    },
    compatibilityUnlisted: [{ id: 'old-compat', version: '1.2.0', requiredDshReleases: ['0.1.0-rc.8', '0.1.1-rc.1', '0.1.1-rc.2'] }],
    compatibilityRestored: [{ id: 'restored-compat', version: '1.3.0', requiredDshReleases: ['0.1.0-rc.8', '0.1.1-rc.1', '0.1.1-rc.2'] }],
    prunedCandidates: [{
      id: 'failed-candidate', name: '失败候选（Failed Candidate）', repositoryUrl: 'https://github.com/example/failed-candidate',
      commit: 'c'.repeat(40), reason: 'other gate failed; no exact compatible declaration for official DSH releases',
    }],
    deferredUpdates: [{ id: 'new-plugin', catalogVersion: '1.0.0', upstreamVersion: '1.1.0', reason: '证据不足' }],
    transientFailures: [],
    postconditions: { catalogEntries: 481 },
  }
  const watchdog = {
    checkedAt: '2026-08-24T10:55:00.000Z',
    status: 'passed',
    surfaces: [
      { url: 'https://dsh.store/registry/catalog.json', status: 'passed', entries: 481, sha256: 'b'.repeat(64) },
    ],
    candidateSurfaces: [
      { url: 'https://dsh.store/registry/candidates.json', status: 'passed', entries: 1420, sha256: 'c'.repeat(64) },
    ],
  }
  const output = renderCatalogAutomationNotification({
    catalog,
    report,
    watchdog,
    catalogRunId: '123',
    catalogRunUrl: 'https://github.com/example/repo/actions/runs/123',
    catalogConclusion: 'success',
    watchdogRunId: '456',
    watchdogRunUrl: 'https://github.com/example/repo/actions/runs/456',
    mention: '@AI-Scarlett',
    authorNotices: {
      sourceCatalogRunId: '123',
      summary: {
        desiredRepositories: 8,
        githubMessages: 3,
        githubNotificationEmailTriggers: 3,
        upstreamModifiedStillBlocked: 1,
        upstreamModifiedResolved: 1,
        noUpstreamModificationDetected: 4,
        sourceTrackingBaselines: 1,
        sourceModificationUnknown: 1,
        resolvedWithoutDetectedSourceChange: 0,
        candidateRegistryRecords: 1420,
        candidateRegistryRepositories: 1420,
        candidateCoverageAccounted: 1420,
        candidateCoverageUnaccounted: 0,
        candidateCoverageInvariantPassed: true,
        candidateDirectNotificationEligible: 9,
        candidateDirectManagedIssues: 4,
        candidateDirectScheduledThisRun: 3,
        candidateDirectQueued: 2,
        candidatePublicRegistryOnly: 1411,
        candidatePublicReviewing: 168,
        candidatePublicRemediation: 1021,
        candidatePublicDeferred: 0,
        candidatePublicDiscoveryOnly: 222,
      },
      actions: [
        { type: 'source-update', key: 'example/new-plugin', sourceStatus: 'modified-still-blocked' },
        { type: 'close', key: 'example/fixed-plugin', sourceStatus: 'modified-and-resolved' },
        { type: 'baseline', key: 'example/legacy-plugin', sourceStatus: 'tracking-baseline' },
      ],
    },
  })
  assert.match(output, /综合结果：\*\*通过\*\*/)
  assert.match(output, /新增收录：1 个（可安装 0，blocked\/不可安装 1）/)
  assert.match(output, /历史版本自动更新：1 个/)
  assert.match(output, /通知助手（Notify Helper）/)
  assert.match(output, /历史工具（History Tool）/)
  assert.match(output, /1\.0\.0 \| 2\.0\.0/)
  assert.match(output, /发现高版本但暂缓更新/)
  assert.match(output, /兼容性下架 1，恢复 1/)
  assert.match(output, /暂时下架并转入候选/)
  assert.match(output, /恢复兼容插件（Restored Compatibility）/)
  assert.match(output, /不兼容且已有其他失败的候选清理：1 个/)
  assert.match(output, /失败候选（Failed Candidate）/)
  assert.match(output, /发送 GitHub 整改消息：3 个项目/)
  assert.match(output, /触发 GitHub 通知邮件：3 个项目；实际送达：\*\*无法验证\*\*/)
  assert.match(output, /候选全量台账：1420 \/ 1420 条已归类，未覆盖 0 条/)
  assert.match(output, /Candidate Registry 全量覆盖：1420 \/ 1420 条，canonical 仓库 1420 个，未覆盖 0 条/)
  assert.match(output, /Catalog 四个公开面核验：1\/1 通过/)
  assert.match(output, /候选库四个公开面核验：1\/1 通过/)
  assert.match(output, /公开面核验工作流：通过/)
  assert.match(output, /Candidate Registry 公开面核验/)
  assert.match(output, /dsh\.store\/registry\/candidates\.json/)
  assert.match(output, /符合一次性直接整改通知的候选：9 个/)
  assert.match(output, /仅在\[公开候选库\].*展示、不主动 @ 的候选：1411 个/)
  assert.match(output, /不发送纯推广内容/)
  assert.match(output, /已修改但仍未通过/)
  assert.match(output, /已修改且问题清除/)
  assert.match(output, /example\/new-plugin/)
  assert.doesNotMatch(output, /example\/legacy-plugin/)
  assert.match(output, /状态边界/)
})

test('Catalog notification never presents a missing author notification plan as zero', () => {
  const output = renderCatalogAutomationNotification({
    catalog: { entries: [] },
    report: {
      observedAt: '2026-08-24T10:24:33.000Z',
      addedEntries: [], updatedEntries: [], compatibilityUnlisted: [], compatibilityRestored: [],
      prunedCandidates: [], deferredUpdates: [], transientFailures: [], sourceVersionChecks: {},
    },
    watchdog: { status: 'passed', surfaces: [], checkedAt: '2026-08-24T10:55:00.000Z' },
    catalogRunId: '123',
    catalogConclusion: 'success',
  })
  assert.match(output, /作者整改通知统计：\*\*不可用/)
  assert.match(output, /请勿解读为 0/)
  assert.doesNotMatch(output, /发送 GitHub 整改消息：0 个项目/)
})

test('Catalog notification remains useful when an automation artifact is missing', () => {
  const output = renderCatalogAutomationNotification({
    catalog: { entries: [] },
    report: null,
    watchdog: { status: 'failed', surfaces: [], checkedAt: '2026-08-24T10:55:00.000Z' },
    catalogConclusion: 'failure',
    repairTriggered: true,
  })
  assert.match(output, /需要关注/)
  assert.match(output, /本轮扫描失败，统计不可用/)
  assert.match(output, /禁止按 0 解读/)
  assert.match(output, /无法确认新增收录清单；请勿解读为 0/)
  assert.match(output, /无法确认历史插件更新清单；请勿解读为 0/)
  assert.doesNotMatch(output, /新增 0，历史更新 0/)
  assert.doesNotMatch(output, /无新增收录/)
  assert.doesNotMatch(output, /无历史插件版本更新/)
  assert.match(output, /已自动触发修复任务/)
})

test('Catalog notification exposes a preserved partial failure without presenting partial counts as final', () => {
  const output = renderCatalogAutomationNotification({
    catalog: { entries: [{ id: 'existing' }] },
    report: {
      schemaVersion: 2,
      status: 'failed',
      completed: false,
      statisticsAvailable: false,
      observedAt: '2026-08-25T10:00:00.000Z',
      sourceVersionChecks: { checkedEntries: 85, newerVersionCandidates: 12 },
      failure: {
        stage: 'apply-latest-dsh-compatibility-policy',
        message: 'conflicting compatibility aliases for 0.1.0-rc.8',
      },
    },
    watchdog: { status: 'failed', surfaces: [], checkedAt: '2026-08-25T10:55:00.000Z' },
    catalogConclusion: 'failure',
  })
  assert.match(output, /至少 85 个（部分进度，不是最终统计）/)
  assert.match(output, /apply-latest-dsh-compatibility-policy/)
  assert.match(output, /conflicting compatibility aliases/)
  assert.doesNotMatch(output, /发现上游高版本：12 个/)
})

test('Catalog notification bounds every detail table below the GitHub Issue body limit', () => {
  const entries = Array.from({ length: 240 }, (_, index) => ({
    id: `plugin-${index}`,
    name: `插件 ${index}（Plugin ${index}）`,
    version: '2.0.0',
    status: 'unlisted',
    repositoryUrl: `https://github.com/example/plugin-${index}`,
  }))
  const details = entries.map((entry, index) => ({
    id: entry.id,
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    catalogVersion: '1.0.0',
    upstreamVersion: '2.0.0',
    version: '2.0.0',
    repositoryUrl: entry.repositoryUrl,
    commit: 'd'.repeat(40),
    requiredDshReleases: ['0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5'],
    reasons: ['需要保留完整机器报告中的供应链复核原因'],
    reason: '需要保留完整机器报告中的供应链复核原因',
  }))
  const surfaces = Array.from({ length: 40 }, (_, index) => ({
    url: `https://example.com/catalog-${index}.json`, status: 'passed', entries: 240, sha256: 'e'.repeat(64),
  }))
  const output = renderCatalogAutomationNotification({
    catalog: { entries },
    report: {
      observedAt: '2026-09-02T00:00:00.000Z',
      baseCommit: 'a'.repeat(40),
      sourceVersionChecks: {
        checkedEntries: 240, newerVersionCandidates: 240, catalogUpdates: 240,
        newerVersionsDeferred: 240, sourceChangedWithoutVersionBump: 0, unresolvedEntries: 0,
      },
      addedEntries: details,
      updatedEntries: details,
      compatibilityPolicy: { latestReleases: ['0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5'] },
      compatibilityUnlisted: details,
      compatibilityRestored: details.slice(0, 30),
      prunedCandidates: details,
      deferredUpdates: details,
      transientFailures: [],
      postconditions: { catalogEntries: 240 },
    },
    watchdog: { status: 'passed', surfaces, candidateSurfaces: surfaces, checkedAt: '2026-09-02T00:10:00.000Z' },
    catalogRunId: '999',
    catalogConclusion: 'success',
    authorNotices: {
      sourceCatalogRunId: '999',
      summary: {
        desiredRepositories: 240, githubMessages: 240, githubNotificationEmailTriggers: 240,
        candidateCoverageInvariantPassed: true, candidateCoverageUnaccounted: 0,
        candidateCoverageAccounted: 240, candidateRegistryRecords: 240, candidateRegistryRepositories: 240,
      },
      actions: details.map((_, index) => ({
        type: 'source-update', key: `example/plugin-${index}`, sourceStatus: 'modified-still-blocked',
      })),
    },
  })
  assert.ok(Buffer.byteLength(output) < 65_000, `notification is ${Buffer.byteLength(output)} bytes`)
  assert.match(output, /另有 220 条未展开/)
  assert.match(output, /另有 250 条未展开/)
  assert.match(output, /另有 20 条未展开/)
  assert.doesNotMatch(output, /插件 239（Plugin 239）/)
  assert.match(output, /完整记录见本次 Run Artifact 中的机器报告/)
})
