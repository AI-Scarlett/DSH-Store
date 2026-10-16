#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubClient } from './author-contact-http.mjs'
import { digest, humanIdentity, requireRepository, reserveContact } from './author-contact-state.mjs'

export function validateCloseGrant(plan) {
  if (plan?.schemaVersion !== 1 || plan.operation !== 'requested-author-close'
    || plan.repository !== 'AI-Scarlett/DSH-Store'
    || !Number.isSafeInteger(plan.issueNumber) || plan.issueNumber < 1
    || !Number.isSafeInteger(plan.userId) || plan.userId < 1
    || !Number.isSafeInteger(plan.requestCommentId) || plan.requestCommentId < 1
    || !/^[a-f0-9]{64}$/.test(plan.requestBodySha256 ?? '')
    || plan.review?.decision !== 'explicit-request-to-close'
    || typeof plan.review.scope !== 'string' || !plan.review.scope.trim()
    || typeof plan.review.requestQuote !== 'string' || !/close|closing|关闭|关掉/i.test(plan.review.requestQuote)
    || !Number.isFinite(Date.parse(plan.requestUpdatedAt))
    || !['not_planned', 'completed'].includes(plan.stateReason)) throw new Error('reviewed explicit issue-closure request required')
  requireRepository(plan.subjectRepository)
}
export async function verifyCloseRequest(github, plan) {
  validateCloseGrant(plan)
  const issue = await github.request('GET', `/repos/${plan.repository}/issues/${plan.issueNumber}`)
  if (issue.pull_request || !issue.body?.includes(`https://github.com/${plan.subjectRepository}`)) throw new Error('closure subject mismatch')
  const comments = await github.paginate(`/repos/${plan.repository}/issues/${plan.issueNumber}/comments`)
  const latest = comments.filter(c => c.user?.id === plan.userId)
    .sort((a, b) => Date.parse(a.updated_at ?? a.created_at) - Date.parse(b.updated_at ?? b.created_at) || a.id - b.id).at(-1)
  if (latest?.id !== plan.requestCommentId || digest(latest.body) !== plan.requestBodySha256
    || latest.updated_at !== plan.requestUpdatedAt || !latest.body.includes(plan.review.requestQuote)) throw new Error('closure request changed, withdrawn or superseded')
  const person = humanIdentity(await github.request('GET', `/user/${plan.userId}`))
  const repository = await github.request('GET', `/repos/${plan.subjectRepository}`)
  if (!person || person.node_id !== latest.user.node_id || repository.owner?.id !== person.id
    || repository.owner.node_id !== person.node_id) throw new Error('closure author identity or ownership mismatch')
  return { person, issue }
}
export async function closeReviewedIssue({ github, plan, seed }) {
  const verified = await verifyCloseRequest(github, plan)
  if (verified.issue.state === 'closed') return { closed: false, reason: 'already-closed' }
  const claim = await reserveContact({ github, repository: 'AI-Scarlett/DSH-Store', key: plan.subjectRepository,
    recipient: verified.person, claimId: digest(JSON.stringify(plan)), seed,
    continuation: { commentId: plan.requestCommentId, requestHash: plan.requestBodySha256 } })
  if (!claim.allowed) return { closed: false, reason: claim.reason }
  const current = await verifyCloseRequest(github, plan)
  if (current.issue.state !== 'open') return { closed: false, reason: 'state-changed-after-reservation' }
  // One notification-producing request. Failure or uncertainty consumes the grant.
  await github.request('PATCH', `/repos/${plan.repository}/issues/${plan.issueNumber}`, { state: 'closed', state_reason: plan.stateReason })
  const readback = await github.request('GET', `/repos/${plan.repository}/issues/${plan.issueNumber}`)
  if (readback.state !== 'closed' || readback.state_reason !== plan.stateReason) throw new Error('closure readback failed; request stays consumed')
  return { closed: true, url: readback.html_url }
}
async function main() {
  const [flag, path, ...extra] = process.argv.slice(2)
  if (flag !== '--plan' || extra.length || !/^registry\/author-closures\/[a-z0-9-]+\.json$/.test(path ?? '')) throw new Error('main-reviewed author-closures plan required')
  const bytes = await readFile(resolve(path)), plan = JSON.parse(bytes)
  validateCloseGrant(plan)
  const github = githubClient(process.env.GITHUB_TOKEN)
  const remote = await github.request('GET', `/repos/AI-Scarlett/DSH-Store/contents/${path}?ref=main`)
  if (remote.encoding !== 'base64' || digest(Buffer.from(remote.content, 'base64')) !== digest(bytes)) throw new Error('closure plan has not been published on main')
  process.stdout.write(`REQUESTED_CLOSURE ${JSON.stringify(await closeReviewedIssue({ github, plan }))}\n`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
