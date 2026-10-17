import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CONTACT_POLICY, digest } from '../scripts/author-contact-state.mjs'
import { firstContactDiscussionGate, sendFirstContacts, validateFirstContacts, verifySubmissionResolutions } from '../scripts/send-first-author-contact.mjs'

const person = { id: 1234, node_id: 'U_1234', login: 'Maintainer', type: 'User' }
const commit = 'a'.repeat(40)
function fixture(submission = false) {
  const plan = {
    schemaVersion: 1, operation: 'reviewed-first-author-contacts', repository: 'AI-Scarlett/DSH-Store',
    authorization: { source: 'direct-user-request', quote: '按照正常流程 该给用户发消息发消息' },
    targets: [{ key: 'Maintainer/plugin', repositoryId: 99, recipient: person, commit,
      patchPath: 'cordis.patch.yml', title: 'Specific review result', body: `Fixed Commit ${commit}\nConcrete findings and acceptance criteria.`,
      sourceFiles: ['package.json', 'cordis.patch.yml', 'LICENSE'].map(path => ({ path, blob: 'b'.repeat(40), sha256: 'c'.repeat(64) })),
      review: { sourceCoverage: 'complete-bounded-static', admission: 'not-admitted', thirdPartyCodeExecuted: false },
    }],
  }
  if (submission) {
    plan.operation = 'reviewed-submission-results'
    plan.authorization.quote = '然后在对应 issue 上用中文（可附英文）回复作者审核/复核结果和下一步。'
    Object.assign(plan.targets[0], { issueNumber: 17, issueId: 71, issueBodySha256: digest('Submission'), issueUpdatedAt: '2026-10-17T00:00:00Z' })
  }
  return plan
}
function mock({ timeout = false, mismatch = false, sourceDrift = false, withdrawal = false, submission = false, issueDrift = false } = {}) {
  let state = { schemaVersion: 1, policy: CONTACT_POLICY, historyComplete: true, contacts: {}, blockedLogins: [], blockedRepositories: [] }
  const seed = structuredClone(state), writes = [], plan = fixture(submission)
  let issue
  return {
    seed, writes, state: () => state,
    github: {
      paginate: async path => path.includes('/issues/comments') && withdrawal ? [{ user: person, body: 'Please do not contact me.' }] : [],
      request: async (method, path, body) => {
        if (method === 'PUT') { writes.push({ method, path }); state = JSON.parse(Buffer.from(body.content, 'base64')); return {} }
        if (method === 'POST') { writes.push({ method, path }); if (timeout) throw new Error('timeout'); issue = { ...body, id: 99, state: 'open', number: 17, html_url: 'https://github.com/AI-Scarlett/DSH-Store/issues/17#issuecomment-99' }; return issue }
        if (path.includes('/contents/contacts.json')) { const content = Buffer.from(JSON.stringify(state)); return { sha: 'd'.repeat(40), encoding: 'base64', size: content.length, content: content.toString('base64') } }
        if (path === '/user/1234') return person
        if (path === '/repos/Maintainer/plugin') return { full_name: 'Maintainer/plugin', id: 99, owner: person, private: false, archived: false, disabled: false, default_branch: 'main' }
        if (path.includes('/commits/main')) return { sha: sourceDrift ? 'f'.repeat(40) : commit }
        if (path.includes('/git/trees/')) return { truncated: false, tree: plan.targets[0].sourceFiles.map(file => ({ path: file.path, type: 'blob', mode: '100644', sha: file.blob })) }
        if (submission && path.endsWith('/issues/17')) return { id: 71, state: 'open', user: person, body: issueDrift ? 'Edited submission' : 'Submission', updated_at: plan.targets[0].issueUpdatedAt }
        if (path.endsWith('/issues/17') || path.endsWith('/issues/comments/99')) return mismatch ? { ...issue, body: 'changed' } : issue
        throw new Error(`unexpected request ${method} ${path}`)
      },
    },
  }
}

