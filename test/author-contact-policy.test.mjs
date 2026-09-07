import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { githubClient } from '../scripts/author-contact-http.mjs'
import { CONTACT_POLICY, humanIdentity, validateState, verifyHistoryPreserved, contactDecision, contactBody, reserveContact, digest } from '../scripts/author-contact-state.mjs'
import { buildAuthorNoticePlan } from '../scripts/plan-author-notices.mjs'
import { validatePlan, applyFirstContacts } from '../scripts/apply-author-notice-plan.mjs'
import { repositoryKeysFromIssues, resolveTargets } from '../scripts/resolve-author-notice-targets.mjs'
import { submissionDecision, sendSubmissionResult } from '../scripts/send-submission-result.mjs'
import { validateReplyGrant, verifyReplyRequest, sendReviewedReply } from '../scripts/reply-author-contact.mjs'

const person = { id: 101, node_id: 'U_101', login: 'Alice', type: 'User' }
const bob = { id: 102, node_id: 'U_102', login: 'Bob', type: 'User' }
const empty = () => ({ schemaVersion: 1, policy: CONTACT_POLICY, historyComplete: true, contacts: {}, blockedLogins: [], blockedRepositories: [] })
const prior = (stopped = false) => ({ ...empty(), contacts: { 101: { userId: 101, nodeId: 'U_101', logins: ['Alice'], stopped, firstContact: { kind: 'historical', evidence: ['https://github.com/AI-Scarlett/DSH-Store/issues/10'] }, reservations: {} } } })
function plan(state = empty(), people = { 'alice/one': person, 'alice/two': person }, extra = {}) {
  return buildAuthorNoticePlan({
    catalog: { entries: Object.keys(people).map((key, i) => ({
      id: 'plugin-' + i, name: 'Plugin ' + i, version: '1.0.0', commit: 'b'.repeat(40),
      status: 'blocked', statusReason: 'missing runtime files @unrelated',
      repositoryUrl: 'https://github.com/' + key,
    })) },
    candidates: { entries: [] }, report: { observedAt: '2026-09-07T00:00:00Z' },
    notificationTargets: people, existingIssues: [], baseCommit: 'a'.repeat(40),
    inputHashes: Object.fromEntries(['catalog', 'candidates', 'report', 'existingIssues', 'notificationTargets', 'contactState'].map(key => [key + 'Sha256', '1'.repeat(64)])),
    contactSnapshot: { fileSha: 'c'.repeat(40), state }, maxCreate: 10, ...extra,
  })
}
function mock(initial = empty()) {
  let state = structuredClone(initial), version = 1, messageFailure = false, putFailure = false
  let staleReads = 0
  let staleState = null
  const posts = [], comments = [], issues = new Map()
  const sha = () => version.toString(16).padStart(40, '0')
  const api = {
    posts, comments, issues,
    get state() { return state },
    failMessage() { messageFailure = true },
    failPutAfterCommit() { putFailure = true },
    delayReservationReadback(count = 1) { staleReads = count },
    async request(method, path, body) {
      if (path.includes('/contents/contacts.json')) {
        if (method === 'GET') {
          const visible = staleReads > 0 ? (staleReads -= 1, staleState) : state
          return { sha: sha(), encoding: 'base64', size: 2000, content: Buffer.from(JSON.stringify(visible ?? state)).toString('base64') }
        }
        assert.equal(method, 'PUT')
        if (body.sha !== sha()) throw Object.assign(new Error('conflict'), { status: 409 })
        staleState = structuredClone(state)
        state = JSON.parse(Buffer.from(body.content, 'base64')); version++
        if (putFailure) { putFailure = false; throw Object.assign(new Error('uncertain PUT'), { status: 503 }) }
        return { content: { sha: sha() } }
      }
      if (path.endsWith('/commits/main')) return { sha: 'a'.repeat(40) }
      if (path.startsWith('/user/')) return structuredClone(Number(path.split('/').at(-1)) === 101 ? person : bob)
      if (method === 'GET' && /^\/repos\/(alice|bob)\/[^/]+$/.test(path)) return { full_name: path.slice(7), owner: path.includes('/alice/') ? person : bob }
      if (method === 'GET' && path.includes('/issues/comments/')) return comments.find(c => c.id === Number(path.split('/').at(-1)))
      if (method === 'GET' && /\/issues\/\d+$/.test(path)) return issues.get(Number(path.split('/').at(-1)))
      if (method === 'POST' && (path.endsWith('/issues') || path.endsWith('/comments'))) {
        assert.ok(Object.keys(state.contacts).length > 0, 'reservation must precede the message')
        posts.push({ path, body })
        if (messageFailure) { messageFailure = false; throw Object.assign(new Error('uncertain delivery'), { status: 503 }) }
        if (path.endsWith('/comments')) {
          const c = { id: 999 + comments.length, body: body.body, html_url: 'https://github.com/example/comment' }
          comments.push(c); return c
        }
        const number = posts.length + 10
        const issue = { ...body, number, state: 'open', html_url: 'https://github.com/AI-Scarlett/DSH-Store/issues/' + number }
        issues.set(number, issue); return issue
      }
      throw new Error('unexpected API mutation or read ' + method + ' ' + path)
    },
    async paginate(path) {
      if (path.includes('/labels')) return plan().requiredLabels
      if (path.endsWith('/comments')) return structuredClone(comments)
      throw new Error('unexpected page ' + path)
    },
  }
  return api
}
const reserve = (api, recipient = person, claim = 'd'.repeat(64), key = 'alice/one', continuation = null) =>
  reserveContact({ github: api, repository: 'AI-Scarlett/DSH-Store', recipient, key, claimId: claim, seed: empty(), continuation })

