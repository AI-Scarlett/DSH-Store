import assert from 'node:assert/strict'
import test from 'node:test'
import { authorFeedbackText, collectAuthorFeedback, isDshStoreProblem, isAdmissionRecheckRequest, parseArgs, sha256, validateAuthorFeedback } from '../scripts/collect-author-feedback.mjs'

const issue = {
  number: 434,
  title: '作者修复请求：vshulcz/deja-vu（DSH STORE）',
  url: 'https://github.com/AI-Scarlett/DSH-Store/issues/434',
  author: { id: 99616188, login: 'vshulcz', node_id: 'U_kgDOBfAFvA' },
}
const managedBotIssue = {
  number: 434,
  title: issue.title,
  url: issue.url,
  body: '<!-- dsh-author-notice:v1 key=vshulcz/deja-vu signature=abc -->',
  author: { id: 41898282, login: 'github-actions[bot]', node_id: 'MDM6Qm90NDE4OTgyODI=', type: 'Bot' },
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
  assert.equal(isDshStoreProblem('感谢 DSH STORE 的自动检查与修复建议，已完成整改，请安排复检。'), false)
  assert.equal(isDshStoreProblem('DSH STORE 的自动复检已完成，当前版本请按固定 Commit 重新入库。'), false)
})

test('an author remediation recheck is actionable even when it reports no Store bug, and stops win', async () => {
  const body = '已修复并发布 1.2.3，请按新的固定 Commit 复检。'
  assert.equal(isDshStoreProblem(body), false)
  assert.equal(isAdmissionRecheckRequest(body), true)
  assert.equal(isAdmissionRecheckRequest('请复检，但不要再发消息给我。'), false)
  assert.equal(isAdmissionRecheckRequest('谢谢\n> 请复核新版本'), false)
  const request = { id: 21, body, user: author, created_at: '2026-10-16T10:00:00Z', html_url: 'https://github.com/AI-Scarlett/DSH-Store/issues/434#issuecomment-21' }
  const args = { github: mock([request]), issues: [issue], observedAt: '2026-10-16T11:00:00Z' }
  const result = await collectAuthorFeedback(args)
  assert.equal(result.summary.admissionRechecks, 1)
  assert.equal(result.items[0].requiresTerminalDecision, true)
  const resolved = await collectAuthorFeedback({ ...args, resolutions: [{ requestCommentId: 21, userId: author.id, requestBodySha256: sha256(body) }] })
  assert.equal(resolved.items.length, 0)
  const changed = await collectAuthorFeedback({ ...args, resolutions: [{ requestCommentId: 21, userId: author.id, requestBodySha256: '0'.repeat(64) }] })
  assert.equal(changed.items.length, 1)
})

test('author feedback classifier ignores quoted bot notifications in email replies', () => {
  const body = '可以帮我提pr么\n\n---- 回复的原邮件 ----\n@huangruiteng 自动复检发现 automaticFollowups 问题，请修复 workflow。'
  assert.equal(authorFeedbackText(body), '可以帮我提pr么')
  assert.equal(isDshStoreProblem(body), false)
  assert.equal(isDshStoreProblem('请修复重复 @mention。\n> automaticFollowups: false'), true)
})

test('CLI argument parser consumes flag values exactly once', () => {
  assert.deepEqual(parseArgs([
    '--issues', '/tmp/issues.json',
    '--observed-at', '2026-09-07T10:00:00Z',
    '--output', '/tmp/feedback.json',
  ]), {
    issues: '/tmp/issues.json',
    'observed-at': '2026-09-07T10:00:00Z',
    output: '/tmp/feedback.json',
  })
  assert.throws(() => parseArgs(['--issues', '/tmp/issues.json', '--issues', '/tmp/other.json']), /duplicate argument/)
  assert.throws(() => parseArgs(['--issues']), /requires a value/)
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

test('collector matches the verified notification target when the Issue was created by the bot', async () => {
  const body = 'Every push creates another automaticFollowups notice; this is a DSH Store workflow problem.'
  const feedback = await collectAuthorFeedback({
    github: mock([{ id: 15, body, user: author, created_at: '2026-09-07T09:00:00Z', html_url: 'https://github.com/AI-Scarlett/DSH-Store/issues/434#issuecomment-15' }]),
    issues: [managedBotIssue],
    notificationTargets: { 'vshulcz/deja-vu': author },
    observedAt: '2026-09-07T10:00:00Z',
  })
  assert.equal(feedback.summary.storeProblems, 1)
  assert.equal(feedback.items[0].author.login, 'vshulcz')
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

test('collector does not revive an older Store problem after a later stop request', async () => {
  const feedback = await collectAuthorFeedback({
    github: mock([
      { id: 16, body: 'The repeated workflow mentions are a DSH Store problem.', user: author, created_at: '2026-09-07T09:00:00Z' },
      { id: 17, body: '不要再发消息给我了，请关闭这个 issue。', user: author, created_at: '2026-09-07T10:00:00Z' },
    ]),
    issues: [issue],
    observedAt: '2026-09-07T10:00:00Z',
  })
  assert.deepEqual(feedback.items, [])
})

test("collector skips issues with zero comments without querying comments API", async () => {
  let called = false
  const github = {
    paginate: async () => {
      called = true
      return []
    },
  }
  const zeroCommentIssue = {
    number: 999,
    title: "Test issue",
    url: "https://github.com/AI-Scarlett/DSH-Store/issues/999",
    comments: 0,
    author: { id: 99616188, login: "vshulcz", node_id: "U_kgDOBfAFvA" },
  }
  const feedback = await collectAuthorFeedback({
    github,
    issues: [zeroCommentIssue],
    observedAt: "2026-09-07T10:00:00Z",
  })
  assert.equal(called, false)
  assert.equal(feedback.items.length, 0)
})
test('collector rejects when managed issue snapshot exceeds bound', async () => {
  await assert.rejects(
    () => collectAuthorFeedback({ github: mock([]), issues: Array.from({ length: 2501 }, () => ({})) }),
    /snapshot is invalid/
  )
})