test('first contacts reserve centrally before the single Store issue and suppress every replay', async () => {
  const m = mock(), plan = fixture()
  const result = await sendFirstContacts({ ...m, plan })
  assert.equal(result[0].sent, true)
  assert.deepEqual(m.writes.map(w => w.method), ['PUT', 'POST'])
  assert.equal(m.writes[1].path, '/repos/AI-Scarlett/DSH-Store/issues')
  assert.equal(m.state().contacts[1234].reservations[result[0].claimId].kind, 'first-contact')
  const replay = await sendFirstContacts({ ...m, plan })
  assert.equal(replay[0].reason, 'already-contacted')
  assert.equal(m.writes.length, 2)
})

test('reviewed submissions reply on the bound Issue once and consume the person across all projects', async () => {
  const m = mock({ submission: true }), plan = fixture(true)
  const result = await sendFirstContacts({ ...m, plan })
  assert.equal(result[0].sent, true)
  assert.deepEqual(m.writes.map(w => w.method), ['PUT', 'POST'])
  assert.equal(m.writes[1].path, '/repos/AI-Scarlett/DSH-Store/issues/17/comments')
  assert.equal((await sendFirstContacts({ ...m, plan }))[0].reason, 'already-contacted')
  assert.equal(m.writes.length, 2)
})

test('edited submission and mismatched related author block before reservation', async () => {
  const m = mock({ submission: true, issueDrift: true })
  await assert.rejects(sendFirstContacts({ ...m, plan: fixture(true) }), /submission changed/)
  assert.equal(m.writes.length, 0)
  const plan = fixture(true)
  plan.targets[0].relatedSubmissions = [{ ...plan.targets[0], issueNumber: 18, recipient: { ...person, id: 5555 } }]
  assert.throws(() => validateFirstContacts(plan), /related submission identity/)
})

test('uncertain submission comment and failed readback never release a slot or retry POST', async () => {
  for (const options of [{ timeout: true }, { mismatch: true }]) {
    const m = mock({ ...options, submission: true }), plan = fixture(true)
    assert.equal((await sendFirstContacts({ ...m, plan }))[0].reason, 'failed-or-uncertain-do-not-retry')
    assert.equal((await sendFirstContacts({ ...m, plan }))[0].reason, 'already-contacted')
    assert.equal(m.writes.filter(w => w.method === 'POST').length, 1)
  }
})

test('submission result requires a hash-bound terminal Catalog decision for the exact source', () => {
  const plan = fixture(true), target = plan.targets[0]
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, resolutions: [{ issueNumber: 17, requestCommentId: 71,
    userId: person.id, requestBodySha256: target.issueBodySha256, commit, binding: 'c'.repeat(64), repositoryUrl: 'https://github.com/Maintainer/plugin',
    version: '1.0.0', catalogId: 'plugin', summary: 'Rejected exact source', evidenceUrl: 'https://github.com/Maintainer/plugin/commit/' + commit,
    decision: 'rejected', blockers: [{ owner: 'author', code: 'AUTH001', file: 'index.js', line: 1, finding: 'Missing caller boundary', requiredChange: 'Reject untrusted callers', acceptance: 'Refusal before mutation' }] }] }))
  plan.resolution = { path: 'registry/author-resolutions.json', sha256: digest(bytes) }
  target.body += '\nAUTH001 https://github.com/Maintainer/plugin/commit/' + commit
  assert.doesNotThrow(() => verifySubmissionResolutions(plan, bytes))
  assert.throws(() => verifySubmissionResolutions(plan, Buffer.from('{}')), /hash-bound/)
  target.commit = 'f'.repeat(40)
  assert.throws(() => verifySubmissionResolutions(plan, bytes), /differs/)
})

