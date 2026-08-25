import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAuthorNoticePlan, parseAuthorNoticeMarker } from '../scripts/plan-author-notices.mjs'

const hashes = {
  catalogSha256: '1'.repeat(64),
  candidatesSha256: '2'.repeat(64),
  reportSha256: '3'.repeat(64),
  existingIssuesSha256: '4'.repeat(64),
  notificationTargetsSha256: '5'.repeat(64),
}
const baseCommit = 'a'.repeat(40)

function candidate(overrides = {}) {
  return {
    id: 'candidate-plugin',
    name: 'Candidate Plugin',
    description: 'A DeepSeek Harness plugin',
    repositoryUrl: 'https://github.com/CandidateOwner/dsh-candidate',
    latestCommit: 'b'.repeat(40),
    discoverySources: ['github-fixed-commit-review'],
    topics: ['dsh-plugin'],
    status: 'rejected',
    route: 'blocked',
    statusReason: 'package.json does not declare dsh.bundle.patch',
    ...overrides,
  }
}

function fixture(overrides = {}) {
  return {
    catalog: {
      entries: [
        {
          id: 'blocked-plugin', name: '被阻断插件（Blocked Plugin）', version: '1.0.0', status: 'blocked',
          statusReason: 'Bundle Patch uses a protected official entry ID',
          repositoryUrl: 'https://github.com/BlockedOwner/dsh-blocked',
          commit: 'c'.repeat(40),
        },
        {
          id: 'update-plugin', name: '更新插件（Update Plugin）', version: '1.0.0', status: 'approved',
          repositoryUrl: 'https://github.com/UpdateOwner/dsh-update',
          commit: 'd'.repeat(40),
        },
      ],
    },
    candidates: {
      entries: [
        candidate(),
        candidate({
          id: 'ordinary-tool', repositoryUrl: 'https://github.com/OtherOwner/ordinary-tool',
          description: 'An ordinary tool', topics: [], statusReason: 'package.json is missing',
        }),
        candidate({
          id: 'temporary-failure', repositoryUrl: 'https://github.com/InfraOwner/dsh-infra',
          statusReason: 'HTTP 403 rate limit while reading repository',
        }),
      ],
    },
    report: {
      observedAt: '2026-08-24T12:00:00Z',
      addedEntries: [],
      deferredUpdates: [{
        id: 'update-plugin', catalogVersion: '1.0.0', upstreamVersion: '1.1.0',
        commit: 'e'.repeat(40), reason: 'runtime dependencies require user review',
      }],
      rejectedCandidates: [],
    },
    existingIssues: [],
    baseCommit,
    inputHashes: hashes,
    maxCreate: 3,
    ...overrides,
  }
}