test('two projects share one initial contact and a later renamed account stays consumed', () => {
  const p = plan(); assert.equal(p.schemaVersion, 2); assert.equal(p.actions.length, 1); validatePlan(p)
  assert.equal(p.contactDecisions[1].reason, 'same-person-this-plan')
  const renamed = { ...person, login: 'Renamed' }
  assert.equal(contactDecision(prior(), renamed, 'renamed/new-project'), 'already-contacted')
  assert.equal(plan(prior(), { 'renamed/new-project': renamed }).actions.length, 0)
  assert.equal(contactDecision(prior(), { ...bob, login: 'Alice' }, 'alice/other'), 'historical-alias')
})
test('old contacts do not exhaust the new-person selection limit', () => {
  const p = plan(prior(), { 'alice/one': person, 'bob/new': bob }, { maxCreate: 1 })
  assert.equal(p.actions[0].recipient.id, bob.id); assert.equal(p.summary.queuedNewIssues, 0)
})
test('history and stops cannot be removed, and uncertain identities are denied', () => {
  assert.equal(contactDecision(prior(true), person, 'alice/new'), 'stopped')
  assert.throws(() => validateState({ ...empty(), historyComplete: false }))
  assert.throws(() => verifyHistoryPreserved(empty(), prior()))
  assert.throws(() => verifyHistoryPreserved(prior(), prior(true)))
  for (const bad of [null, { ...person, type: 'Bot' }, { ...person, type: 'Organization' }, { ...person, id: undefined }]) {
    assert.equal(humanIdentity(bad), null); assert.equal(contactDecision(empty(), bad, 'alice/new'), 'unresolved-human')
  }
})
test('repository redirects, missing owners, organizations and bots do not fall back to a login', async () => {
  for (const owner of [null, { ...person, type: 'Organization' }, { ...person, type: 'Bot' }]) {
    assert.equal(await resolveTargets(async () => ({ full_name: 'alice/one', owner }), 'alice/one'), null)
  }
  assert.equal(await resolveTargets(async () => { throw Object.assign(new Error('gone'), { status: 404 }) }, 'alice/one'), null)
  assert.equal(await resolveTargets(async () => ({ full_name: 'different/one', owner: person }), 'alice/one'), null)
})
test('target resolution includes every historical managed Issue for feedback collection', () => {
  const issues = [
    { body: '<!-- dsh-author-notice:v1 key=alice/one signature=abc -->' },
    { body: '<!-- dsh-author-notice:v1 key=alice/one signature=def -->' },
    { body: '<!-- dsh-author-notice:v1 key=bob/two signature=ghi -->' },
    { body: 'ordinary Issue without a managed marker' },
  ]
  assert.deepEqual(repositoryKeysFromIssues(issues), ['alice/one', 'bob/two'])
  assert.throws(() => repositoryKeysFromIssues(Array.from({ length: 501 }, () => ({ body: '' }))), /snapshot is invalid/)
})
test('all historical thread updates, reopenings, baselines and closing notices are suppressed', () => {
  const old = plan().actions[0]
  for (const state of ['open', 'closed']) {
    const p = plan(prior(), undefined, { existingIssues: [{ number: 10, title: old.title, state, body: old.body, labels: [] }] })
    assert.equal(p.actions.length, 0); validatePlan(p)
  }
  const resolved = plan(prior(), {}, { existingIssues: [{ number: 10, title: old.title, state: 'open', body: old.body, labels: [] }] })
  assert.equal(resolved.actions.length, 0)
  assert.throws(() => validatePlan({ ...plan(), schemaVersion: 1 }))
  for (const type of ['update', 'notify', 'source-update', 'baseline', 'close']) {
    const p = plan(); p.actions[0].type = type; assert.throws(() => validatePlan(p), /followup/)
  }
})
test('a new fixed Commit does not trigger an automatic follow-up for an already-contacted author', () => {
  const old = plan().actions[0]
  const changedCatalog = {
    entries: [{
      id: 'plugin-0', name: 'Plugin 0', version: '1.0.0', commit: 'f'.repeat(40),
      status: 'blocked', statusReason: 'missing runtime files',
      repositoryUrl: 'https://github.com/alice/one',
    }],
  }
  const p = plan(prior(), undefined, {
    catalog: changedCatalog,
    existingIssues: [{ number: 11, title: old.title, state: 'open', body: old.body, labels: [] }],
  })
  assert.equal(p.actions.length, 0)
  assert.equal(p.summary.githubMessages, 0)
  assert.equal(p.summary.sourceUpdates, 0)
})
test('untrusted findings cannot mention extra people or encoded usernames', () => {
  const body = contactBody('@Bob &#64;Carol &#x40;Dave &commat;Eve', person)
  assert.deepEqual(body.match(/@[A-Za-z0-9-]+/g), ['@Alice'])
  const p = plan(); assert.deepEqual(p.actions[0].body.match(/@[A-Za-z0-9-]+/g), ['@Alice'])
  p.actions[0].body += '\n@Bob'; assert.throws(() => validatePlan(p), /recipient syntax/)
})
test('CAS permits one reservation under concurrent runs and preserves other people', async () => {
  const api = mock()
  const results = await Promise.all([reserve(api), reserve(api, person, 'e'.repeat(64), 'alice/two'), reserve(api, bob, 'f'.repeat(64), 'bob/one')])
  assert.equal(results.filter(r => r.allowed).length, 2)
  assert.equal(Object.keys(api.state.contacts).length, 2)
  assert.equal(Object.keys(api.state.contacts[101].reservations).length, 1)
  assert.equal((await reserve(api)).allowed, false)
})
test('crash after reservation and uncertain PUT never release the contact slot', async () => {
  const api = mock(); api.failPutAfterCommit()
  await assert.rejects(reserve(api), /uncertain PUT/)
  assert.equal((await reserve(api, person, 'e'.repeat(64))).allowed, false)
  assert.equal(api.posts.length, 0)
})
test('reservation readback tolerates a short-lived stale Contents response', async () => {
  const api = mock(); api.delayReservationReadback(1)
  const result = await reserve(api)
  assert.equal(result.allowed, true)
  assert.equal(Object.keys(api.state.contacts).length, 1)
})
test('message failure followed by a retry produces only one outbound attempt', async () => {
  const api = mock(); api.failMessage()
  const args = { plan: plan(), github: api, repository: 'AI-Scarlett/DSH-Store', seed: empty() }
  await assert.rejects(applyFirstContacts(args), /uncertain delivery/)
  const retry = await applyFirstContacts(args)
  assert.equal(retry[0].type, 'suppressed'); assert.equal(api.posts.length, 1)
})
test('HTTP client never retries POST, PATCH or PUT', async () => {
  for (const method of ['POST', 'PATCH', 'PUT']) {
    let attempts = 0
    const api = githubClient('fixture', async () => { attempts++; return { ok: false, status: 503 } })
    await assert.rejects(api.request(method, '/fixture', {})); assert.equal(attempts, 1)
  }
})
const requestBody = 'Please recheck this exact source and explain the remaining issue.'
const grant = () => ({
  schemaVersion: 1, operation: 'requested-author-reply', repository: 'alice/one',
  issueNumber: 10, userId: 101, requestCommentId: 123, requestBodySha256: digest(requestBody),
  review: { decision: 'explicit-request-to-continue', requestQuote: requestBody, scope: 'Explain the remaining source issue' },
  responseBody: 'Here is the requested result.',
})
function incoming(body = requestBody, id = 123) {
  return { id, body, user: person, created_at: '2026-09-07T01:00:00Z', updated_at: '2026-09-07T01:00:00Z' }
}
test('neutral replies and absent reviewed permission never grant continuation', () => {
  assert.throws(() => validateReplyGrant({ ...grant(), review: { decision: 'thanks' } }))
  for (const text of ['Thanks!', '谢谢', '👍', '好的', 'OK']) {
    const p = grant(); p.review.requestQuote = text; assert.throws(() => validateReplyGrant(p), /consent/)
  }
})
test('a verified explicit request grants one reply for that request only', async () => {
  const api = mock(prior()); api.comments.push(incoming())
  const first = await sendReviewedReply({ github: api, plan: grant(), seed: empty() })
  assert.equal(first.sent, true)
  assert.equal((await sendReviewedReply({ github: api, plan: grant(), seed: empty() })).sent, false)
  assert.equal(api.posts.length, 1)
  assert.equal(contactDecision(api.state, person, 'alice/new-project'), 'already-contacted')
})
test('withdrawal, edited requests, another author and global stops invalidate older consent', async () => {
  for (const change of [
    api => api.comments.push({ ...incoming('Do not contact me again.', 124), updated_at: '2026-09-07T02:00:00Z' }),
    api => { api.comments[0].body = 'Thanks' },
    api => { api.comments[0].user = bob },
  ]) {
    const api = mock(prior()); api.comments.push(incoming()); change(api)
    await assert.rejects(verifyReplyRequest(api, grant()))
    assert.equal(api.posts.length, 0)
  }
  const api = mock(prior(true)); api.comments.push(incoming())
  assert.equal((await sendReviewedReply({ github: api, plan: grant(), seed: empty() })).sent, false)
})
test('submission replies share the same person slot, and edits or new projects cannot renew it', async () => {
  const event = { action: 'opened', issue: { number: 20, user: person, body: 'Plugin submission', updated_at: '2026-09-07T00:00:00Z' } }
  assert.equal(submissionDecision(event, prior()), 'already-contacted')
  for (const action of ['edited', 'reopened']) assert.equal(submissionDecision({ ...event, action }, empty()), 'not-an-initial-submission')
  const api = mock(); api.issues.set(20, { ...event.issue, state: 'open' })
  const dir = await mkdtemp(join(tmpdir(), 'contact-test-'))
  try {
    const first = await sendSubmissionResult({ github: api, event, report: 'Result @Bob', baseCommit: 'a'.repeat(40), planPath: join(dir, 'first.json'), seed: empty() })
    assert.equal(first.sent, true); assert.equal(api.posts.length, 1)
    assert.equal((await reserve(api, person, 'e'.repeat(64), 'alice/new')).allowed, false)
    const second = await sendSubmissionResult({ github: api, event: { ...event, issue: { ...event.issue, number: 21 } }, report: 'New project', baseCommit: 'a'.repeat(40), planPath: join(dir, 'second.json'), seed: empty() })
    assert.equal(second.sent, false); assert.equal(api.posts.length, 1)
    assert.doesNotMatch(api.posts[0].body.body, /@Bob/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('checked historical seed blocks every known person even on a new repository', async () => {
  const seed = JSON.parse(await readFile(new URL('../registry/author-contact-history.json', import.meta.url)))
  validateState(seed)
  assert.ok(Object.keys(seed.contacts).length > 0)
  for (const record of Object.values(seed.contacts)) {
    const identity = { id: record.userId, node_id: record.nodeId, login: record.logins.at(-1), type: 'User' }
    assert.notEqual(contactDecision(seed, identity, 'unseen/project'), 'first-contact')
  }
  const bowen = Object.values(seed.contacts).find(r => r.logins.some(login => login.toLowerCase() === 'bowenliang123'))
  assert.equal(bowen.stopped, true)
})


test('candidate coverage stays complete when a paused author also has a public-only candidate', () => {
  const original = plan().actions[0]
  const p = plan(prior(true), { 'alice/one': person }, {
    existingIssues: [{ number: 10, title: original.title, state: 'closed', body: original.body, labels: ['author-notice-paused'] }],
    candidates: { entries: [{ id: 'alice-plugin', name: 'Plugin', description: 'DSH plugin', repositoryUrl: 'https://github.com/alice/one', status: 'reviewing', route: 'reviewing', topics: ['dsh-plugin'] }] },
  })
  assert.equal(p.actions.length, 0)
  assert.equal(p.candidateCoverage[0].notificationState, 'author-paused')
  assert.equal(p.summary.candidateCoverageAccounted, 1)
  assert.equal(p.summary.candidatePublicRegistryOnly, 1)
  validatePlan(p)
})
