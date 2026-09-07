import assert from 'node:assert/strict'
import test from 'node:test'
import { collectAuthorFeedback, isDshStoreProblem, sha256, validateAuthorFeedback } from '../scripts/collect-author-feedback.mjs'

const issue = {
  number: 434,
  title: '作者修复请求：vshulcz/deja-vu（DSH STORE）',
  url: 'https://github.com/AI-Scarlett/DSH-Store/issues/434',
  author: { id: 99616188, login: 'vshulcz', node_id: 'U_kgDOBfAFvA' },
}
const author = { id: 99616188, login: 'vshulcz', node_id: 'U_kgDOBfAFvA', type: 'User' }

function mock(comments) {
  return { paginate: async path => {
    assert.equal(path, '/repos/AI-Scarlett/DSH-Store/issues/434/comments')
    return comments
  } }
}

test('author feedback classifier only routes explicit DSH Store problems', () => {
  assert.equal(isDshStoreProblem('The Catalog scanner reports a false positive.'), true)
  assert.equal(isDshStoreProblem('感谢核查，当前固定 Commit 已更新。'), false)
})

test('collector keeps the latest verified issue-author Store problem and never echoes mentions', async () => {
  const body = 'Every push triggers a new @mention because automaticFollowups is false; please fix the workflow.'
  const feedback = await collectAuthorFeedback({
    github: mock([
      { id: 10, body: 'Catalog is working, thanks.', user: author, created_at: '2026-09-07T08:00:00Z' },
      { id: 11, body: 'A maintainer asks about the workflow.', user: { id: 44, login: 'maintainer', node_id: 'U_kgDOx', type: 'User' }, created_at: '2026-09-07T08:30:00Z' },
      { id: 12, body, user: author, created_at: '2026-09-07T09:00:00Z', html_url: 'https://github.com/AI-Scarlett/DSH-Store/issues/434#issuecomment-12' },
    ]),
    issues: [issue],
    observedAt: '2026-09-07T10:00:00Z',
  })
  validateAuthorFeedback(feedback)
  assert.equal(feedback.summary.storeProblems, 1)
  assert.equal(feedback.items[0].commentId, 12)
  assert.equal(feedback.items[0].bodySha256, sha256(body))
  assert.equal(feedback.items[0].needsManualReview, true)
  assert.doesNotMatch(feedback.items[0].excerpt, /@mention/)
  assert.match(feedback.items[0].excerpt, /＠mention/)
})

test('collector ignores comments from another person and ordinary author updates', async () => {
  const feedback = await collectAuthorFeedback({
    github: mock([
      { id: 13, body: 'Please review this source commit.', user: { id: 44, login: 'maintainer', node_id: 'U_kgDOx', type: 'User' }, created_at: '2026-09-07T09:00:00Z' },
      { id: 14, body: '感谢，已推送新的固定 Commit。', user: author, created_at: '2026-09-07T09:10:00Z' },
    ]),
    issues: [issue],
    observedAt: '2026-09-07T10:00:00Z',
  })
  assert.deepEqual(feedback.items, [])
})
