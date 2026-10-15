import test from 'node:test'
import assert from 'node:assert/strict'
import { closeReviewedIssue, validateCloseGrant } from '../scripts/close-author-contact.mjs'
import { CONTACT_POLICY, digest } from '../scripts/author-contact-state.mjs'
const person = { id: 101, node_id: 'U_101', login: 'Alice', type: 'User' }
const request = { id: 202, body: 'Please close this issue.', updated_at: '2026-10-15T00:00:00Z', user: person }
const plan = { schemaVersion: 1, operation: 'requested-author-close', repository: 'AI-Scarlett/DSH-Store', subjectRepository: 'Alice/plugin',
  issueNumber: 10, userId: 101, requestCommentId: request.id, requestBodySha256: digest(request.body), requestUpdatedAt: request.updated_at,
  stateReason: 'not_planned', review: { decision: 'explicit-request-to-close', requestQuote: request.body, scope: 'Close only the withdrawn repair request; no approval claim.' } }
const seed = () => ({ schemaVersion: 1, policy: CONTACT_POLICY, historyComplete: true, contacts: { 101: {
  userId: 101, nodeId: 'U_101', logins: ['Alice'], stopped: false, firstContact: { kind: 'historical' }, reservations: {},
} }, blockedLogins: [], blockedRepositories: [] })
function mock({ failure = false, stopped = false, changed = false, alreadyClosed = false, wrongOwner = false } = {}) {
  let state = seed(), sha = 'a'.repeat(40)
  state.contacts[101].stopped = stopped
  const issue = { state: alreadyClosed ? 'closed' : 'open', body: 'https://github.com/Alice/plugin', html_url: 'https://github.com/AI-Scarlett/DSH-Store/issues/10' }
  const patches = []
  const api = {
    patches, get state() { return state },
    async paginate() { return [{ ...request, body: changed ? 'Do not close.' : request.body }] },
    async request(method, path, body) {
      if (path.includes('/contents/contacts.json')) {
        if (method === 'GET') return { sha, encoding: 'base64', size: 1000, content: Buffer.from(JSON.stringify(state)).toString('base64') }
        assert.equal(method, 'PUT'); assert.equal(body.sha, sha)
        state = JSON.parse(Buffer.from(body.content, 'base64')); sha = 'b'.repeat(40); return {}
      }
      if (path === '/user/101') return person
      if (path === '/repos/Alice/plugin') return { owner: wrongOwner ? { ...person, id: 102 } : person }
      if (method === 'GET') return issue
      assert.equal(method, 'PATCH')
      assert.ok(Object.keys(state.contacts[101].reservations).length > 0)
      patches.push(body)
      if (failure) throw new Error('uncertain PATCH')
      Object.assign(issue, body); return issue
    },
  }
  return api
}
test('explicit closure reserves centrally and sends exactly one state change without a comment', async () => {
  const github = mock()
  assert.equal((await closeReviewedIssue({ github, plan, seed: seed() })).closed, true)
  assert.deepEqual(github.patches, [{ state: 'closed', state_reason: 'not_planned' }])
  assert.equal((await closeReviewedIssue({ github, plan, seed: seed() })).reason, 'already-closed')
})
test('uncertain closure consumes request permanently and is never retried', async () => {
  const github = mock({ failure: true })
  await assert.rejects(closeReviewedIssue({ github, plan, seed: seed() }), /uncertain/)
  assert.equal((await closeReviewedIssue({ github, plan, seed: seed() })).reason, 'request-already-consumed')
  assert.equal(github.patches.length, 1)
})
test('withdrawal, wrong identity, stops, generic thanks and existing closures cannot send', async () => {
  for (const options of [{ changed: true }, { wrongOwner: true }]) {
    const github = mock(options)
    await assert.rejects(closeReviewedIssue({ github, plan, seed: seed() }))
    assert.equal(github.patches.length, 0)
  }
  for (const options of [{ stopped: true }, { alreadyClosed: true }]) {
    const github = mock(options)
    assert.equal((await closeReviewedIssue({ github, plan, seed: seed() })).closed, false)
    assert.equal(github.patches.length, 0)
  }
  assert.throws(() => validateCloseGrant({ ...plan, review: { ...plan.review, requestQuote: 'thanks' } }))
})
