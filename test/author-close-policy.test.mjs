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
function mock({ failure = false, stopped = false, changed = false, alreadyClosed = false, wrongOwner = false, deletedRepository = false, withdrawalPlan = null } = {}) {
  let state = seed(), sha = 'a'.repeat(40)
  state.contacts[101].stopped = stopped
  const issue = { state: alreadyClosed ? 'closed' : 'open', body: '<!-- dsh-author-notice:v1 key=Alice/plugin --> https://github.com/Alice/plugin', html_url: 'https://github.com/AI-Scarlett/DSH-Store/issues/10' }
  const patches = []
  const api = {
    patches, get state() { return state },
    async paginate() { return [{ ...request,
      body: changed ? 'Do not close.' : withdrawalPlan?.review.requestQuote ?? request.body,
      updated_at: withdrawalPlan?.requestUpdatedAt ?? request.updated_at,
    }] },
    async request(method, path, body) {
      if (path.includes('/contents/contacts.json')) {
        if (method === 'GET') return { sha, encoding: 'base64', size: 1000, content: Buffer.from(JSON.stringify(state)).toString('base64') }
        assert.equal(method, 'PUT'); assert.equal(body.sha, sha)
        state = JSON.parse(Buffer.from(body.content, 'base64')); sha = 'b'.repeat(40); return {}
      }
      if (path === '/user/101') return person
      if (path === '/repos/Alice/plugin') {
        if (deletedRepository) throw Object.assign(new Error('HTTP 404'), { status: 404 })
        return { owner: wrongOwner ? { ...person, id: 102 } : person }
      }
      if (path === '/repos/AI-Scarlett/DSH-Store/commits/main') return { sha: 'd'.repeat(40) }
      if (path.startsWith('/repos/AI-Scarlett/DSH-Store/compare/')) return { status: 'ahead' }
      if (path.startsWith('/repos/AI-Scarlett/DSH-Store/contents/registry/')) {
        const proof = withdrawalPlan.catalogWithdrawal
        const record = {
          repositoryUrlSha256: digest(`github-repository:${proof.repositoryUrl.toLowerCase()}`),
          requestRefSha256: digest(proof.requestUrl),
          requestBodySha256: proof.requestBodySha256,
        }
        const documents = {
          'catalog.json': { schemaVersion: 1, entries: [] },
          'catalog-index.json': { schemaVersion: 2, entries: [] },
          'automation-policy.json': { withdrawnRepositories: [record] },
        }
        const filename = path.split('/').at(-1).split('?')[0]
        const content = Buffer.from(JSON.stringify(documents[filename])).toString('base64')
        return { encoding: 'base64', size: Buffer.from(content, 'base64').length, content }
      }
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

test('an author-confirmed deleted repository can be closed only after a live 404 and the same contact reservation', async () => {
  const deletedPlan = {
    ...plan,
    subjectRepositoryState: 'not-found',
    requestBodySha256: digest('The repository has been deleted. Please close this issue.'),
    review: { ...plan.review, requestQuote: 'The repository has been deleted. Please close this issue.' },
    catalogWithdrawal: {
      catalogId: 'alice-plugin',
      repositoryUrl: 'https://github.com/Alice/plugin',
      catalogCommit: 'c'.repeat(40),
      requestUrl: 'https://github.com/AI-Scarlett/DSH-Store/issues/10#issuecomment-202',
      requestBodySha256: digest('The repository has been deleted. Please close this issue.'),
    },
  }
  const github = mock({ deletedRepository: true, withdrawalPlan: deletedPlan })
  assert.equal((await closeReviewedIssue({ github, plan: deletedPlan, seed: seed() })).closed, true)
  assert.deepEqual(github.patches, [{ state: 'closed', state_reason: 'not_planned' }])
  assert.throws(() => validateCloseGrant({ ...deletedPlan, review: { ...deletedPlan.review, requestQuote: 'Please close this issue.' } }), /deletion request/)
  assert.throws(() => validateCloseGrant({ ...deletedPlan, catalogWithdrawal: undefined }), /Catalog withdrawal proof/)
  await assert.rejects(closeReviewedIssue({ github: mock({ deletedRepository: true }), plan, seed: seed() }), /404/)
})
