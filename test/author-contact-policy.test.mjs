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
      if (path.includes('/issues?state=all')) return [...issues.values()]
      if (path.includes('/issues/comments?')) return structuredClone(comments)
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
test("target resolution reuses cached account across repositories owned by the same person", async () => {
  let userFetches = 0
  const request = async path => {
    if (path === "/repos/alice/one") return { full_name: "alice/one", owner: person }
    if (path === "/repos/alice/two") return { full_name: "alice/two", owner: person }
    if (path === "/user/" + person.id) {
      userFetches++
      return person
    }
    throw new Error("unexpected path: " + path)
  }
  const accountCache = new Map()
  const one = await resolveTargets(request, "alice/one", accountCache)
  const two = await resolveTargets(request, "alice/two", accountCache)
  assert.equal(one.login, "Alice")
  assert.equal(two.login, "Alice")
  assert.equal(userFetches, 1)
})
test('target resolution includes every historical managed Issue for feedback collection', () => {
  const issues = [
    { body: '<!-- dsh-author-notice:v1 key=alice/one signature=abc -->' },
    { body: '<!-- dsh-author-notice:v1 key=alice/one signature=def -->' },
    { body: '<!-- dsh-author-notice:v1 key=bob/two signature=ghi -->' },
    { body: 'ordinary Issue without a managed marker' },
  ]
  assert.deepEqual(repositoryKeysFromIssues(issues), ['alice/one', 'bob/two'])
  assert.throws(() => repositoryKeysFromIssues(Array.from({ length: 2501 }, () => ({ body: '' }))), /snapshot is invalid/)
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
test("HTTP client retries GET on 429 and rate-limited 403", async () => {
  let attempts = 0
  const fetcher = async () => {
    attempts++
    if (attempts === 1) return { ok: false, status: 429, headers: new Headers({ "retry-after": "0" }) }
    if (attempts === 2) return { ok: false, status: 403, headers: new Headers({ "x-ratelimit-remaining": "0" }) }
    return { ok: true, status: 200, json: async () => ({ success: true }) }
  }
  const client = githubClient("token", fetcher)
  const result = await client.request("GET", "/rate-test")
  assert.equal(result.success, true)
  assert.equal(attempts, 3)
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
  requestUpdatedAt: '2026-09-07T01:00:00Z',
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
test('an other-request carrying a final admission decision must bind the terminal resolution', () => {
  const p = grant()
  p.review = { ...p.review, kind: 'other-request', finalAdmissionDecision: true }
  assert.throws(() => validateReplyGrant(p), /bind the terminal resolution/)
  p.resolution = { path: 'registry/author-resolutions.json', sha256: 'a'.repeat(64) }
  assert.doesNotThrow(() => validateReplyGrant(p))
})
test('a request-bound final reply can atomically record a permanent stop before the single post', async () => {
  const p = grant()
  const request = 'Please confirm when the current public references have been removed.'
  p.requestBodySha256 = digest(request)
  p.stopAfterReply = true
  p.review = { ...p.review, kind: 'other-request', requestQuote: request, scope: 'Confirm removal, then permanently stop future contact.' }
  assert.doesNotThrow(() => validateReplyGrant(p))
  const api = mock(prior())
  api.comments.push(incoming(request))
  const result = await sendReviewedReply({ github: api, plan: p, seed: empty() })
  assert.equal(result.sent, true)
  assert.equal(api.posts.length, 1)
  assert.equal(api.state.contacts[101].stopped, true)
  assert.equal(Object.values(api.state.contacts[101].reservations)[0].stopAfterReservation, true)
  assert.equal(contactDecision(api.state, person, 'alice/new-project'), 'stopped')
  assert.equal((await sendReviewedReply({ github: api, plan: p, seed: empty() })).sent, false)
  assert.equal(api.posts.length, 1)
})
test('a permanent stop cannot be attached to a general or admission-result reply', () => {
  const p = grant(); p.stopAfterReply = true; p.review.kind = 'other-request'
  assert.throws(() => validateReplyGrant(p), /permanent stop/)
  p.review.scope = 'Permanently stop future contact.'; p.review.kind = 'admission-recheck'
  assert.throws(() => validateReplyGrant(p), /permanent stop/)
})
test('a verified explicit request grants one reply for that request only', async () => {
  const api = mock(prior()); api.comments.push(incoming())
  const first = await sendReviewedReply({ github: api, plan: grant(), seed: empty() })
  assert.equal(first.sent, true)
  assert.equal((await sendReviewedReply({ github: api, plan: grant(), seed: empty() })).sent, false)
  assert.equal(api.posts.length, 1)
  assert.equal(contactDecision(api.state, person, 'alice/new-project'), 'already-contacted')
})
test('a maintainer reply posted after the exact request suppresses a later duplicate send', async () => {
  const api = mock(prior())
  api.comments.push(incoming())
  api.comments.push({ id: 124, user: { login: 'github-actions[bot]' }, created_at: '2026-09-07T02:00:00Z', body: 'Already answered.' })
  await assert.rejects(verifyReplyRequest(api, grant()), /already has a maintainer response/)
  assert.equal(api.posts.length, 0)
})
test('supplemental source evidence coalesces only a still-unanswered exact author review request', async () => {
  const original = incoming('请复核此固定 Commit。', 122)
  const latest = { ...incoming('补充当前版本的兼容证据。'), created_at: '2026-09-07T02:00:00Z', updated_at: '2026-09-07T02:00:00Z' }
  const p = grant(); p.requestBodySha256 = digest(latest.body); p.requestUpdatedAt = latest.updated_at
  p.review.requestQuote = latest.body
  p.review.priorExplicitRequest = { commentId: original.id, updatedAt: original.updated_at, bodySha256: digest(original.body), quote: original.body }
  const api = mock(prior()); api.comments.push(original, latest)
  await assert.doesNotReject(verifyReplyRequest(api, p))
  api.comments.push({ user: { login: 'AI-Scarlett' }, created_at: '2026-09-07T01:30:00Z', body: 'Already answered' })
  await assert.rejects(verifyReplyRequest(api, p), /answered/)
  api.comments.pop(); original.body = 'Thanks'
  await assert.rejects(verifyReplyRequest(api, p), /not explicit author consent/)
  assert.equal(api.posts.length, 0)
})
test('withdrawal, edited requests, another author and global stops invalidate older consent', async () => {
  for (const change of [
    api => api.comments.push({ ...incoming('Do not contact me again.', 124), updated_at: '2026-09-07T02:00:00Z' }),
    api => { api.comments[0].body = 'Thanks' },
    api => { api.comments[0].updated_at = '2026-09-07T02:00:00Z' },
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
  const event = { action: 'opened', issue: { number: 20, user: person, body: '### GitHub repository\n\nhttps://github.com/alice/one', updated_at: '2026-09-07T00:00:00Z' } }
  const quarantinedStore = { ...empty(), blockedRepositories: ['ai-scarlett/dsh-store'] }
  assert.equal(submissionDecision(event, quarantinedStore), 'first-contact')
  assert.equal(submissionDecision(event, { ...quarantinedStore, blockedRepositories: ['alice/one'] }), 'historical-repository')
  assert.equal(submissionDecision({ ...event, issue: { ...event.issue, body: 'invalid input' } }, empty()), 'invalid-submission-repository')
  assert.equal(submissionDecision(event, prior()), 'already-contacted')
  for (const action of ['edited', 'reopened']) assert.equal(submissionDecision({ ...event, action }, empty()), 'not-an-initial-submission')
  const api = mock(); api.issues.set(20, { ...event.issue, state: 'open' })
  const dir = await mkdtemp(join(tmpdir(), 'contact-test-'))
  try {
    const first = await sendSubmissionResult({ github: api, event, report: 'Result @Bob', baseCommit: 'a'.repeat(40), planPath: join(dir, 'first.json'), seed: empty() })
    assert.equal(first.sent, true); assert.equal(api.posts.length, 1)
    assert.equal(Object.values(api.state.contacts[101].reservations)[0].key, 'alice/one')
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

const correctionPerson = { id: 283827478, node_id: 'U_correction', login: 'yanfei0725', type: 'User' }
const correction = { grantId: 'author-admission-final-20261016', issueNumber: 1390, commentId: 6213375613, requestHash: '159fa3ed188899c9841a22d94ea1210909c5d60a7741d9ba078c884bddf49296' }
function correctionState() {
  return { ...empty(), contacts: { [correctionPerson.id]: {
    userId: correctionPerson.id, nodeId: correctionPerson.node_id, logins: [correctionPerson.login], stopped: false,
    firstContact: { kind: 'historical', evidence: ['original'] },
    reservations: { original: { kind: 'requested-reply', commentId: correction.commentId, requestHash: correction.requestHash } },
  } } }
}
const reserveCorrection = (api, evidence = correction, extra = {}) => reserveContact({ github: api,
  repository: 'AI-Scarlett/DSH-Store', key: 'AI-Scarlett/DSH-Store', recipient: correctionPerson,
  claimId: 'a'.repeat(64), seed: empty(), ownerCorrection: evidence, ...extra })
test('finite correction appends once and preserves the consumed request and original history', async () => {
  const before = correctionState(), api = mock(before)
  assert.equal((await reserveCorrection(api)).allowed, true)
  verifyHistoryPreserved(api.state, before)
  assert.equal((await reserveCorrection(api, correction, { claimId: 'b'.repeat(64) })).reason, 'correction-already-consumed')
  assert.equal((await reserve(api, correctionPerson, 'c'.repeat(64))).allowed, false)
  assert.equal(Object.keys(api.state.contacts[correctionPerson.id].reservations).length, 2)
})
test('correction refuses other people, requests, repositories, grant IDs and request hashes', async () => {
  for (const evidence of [{ ...correction, commentId: 2 }, { ...correction, grantId: 'renewed' }, { ...correction, requestHash: 'b'.repeat(64) }, { ...correction, issueNumber: 1415 }]) {
    await assert.rejects(reserveCorrection(mock(correctionState()), evidence), /finite owner/)
  }
  for (const extra of [{ recipient: bob }, { key: 'alice/one' }, { continuation: { commentId: 1 } }]) {
    await assert.rejects(reserveCorrection(mock(correctionState()), correction, extra))
  }
})
test('finite correction never overrides stops, unresolved aliases, missing or mismatched original evidence', async () => {
  for (const mutate of [
    state => { state.contacts[correctionPerson.id].stopped = true },
    state => { state.contacts[correctionPerson.id].reservations = {} },
    state => { state.contacts[correctionPerson.id].reservations.original.requestHash = 'b'.repeat(64) },
    state => { state.blockedLogins.push(correctionPerson.login) },
  ]) {
    const state = correctionState(); mutate(state); const api = mock(state)
    assert.equal((await reserveCorrection(api)).allowed, false); assert.equal(api.posts.length, 0)
  }
})
test('uncertain correction CAS and failed outbound attempts consume the finite grant permanently', async () => {
  const api = mock(correctionState()); api.failPutAfterCommit()
  await assert.rejects(reserveCorrection(api), /uncertain PUT/)
  assert.equal((await reserveCorrection(api)).reason, 'correction-already-consumed')
  const second = mock(correctionState()); await reserveCorrection(second); second.failMessage()
  await assert.rejects(second.request('POST', '/repos/AI-Scarlett/DSH-Store/issues/1390/comments', { body: 'final' }), /uncertain delivery/)
  assert.equal((await reserveCorrection(second, correction, { claimId: 'e'.repeat(64) })).allowed, false)
  assert.equal(second.posts.length, 1)
})
test('correction request is consumed once under concurrent reservations', async () => {
  const api = mock(correctionState())
  const result = await Promise.all([reserveCorrection(api), reserveCorrection(api, correction, { claimId: 'b'.repeat(64) })])
  assert.equal(result.filter(r => r.allowed).length, 1)
})
test('main-reviewed finite plans retain exact terminal decision bindings and owner approval', async () => {
  for (const number of [1390, 1415]) {
    const p = JSON.parse(await readFile(new URL(`../registry/author-replies/final-${number}-20261016.json`, import.meta.url)))
    validateReplyGrant(p)
    assert.equal(p.review.kind, 'admission-recheck')
    assert.throws(() => validateReplyGrant({ ...p, userId: 101 }), /finite owner/)
    assert.throws(() => validateReplyGrant({ ...p, ownerAuthorization: { ...p.ownerAuthorization, quote: 'Thanks' } }), /approval/)
  }
})

test('historical repository quarantine still blocks first contact but not a finite verified same-person request', async () => {
  const state = correctionState(); state.blockedRepositories.push('AI-Scarlett/DSH-Store')
  assert.equal(contactDecision(state, bob, 'AI-Scarlett/DSH-Store'), 'historical-repository')
  const api = mock(state)
  assert.equal((await reserveCorrection(api)).allowed, true)
  verifyHistoryPreserved(api.state, state)
  assert.deepEqual(api.state.blockedRepositories, state.blockedRepositories)
})

// The current owner specifically requested a result on this activity. Do not
// classify its version-only author comment as explicit continuation consent.
const ownerResultPerson = { id: 153054118, node_id: 'U_kgDOCR9rpg', login: 'ArisaYamatogi', type: 'User' }
const ownerResultEvidence = { grantId: 'owner-review-result-1386-20261017', issueNumber: 1386, commentId: 6219417205,
  requestHash: '85f65b52c83038502057c8fecd99e0485bf1bb59eaa3f6f2c2833876037e8c14' }
const ownerResultState = () => ({ ...empty(), contacts: { [ownerResultPerson.id]: {
  userId: ownerResultPerson.id, nodeId: ownerResultPerson.node_id, logins: [ownerResultPerson.login], stopped: false,
  firstContact: { kind: 'historical' }, reservations: {},
} } })
const reserveOwnerResult = (api, evidence = ownerResultEvidence, extra = {}) => reserveContact({ github: api,
  repository: 'AI-Scarlett/DSH-Store', recipient: ownerResultPerson, key: 'AI-Scarlett/DSH-Store', claimId: 'e'.repeat(64),
  seed: empty(), ownerCorrection: evidence, ...extra })

test('owner-directed result uses the central ledger once and cannot renew by changing claim/body', async () => {
  const api = mock(ownerResultState())
  assert.equal((await reserveOwnerResult(api)).allowed, true)
  const reservations = Object.values(api.state.contacts[ownerResultPerson.id].reservations)
  assert.equal(reservations[0].kind, 'owner-authorized-review-result')
  assert.equal((await reserveOwnerResult(api, ownerResultEvidence, { claimId: 'f'.repeat(64) })).allowed, false)
  assert.equal(Object.keys(api.state.contacts[ownerResultPerson.id].reservations).length, 1)
})

test('owner-directed grant rejects other identities, comments, channels, hashes and grants', async () => {
  for (const extra of [{ recipient: person }, { key: 'ArisaYamatogi/dsh-lecture-copilot' }, { continuation: { commentId: 1 } }]) {
    await assert.rejects(reserveOwnerResult(mock(ownerResultState()), ownerResultEvidence, extra))
  }
  for (const evidence of [{ ...ownerResultEvidence, issueNumber: 1390 }, { ...ownerResultEvidence, commentId: 6219417206 },
    { ...ownerResultEvidence, requestHash: 'a'.repeat(64) }, { ...ownerResultEvidence, grantId: 'renewed' }]) {
    await assert.rejects(reserveOwnerResult(mock(ownerResultState()), evidence), /finite owner/)
  }
})

test('owner-directed result preserves stops and remains consumed after uncertain reservation', async () => {
  const stopped = ownerResultState(); stopped.contacts[ownerResultPerson.id].stopped = true
  assert.equal((await reserveOwnerResult(mock(stopped))).allowed, false)
  const blocked = ownerResultState(); blocked.blockedLogins.push(ownerResultPerson.login)
  assert.equal((await reserveOwnerResult(mock(blocked))).allowed, false)
  assert.equal((await reserveOwnerResult(mock(empty()))).allowed, false)
  const api = mock(ownerResultState()); api.failPutAfterCommit()
  await assert.rejects(reserveOwnerResult(api), /uncertain/)
  assert.equal((await reserveOwnerResult(api)).allowed, false)
})

test('owner-directed reply plans name the owner authority without fabricating author consent', async () => {
  const p = JSON.parse(await readFile('registry/author-replies/recheck-1386-20261017.json', 'utf8'))
  assert.doesNotThrow(() => validateReplyGrant(p))
  assert.equal(p.review.decision, 'owner-directed-exact-result')
  assert.throws(() => validateReplyGrant({ ...p, review: { ...p.review, decision: 'explicit-request-to-continue' } }))
  assert.throws(() => validateReplyGrant({ ...p, userId: 101 }), /finite owner/)
  assert.throws(() => validateReplyGrant({ ...p, ownerAuthorization: { ...p.ownerAuthorization, quote: 'Thanks' } }), /approval/)
})

test('an exact explicit issue-body appeal uses the same consumed central request slot', async () => {
  const body = '请复核此固定 Commit。'
  const p = { ...grant(), repository: 'AI-Scarlett/DSH-Store', requestSource: 'issue-body', requestCommentId: 888,
    requestBodySha256: digest(body), review: { decision: 'explicit-request-to-continue', requestQuote: body, scope: 'One exact admission appeal', kind: 'admission-recheck' } }
  const api = mock(prior()); api.issues.set(10, { ...incoming(body, 888), number: 10, state: 'open' })
  assert.equal((await sendReviewedReply({ github: api, plan: p, seed: empty() })).sent, true)
  assert.equal(Object.values(api.state.contacts[101].reservations)[0].requestSource, 'issue-body')
  assert.equal((await sendReviewedReply({ github: api, plan: p, seed: empty() })).sent, false)
  assert.equal(api.posts.length, 1)
})

test('issue-body appeals reject edits, responses, superseding author comments, closure and submission-only text before reservation', async () => {
  const body = '请复核此固定 Commit。'
  const p = { ...grant(), repository: 'AI-Scarlett/DSH-Store', requestSource: 'issue-body', requestCommentId: 888,
    requestBodySha256: digest(body), review: { decision: 'explicit-request-to-continue', requestQuote: body, scope: 'One exact admission appeal', kind: 'admission-recheck' } }
  for (const change of [
    api => { api.issues.get(10).body = '撤回请求' },
    api => { api.issues.get(10).updated_at = '2026-09-08T00:00:00Z' },
    api => { api.issues.get(10).user = bob },
    api => { api.issues.get(10).state = 'closed' },
    api => { api.issues.get(10).pull_request = {} },
    api => api.comments.push(incoming('不要再联系', 456)),
    api => api.comments.push({ ...incoming('已处理', 456), user: { login: 'github-actions[bot]' } }),
  ]) {
    const api = mock(prior()); api.issues.set(10, { ...incoming(body, 888), number: 10, state: 'open' }); change(api)
    await assert.rejects(sendReviewedReply({ github: api, plan: p, seed: empty() }))
    assert.equal(Object.keys(api.state.contacts[101].reservations).length, 0)
    assert.equal(api.posts.length, 0)
  }
  assert.throws(() => validateReplyGrant({ ...p, review: { ...p.review, requestQuote: 'Here is a new plugin' } }))
  const api = mock(prior(true)); api.issues.set(10, { ...incoming(body, 888), number: 10, state: 'open' })
  assert.equal((await sendReviewedReply({ github: api, plan: p, seed: empty() })).sent, false)
})

test('one merged reply reserves both same-person project requests atomically and never reuses either', async () => {
  const api = mock(prior()); const second = { ...incoming('Please re-review commit abc.', 124) }
  const originalPaginate = api.paginate
  api.paginate = path => path.includes('/issues/11/') ? Promise.resolve([second]) : originalPaginate(path)
  api.comments.push(incoming())
  const p = grant(); p.review.kind = 'admission-recheck'
  p.review.relatedRequests = [{ issueNumber: 11, commentId: 124, bodySha256: digest(second.body), updatedAt: second.updated_at, quote: second.body }]
  assert.equal((await sendReviewedReply({ github: api, plan: p, seed: empty() })).sent, true)
  const record = Object.values(api.state.contacts[101].reservations)[0]
  assert.deepEqual(record.relatedRequests, [{ commentId: 124, requestHash: digest(second.body) }])
  assert.equal((await reserve(api, person, '8'.repeat(64), 'alice/two', { commentId: 124, requestHash: digest(second.body) })).allowed, false)
  assert.equal(api.posts.length, 1)
  const changed = mock(prior()); changed.comments.push(incoming()); changed.paginate = path => path.includes('/issues/11/') ? Promise.resolve([{ ...second, user: bob }]) : Promise.resolve(changed.comments)
  await assert.rejects(sendReviewedReply({ github: changed, plan: p, seed: empty() }))
  assert.equal(Object.keys(changed.state.contacts[101].reservations).length, 0)
})
