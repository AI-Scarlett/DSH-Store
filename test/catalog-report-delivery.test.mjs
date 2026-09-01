import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalReportDeliveryState,
  createCatalogReportDeliveryPlan,
  validateCatalogReportDeliveryPlan,
} from '../scripts/catalog-report-delivery.mjs'

const baseCommit = 'a'.repeat(40)
const catalogRunId = '33056046272'
const reportBody = Buffer.from('## DSH STORE 自动更新报告\n\n@AI-Scarlett\n')
const publishedBody = marker => `<!-- ${marker} -->\n${reportBody.toString('utf8').trimEnd()}\n`
const issue = {
  number: 148,
  title: 'DSH STORE 自动更新报告（每 3 小时）',
  state: 'open',
  url: 'https://github.com/AI-Scarlett/DSH-Store/issues/148',
  body: 'initial report',
  comments: [],
}

test('Catalog report delivery creates one hash-bound owner notification for a new run', () => {
  const plan = createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: `catalog-${catalogRunId}`,
    reportBody,
    state: { issue },
  })
  validateCatalogReportDeliveryPlan(plan)
  assert.equal(plan.action.type, 'comment')
  assert.equal(plan.action.issueNumber, 148)
  assert.equal(plan.action.reopen, false)
  assert.equal(plan.postconditions.mention, '@AI-Scarlett')
  assert.equal(plan.postconditions.githubNotificationEmailDeliveryVerified, false)
  assert.match(plan.marker, new RegExp(`catalog-${catalogRunId}$`))
  assert.match(plan.planId, /^[0-9a-f]{24}$/)

  const repeated = createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: `catalog-${catalogRunId}`,
    reportBody,
    state: {
      issue: {
        ...issue,
        comments: [{ id: 1, body: publishedBody(plan.marker) }],
      },
    },
  })
  assert.equal(repeated.action.type, 'skip')
  assert.equal(repeated.action.issueNumber, 148)
})

test('Catalog report delivery updates one existing run comment when verification evidence changes', () => {
  const initial = createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: `catalog-${catalogRunId}`,
    reportBody,
    state: { issue },
  })
  const changed = createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: `catalog-${catalogRunId}`,
    reportBody,
    state: {
      issue: {
        ...issue,
        comments: [{ id: 7, body: `<!-- ${initial.marker} -->\nold public verification` }],
      },
    },
  })
  validateCatalogReportDeliveryPlan(changed)
  assert.deepEqual(changed.action, { type: 'update', issueNumber: 148, commentId: 7, reopen: false })
})

test('watchdog uses the normal run marker as fallback and a distinct bounded alert marker', () => {
  const normal = createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: `catalog-${catalogRunId}`,
    reportBody,
    state: { issue },
  })
  const deliveredState = {
    issue: {
      ...issue,
      comments: [{ id: 2, body: publishedBody(normal.marker) }],
    },
  }
  const fallback = createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: `catalog-${catalogRunId}`,
    reportBody,
    state: deliveredState,
  })
  const alert = createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: `catalog-${catalogRunId}-watchdog-alert`,
    reportBody,
    state: deliveredState,
  })
  assert.equal(fallback.action.type, 'skip')
  assert.equal(alert.action.type, 'comment')
  assert.notEqual(alert.marker, normal.marker)
})

test('watchdog recovery updates the existing alert comment without adding another notification', () => {
  const alertKey = `catalog-${catalogRunId}-watchdog-alert`
  const alert = createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: alertKey,
    reportBody,
    state: { issue },
  })
  const recovery = createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: alertKey,
    reportBody,
    state: {
      issue: {
        ...issue,
        comments: [{ id: 9, body: `<!-- ${alert.marker} -->\nstale watchdog failure` }],
      },
    },
  })
  assert.deepEqual(recovery.action, { type: 'update', issueNumber: 148, commentId: 9, reopen: false })
})

test('closed report thread is reopened only after its new run comment is planned', () => {
  const plan = createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: `catalog-${catalogRunId}`,
    reportBody,
    state: { issue: { ...issue, state: 'closed' } },
  })
  assert.deepEqual(plan.action, { type: 'comment', issueNumber: 148, reopen: true })
})

test('Catalog report delivery fails closed on ambiguous state or a report without the owner mention', () => {
  assert.throws(() => canonicalReportDeliveryState({
    issue: { ...issue, title: 'another issue' },
  }), /title is invalid/)
  assert.throws(() => createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: 'catalog-123',
    reportBody,
    state: { issue },
  }), /must contain catalogRunId/)
  assert.throws(() => createCatalogReportDeliveryPlan({
    baseCommit,
    catalogRunId,
    deliveryKey: `catalog-${catalogRunId}`,
    reportBody: Buffer.from('report without mention'),
    state: { issue },
  }), /must mention @AI-Scarlett/)
})