test('uncertain send and failed readback consume the person permanently without POST retries', async () => {
  for (const options of [{ timeout: true }, { mismatch: true }]) {
    const m = mock(options), plan = fixture()
    assert.equal((await sendFirstContacts({ ...m, plan }))[0].reason, 'failed-or-uncertain-do-not-retry')
    assert.equal((await sendFirstContacts({ ...m, plan }))[0].reason, 'already-contacted')
    assert.equal(m.writes.filter(w => w.method === 'POST').length, 1)
    assert.ok(m.state().contacts[1234])
  }
})

test('source drift, incomplete imported history and live withdrawal stop first outreach', async () => {
  const drift = mock({ sourceDrift: true })
  await assert.rejects(sendFirstContacts({ ...drift, plan: fixture() }), /source Commit changed/)
  assert.equal(drift.writes.length, 0)
  const history = mock(); history.seed.historyComplete = false
  await assert.rejects(sendFirstContacts({ ...history, plan: fixture() }), /history missing or incomplete/)
  const withdrawal = mock({ withdrawal: true })
  assert.equal((await sendFirstContacts({ ...withdrawal, plan: fixture() }))[0].reason, 'withdrawal-in-current-history')
  assert.equal(withdrawal.writes.length, 0)
})

test('unimported historical mentions block contact and incomplete discussion pagination fails closed', async () => {
  for (const login of ['AI-Scarlett', 'github-actions[bot]']) {
    const github = { paginate: async path => path.includes('/comments') ? [] : [{ user: { login }, body: '@Maintainer prior message' }] }
    assert.equal(await firstContactDiscussionGate(github, fixture().targets[0]), 'unimported-prior-contact')
  }
  await assert.rejects(firstContactDiscussionGate({ paginate: async () => { throw new Error('page bound exceeded') } }, fixture().targets[0]), /page bound exceeded/)
  const noMention = { paginate: async path => path.includes('/comments')
    ? [{ user: { login: 'github-actions[bot]' }, issue_url: 'https://api.github.com/repos/AI-Scarlett/DSH-Store/issues/8', body: 'Earlier submission result without a mention' }]
    : [{ number: 8, user: person, body: 'Prior submission' }] }
  assert.equal(await firstContactDiscussionGate(noMention, fixture().targets[0]), 'unimported-prior-contact')
})

test('combined submission results revalidate every related source before consuming the one person slot', async () => {
  const m = mock({ submission: true }), plan = fixture(true)
  plan.targets[0].relatedSubmissions = [{ ...plan.targets[0], issueNumber: 18, issueId: 72 }]
  const original = m.github.request; let heads = 0
  m.github.request = async (method, path, body) => {
    if (path.includes('/commits/main') && ++heads === 2) return { sha: 'f'.repeat(40) }
    return original(method, path, body)
  }
  await assert.rejects(sendFirstContacts({ ...m, plan }), /source Commit changed/)
  assert.equal(m.writes.length, 0)
})

test('first-contact scope rejects duplicates, ambiguous humans, missing bindings and non-static reviews', () => {
  for (const mutate of [
    p => p.targets.push(structuredClone(p.targets[0])),
    p => { p.targets[0].recipient = { ...person, type: 'Organization' } },
    p => { p.targets[0].sourceFiles.pop() },
    p => { p.targets[0].review.thirdPartyCodeExecuted = true },
    p => { p.targets[0].commit = 'main' },
  ]) { const p = fixture(); mutate(p); assert.throws(() => validateFirstContacts(p)) }
})

test('reviewed two-candidate notice keeps exact evidence and Store responsibilities', async () => {
  const plan = JSON.parse(await readFile('registry/author-first-contacts/new-candidates-20261017.json'))
  validateFirstContacts(plan)
  assert.equal(plan.targets.length, 2)
  for (const target of plan.targets) {
    assert.match(target.body, /验收|准入/)
    assert.ok(target.body.includes(target.commit))
    assert.equal(target.review.runtimeAcceptance, 'unverified')
  }
  assert.match(plan.targets[0].body, /engines.node/)
  assert.match(plan.targets[1].body, /SHA-256/)
  assert.match(plan.targets[1].body, /由商城承担/)
})
