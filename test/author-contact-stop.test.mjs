import test from 'node:test'
import assert from 'node:assert/strict'
import { digest } from '../scripts/author-contact-state.mjs'
import { recordReviewedStop } from '../scripts/record-author-contact-stop.mjs'
import { validateCloseGrant } from '../scripts/close-author-contact.mjs'

const person = { id: 101, node_id: 'U_101', login: 'Alice', type: 'User' }
const body = 'Please do not contact me again.'
const plan = { schemaVersion: 1, operation: 'record-author-stop', repository: 'AI-Scarlett/DSH-Store', issueNumber: 10, userId: 101, requestCommentId: 201, requestBodySha256: digest(body), requestUpdatedAt: '2026-10-16T00:00:00Z', review: { decision: 'explicit-request-to-stop', requestQuote: body, scope: 'Record the global withdrawal without sending a message.' } }
const initial = () => ({ schemaVersion: 1, policy: 'github-person-once-v1', historyComplete: true, blockedLogins: [], blockedRepositories: [], contacts: { 101: { userId: 101, nodeId: 'U_101', logins: ['Alice'], stopped: false, firstContact: { kind: 'historical' }, reservations: { previous: { kind: 'first-contact', key: 'alice/plugin' } } } } })
function fixture({ conflict = false, changed = false, unknown = false, stopped = false } = {}) {
  const seed = initial(); let state = structuredClone(seed); let revision = 1; const calls = []
  if (unknown) { seed.contacts = {}; state.contacts = {} }
  if (stopped) { seed.contacts[101].stopped = true; state.contacts[101].stopped = true }
  const file = () => ({ sha: String(revision).repeat(40), encoding: 'base64', size: 1000, content: Buffer.from(JSON.stringify(state)).toString('base64') })
  return { seed, calls, current: () => state, github: {
    async paginate() { return [{ id: 201, user: person, body: changed ? 'Edited later' : body, updated_at: plan.requestUpdatedAt }] },
    async request(method, path, data) {
      calls.push({ method, path })
      if (method === 'GET' && path === '/user/101') return person
      if (method === 'GET' && path.endsWith('contents/contacts.json?ref=author-contact-state')) return file()
      if (method === 'PUT' && path.endsWith('contents/contacts.json')) {
        assert.equal(data.sha, file().sha); assert.equal(data.branch, 'author-contact-state')
        if (conflict) { conflict = false; revision++; state.contacts[101].reservations.concurrent = { kind: 'requested-reply', commentId: 199 }; throw Object.assign(new Error('conflict'), { status: 409 }) }
        state = JSON.parse(Buffer.from(data.content, 'base64')); revision++; return {}
      }
      throw new Error('notification or unexpected endpoint')
    },
  } }
}

test('a verified stop permanently blocks the person across projects without a notification', async () => {
  const f = fixture(); const result = await recordReviewedStop({ ...f, plan })
  assert.equal(result.stopped, true); assert.equal(result.notificationsSent, 0)
  assert.deepEqual(f.current().contacts[101].reservations.previous, initial().contacts[101].reservations.previous)
  assert.equal(f.current().contacts[101].stopped, true)
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, 1)
  assert.ok(f.calls.every(c => c.method === 'GET' || c.method === 'PUT' && c.path.endsWith('contents/contacts.json')))
})

test('CAS conflicts preserve concurrent reservations and a recorded stop is never cleared', async () => {
  const f = fixture({ conflict: true }); await recordReviewedStop({ ...f, plan })
  assert.equal(f.current().contacts[101].reservations.concurrent.commentId, 199)
  const again = await recordReviewedStop({ ...f, plan })
  assert.equal(again.changed, false); assert.equal(f.calls.filter(c => c.method === 'PUT').length, 2)
})

test('changed requests and unknown historical people fail before any ledger write', async () => {
  for (const options of [{ changed: true }, { unknown: true }]) {
    const f = fixture(options); await assert.rejects(recordReviewedStop({ ...f, plan }))
    assert.ok(f.calls.every(c => c.method === 'GET'))
  }
})

test('a historical completed-issue request is distinct from retirement, with unsupported reasons rejected', () => {
  const close = { ...plan, operation: 'requested-author-close', subjectRepository: 'Alice/plugin', stateReason: 'completed', review: { decision: 'explicit-request-to-close', requestQuote: '这条可以关掉了', scope: 'Close the historical issue only; no current installation approval.' } }
  assert.doesNotThrow(() => validateCloseGrant(close))
  assert.throws(() => validateCloseGrant({ ...close, stateReason: 'unknown' }))
})
