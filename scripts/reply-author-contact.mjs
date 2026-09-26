#!/usr/bin/env node
// No automatic consent classifier. A request-specific reply plan must first be
// reviewed and merged to main, with the exact incoming comment and outgoing text.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubClient } from './author-contact-http.mjs'
import { humanIdentity, contactBody, digest, reserveContact, requireRepository } from './author-contact-state.mjs'

export function validateReplyGrant(plan) {
  if (plan?.schemaVersion !== 1 || plan.operation !== 'requested-author-reply'
    || plan.review?.decision !== 'explicit-request-to-continue'
    || typeof plan.review.scope !== 'string' || !plan.review.scope.trim()
    || typeof plan.review.requestQuote !== 'string' || !plan.review.requestQuote.trim()
    || !Number.isSafeInteger(plan.userId) || plan.userId < 1
    || !Number.isSafeInteger(plan.issueNumber) || plan.issueNumber < 1
    || !Number.isSafeInteger(plan.requestCommentId) || plan.requestCommentId < 1
    || !/^[0-9a-f]{64}$/.test(plan.requestBodySha256)
    || typeof plan.responseBody !== 'string' || !plan.responseBody.trim()) throw new Error('explicit reviewed continuation request required')
  requireRepository(plan.repository)
  const quote = plan.review.requestQuote.trim()
  if (/^(?:thanks?\W*|thank you\W*|谢谢\W*|感谢\W*|好的\W*|ok\W*|[\p{Extended_Pictographic}\p{Emoji_Modifier}\s\uFE0F]+)$/iu.test(quote)) {
    throw new Error('acknowledgement is not continuation consent')
  }
}
export async function verifyReplyRequest(github, plan) {
  validateReplyGrant(plan)
  const comments = await github.paginate(`/repos/${plan.repository}/issues/${plan.issueNumber}/comments`)
  const authorComments = comments.filter(comment => comment.user?.id === plan.userId)
    .sort((a, b) => Date.parse(a.updated_at ?? a.created_at) - Date.parse(b.updated_at ?? b.created_at) || a.id - b.id)
  const request = authorComments.at(-1)
  if (request?.id !== plan.requestCommentId || digest(request.body) !== plan.requestBodySha256
    || !request.body.includes(plan.review.requestQuote)) throw new Error('request changed, withdrawn, superseded or belongs to another person')
  const person = humanIdentity(await github.request('GET', `/user/${plan.userId}`))
  if (!person || person.node_id !== request.user.node_id) throw new Error('request author identity mismatch')
  return person
}
export async function sendReviewedReply({ github, plan, seed }) {
  const person = await verifyReplyRequest(github, plan)
  const body = contactBody(plan.responseBody, person, false)
  const claim = await reserveContact({
    github, repository: 'AI-Scarlett/DSH-Store', key: plan.repository,
    recipient: person, claimId: digest(JSON.stringify(plan)), seed,
    continuation: { commentId: plan.requestCommentId, requestHash: plan.requestBodySha256 },
  })
  if (!claim.allowed) return { sent: false, reason: claim.reason }
  // Recheck the request after the CAS; cancellation never returns the slot.
  await verifyReplyRequest(github, plan)
  const sent = await github.request('POST', `/repos/${plan.repository}/issues/${plan.issueNumber}/comments`, { body })
  const readback = await github.request('GET', `/repos/${plan.repository}/issues/comments/${sent.id}`)
  if (readback.body !== body) throw new Error('reply readback failed; request stays consumed')
  return { sent: true, url: readback.html_url }
}
async function main() {
  const [flag, path, ...extra] = process.argv.slice(2)
  if (flag !== '--plan' || extra.length || !/^registry\/author-replies\/[a-z0-9-]+\.json$/.test(path ?? '')) throw new Error('a main-reviewed registry/author-replies/*.json plan is required')
  const bytes = await readFile(resolve(path)), plan = JSON.parse(bytes)
  validateReplyGrant(plan)
  const github = githubClient(process.env.GITHUB_TOKEN)
  const remote = await github.request('GET', `/repos/AI-Scarlett/DSH-Store/contents/${path}?ref=main`)
  if (remote.encoding !== 'base64' || digest(Buffer.from(remote.content, 'base64')) !== digest(bytes)) throw new Error('reply plan has not been published on main')
  process.stdout.write(`REQUESTED_REPLY ${JSON.stringify(await sendReviewedReply({ github, plan }))}\n`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