test('author notice plan rate-limits and covers blocked, deferred, and explicit DSH candidates', () => {
  const plan = buildAuthorNoticePlan(fixture())
  assert.equal(plan.summary.creates, 3)
  assert.equal(plan.summary.queuedNewIssues, 0)
  assert.deepEqual(new Set(plan.actions.map(action => action.key)), new Set([
    'blockedowner/dsh-blocked',
    'updateowner/dsh-update',
    'candidateowner/dsh-candidate',
  ]))
  const body = plan.actions.map(action => action.body).join('\n')
  assert.match(body, /@BlockedOwner/)
  assert.match(body, /@UpdateOwner/)
  assert.match(body, /@CandidateOwner/)
  assert.match(body, /候选未通过 \/ Candidate rejected/)
  assert.match(body, /修改并推送到默认分支即可/)
  assert.match(body, /github\.com\/AI-Scarlett\/build-dsh-plugin/)
  assert.match(body, /https:\/\/dsh\.store\//)
  assert.doesNotMatch(body, /ordinary-tool|HTTP 403/)
  assert.ok(plan.actions.every(action => parseAuthorNoticeMarker(action.body)?.notifiedSignature === action.signature))
  assert.equal(plan.summary.githubMessages, 3)
  assert.equal(plan.summary.githubNotificationEmailTriggers, 3)
  assert.equal(plan.summary.githubNotificationEmailDeliveriesVerified, 0)
  assert.equal(plan.summary.sourceTrackingBaselines, 3)
  assert.equal(plan.summary.candidateRegistryRecords, 3)
  assert.equal(plan.summary.candidateRegistryRepositories, 3)
  assert.equal(plan.summary.candidateCoverageAccounted, 3)
  assert.equal(plan.summary.candidateCoverageUnaccounted, 0)
  assert.equal(plan.summary.candidateCoverageInvariantPassed, true)
  assert.equal(plan.summary.candidateDirectNotificationEligible, 1)
  assert.equal(plan.summary.candidateDirectScheduledThisRun, 1)
  assert.equal(plan.summary.candidatePublicRegistryOnly, 2)
  assert.equal(plan.summary.candidatePublicDeferred, 1)
  assert.equal(plan.summary.candidatePublicDiscoveryOnly, 1)
  assert.equal(plan.candidateCoverage.length, 3)
  assert.match(plan.candidateCoverageFingerprint, /^[0-9a-f]{64}$/)
  assert.deepEqual(Object.fromEntries(plan.candidateCoverage.map(record => [record.key, record.disposition])), {
    'candidateowner/dsh-candidate': 'direct-remediation',
    'infraowner/dsh-infra': 'public-deferred',
    'otherowner/ordinary-tool': 'public-discovery-only',
  })
  assert.equal(plan.policy.neverSendPromotionOnlyMessages, true)
  assert.equal(plan.policy.neverCreateIssuesInExternalRepositories, true)
})

test('all candidate repositories receive exactly one public or direct coverage disposition', () => {
  const plan = buildAuthorNoticePlan(fixture({
    candidates: {
      entries: [
        candidate(),
        candidate({
          id: 'reviewing-candidate', repositoryUrl: 'https://github.com/ReviewOwner/dsh-reviewing',
          status: 'reviewing', route: 'direct-review', statusReason: 'waiting for bounded fixed-Commit review',
        }),
        candidate({
          id: 'radar-candidate', repositoryUrl: 'https://github.com/RadarOwner/dsh-radar',
          discoverySources: ['github-automatic-radar-v1'],
        }),
      ],
    },
  }))
  assert.deepEqual(plan.candidateCoverage.map(record => [record.key, record.disposition]), [
    ['candidateowner/dsh-candidate', 'direct-remediation'],
    ['radarowner/dsh-radar', 'public-remediation'],
    ['reviewowner/dsh-reviewing', 'public-reviewing'],
  ])
  assert.equal(plan.summary.candidateRegistryRecords, 3)
  assert.equal(plan.summary.candidateCoverageAccounted, 3)
  assert.equal(plan.summary.candidateCoverageUnaccounted, 0)
  assert.equal(plan.summary.candidateDirectNotificationEligible, 1)
  assert.equal(plan.summary.candidatePublicRemediation, 1)
  assert.equal(plan.summary.candidatePublicReviewing, 1)
})

test('unchanged author findings do not repeatedly mention the owner', () => {
  const first = buildAuthorNoticePlan(fixture({ maxCreate: 1 }))
  const created = first.actions.find(action => action.type === 'create')
  const second = buildAuthorNoticePlan(fixture({
    existingIssues: [{ number: 91, title: created.title, state: 'open', body: created.body, url: 'https://github.com/example/issues/91' }],
    maxCreate: 0,
  }))
  assert.equal(second.actions.length, 0)
  assert.equal(second.summary.unchanged, 1)
  assert.equal(second.summary.noUpstreamModificationDetected, 1)
})

test('a new upstream fixed Commit is reported even when the blocker text is unchanged', () => {
  const first = buildAuthorNoticePlan(fixture())
  const created = first.actions.find(action => action.key === 'blockedowner/dsh-blocked')
  const changedCatalog = structuredClone(fixture().catalog)
  changedCatalog.entries.find(entry => entry.id === 'blocked-plugin').commit = 'f'.repeat(40)
  const second = buildAuthorNoticePlan(fixture({
    catalog: changedCatalog,
    existingIssues: [{ number: 94, title: created.title, state: 'open', body: created.body, url: 'https://github.com/example/issues/94' }],
    maxCreate: 0,
  }))
  const action = second.actions.find(item => item.type === 'source-update')
  assert.ok(action)
  assert.equal(action.sourceStatus, 'modified-still-blocked')
  assert.match(action.comment, /build-dsh-plugin/)
  assert.match(action.comment, /https:\/\/dsh\.store\//)
  assert.equal(second.summary.upstreamModifiedStillBlocked, 1)
  assert.equal(second.summary.githubMessages, 1)
})

test('legacy remediation issues establish a source baseline without mentioning the author again', () => {
  const first = buildAuthorNoticePlan(fixture())
  const created = first.actions.find(action => action.key === 'blockedowner/dsh-blocked')
  const legacyBody = created.body.replace(/<!-- dsh-author-source:[^\n]+ -->\n/, '')
  const second = buildAuthorNoticePlan(fixture({
    existingIssues: [{ number: 95, title: created.title, state: 'open', body: legacyBody, url: 'https://github.com/example/issues/95' }],
    maxCreate: 0,
  }))
  const action = second.actions.find(item => item.type === 'baseline')
  assert.ok(action)
  assert.equal(action.comment, undefined)
  assert.equal(second.summary.githubMessages, 0)
  assert.equal(second.summary.sourceTrackingBaselines, 1)
})

test('changed blockers use a recoverable update then notification marker', () => {
  const first = buildAuthorNoticePlan(fixture())
  const created = first.actions.find(action => action.key === 'blockedowner/dsh-blocked')
  const changedCatalog = structuredClone(fixture().catalog)
  const blocked = changedCatalog.entries.find(entry => entry.id === 'blocked-plugin')
  blocked.statusReason = 'license file is missing from the fixed Commit'
  const second = buildAuthorNoticePlan(fixture({
    catalog: changedCatalog,
    existingIssues: [{ number: 92, title: created.title, state: 'open', body: created.body, url: 'https://github.com/example/issues/92' }],
    maxCreate: 0,
  }))
  const action = second.actions.find(item => item.type === 'update')
  assert.ok(action)
  assert.equal(parseAuthorNoticeMarker(action.pendingBody).notifiedSignature, created.signature)
  assert.equal(parseAuthorNoticeMarker(action.body).notifiedSignature, action.signature)
  assert.match(action.comment, /@BlockedOwner/)
  assert.ok(action.comment.includes(`<!-- ${action.commentMarker} -->`))
})

test('managed remediation issue closes when the deterministic blocker clears', () => {
  const first = buildAuthorNoticePlan(fixture({ maxCreate: 1 }))
  const created = first.actions.find(action => action.type === 'create')
  const cleared = buildAuthorNoticePlan(fixture({
    catalog: { entries: [] },
    candidates: { entries: [] },
    report: { observedAt: '2026-08-24T15:00:00Z', addedEntries: [], deferredUpdates: [], rejectedCandidates: [] },
    existingIssues: [{ number: 93, title: created.title, state: 'open', body: created.body, url: 'https://github.com/example/issues/93' }],
    maxCreate: 0,
  }))
  assert.equal(cleared.actions.length, 1)
  assert.equal(cleared.actions[0].type, 'close')
  assert.ok(cleared.actions[0].comment.includes(`<!-- ${cleared.actions[0].commentMarker} -->`))
})

test('a cleared blocker records whether the upstream source changed', () => {
  const first = buildAuthorNoticePlan(fixture())
  const created = first.actions.find(action => action.key === 'blockedowner/dsh-blocked')
  const approved = structuredClone(fixture().catalog.entries.find(entry => entry.id === 'blocked-plugin'))
  approved.status = 'approved'
  delete approved.statusReason
  approved.commit = 'f'.repeat(40)
  const cleared = buildAuthorNoticePlan(fixture({
    catalog: { entries: [approved] },
    candidates: { entries: [] },
    report: { observedAt: '2026-08-24T15:00:00Z', addedEntries: [], deferredUpdates: [], rejectedCandidates: [] },
    existingIssues: [{ number: 96, title: created.title, state: 'open', body: created.body, url: 'https://github.com/example/issues/96' }],
    maxCreate: 0,
  }))
  assert.equal(cleared.actions[0].type, 'close')
  assert.equal(cleared.actions[0].sourceStatus, 'modified-and-resolved')
  assert.equal(cleared.summary.upstreamModifiedResolved, 1)
})

test('organization repositories can mention a resolved human maintainer', () => {
  const plan = buildAuthorNoticePlan(fixture({
    notificationTargets: { 'candidateowner/dsh-candidate': ['HumanMaintainer'] },
    maxCreate: 3,
  }))
  const action = plan.actions.find(item => item.key === 'candidateowner/dsh-candidate')
  assert.match(action.body, /@HumanMaintainer/)
  assert.doesNotMatch(action.body, /@CandidateOwner/)
})

test('latest-three compatibility holds notify the author and remain reversible', () => {
  const heldCatalog = structuredClone(fixture().catalog)
  heldCatalog.entries.push({
    id: 'compat-plugin', name: '兼容插件（Compatibility Plugin）', version: '1.0.0', status: 'unlisted',
    statusReason: 'DSH_LATEST_THREE_COMPATIBILITY_HOLD: no compatible result for the latest three releases',
    repositoryUrl: 'https://github.com/CompatOwner/dsh-compat-plugin',
  })
  const report = structuredClone(fixture().report)
  report.compatibilityPolicy = { latestReleases: ['0.1.0-rc.8', '0.1.1-rc.1', '0.1.1-rc.2'] }
  report.compatibilityUnlisted = [{
    id: 'compat-plugin', requiredDshReleases: ['0.1.0-rc.8', '0.1.1-rc.1', '0.1.1-rc.2'],
  }]
  const plan = buildAuthorNoticePlan(fixture({ catalog: heldCatalog, report, maxCreate: 4 }))
  const action = plan.actions.find(item => item.key === 'compatowner/dsh-compat-plugin')
  assert.ok(action)
  assert.ok(action.labels.includes('compatibility-outdated'))
  assert.match(action.body, /兼容性暂时下架 \/ Compatibility unlisted/)
  assert.match(action.body, /0\.1\.1-rc\.2/)
  assert.match(action.body, /@CompatOwner/)
})

test('pruned incompatible candidates still receive one report-backed remediation notice', () => {
  const report = structuredClone(fixture().report)
  report.prunedCandidates = [{
    id: 'pruned-plugin',
    name: 'Pruned Plugin',
    description: 'A DeepSeek Harness plugin',
    repositoryUrl: 'https://github.com/PrunedOwner/dsh-pruned-plugin',
    commit: 'c'.repeat(40),
    discoverySources: ['github-fixed-commit-review'],
    topics: ['dsh-plugin'],
    reason: 'SUBMISSION_BUNDLE_MISSING: Bundle missing; no exact compatible declaration for official DSH releases 0.1.0-rc.8, 0.1.1-rc.1, 0.1.1-rc.2',
  }]
  const plan = buildAuthorNoticePlan(fixture({ report, maxCreate: 4 }))
  const action = plan.actions.find(item => item.key === 'prunedowner/dsh-pruned-plugin')
  assert.ok(action)
  assert.match(action.body, /候选未保留 \/ Candidate pruned/)
  assert.match(action.body, /dsh\.compatibility\.dshReleases/)
  assert.match(action.body, /@PrunedOwner/)
})
