#!/usr/bin/env node
// No automatic consent classifier. A request-specific reply plan must first be
// reviewed and merged to main, with the exact incoming comment and outgoing text.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubClient } from './author-contact-http.mjs'
import { humanIdentity, contactBody, digest, reserveContact, requireRepository, validateOwnerCorrection, CORRECTION_GRANT, CORRECTION_QUOTE, OWNER_REVIEW_GRANT, OWNER_REVIEW_QUOTE } from './author-contact-state.mjs'
import { verifyReplyResolution } from '../src/author-resolution.mjs'
import { loadCatalogFromFiles } from '../src/catalog.mjs'
import { isAdmissionRecheckRequest } from './collect-author-feedback.mjs'

export function validateReplyGrant(plan) {
  const ownerResult = plan?.operation === 'owner-authorized-review-result'
  if (plan?.schemaVersion !== 1 || !['requested-author-reply', 'owner-authorized-admission-correction', 'owner-authorized-review-result'].includes(plan.operation)
    || plan.review?.decision !== (ownerResult ? 'owner-directed-exact-result' : 'explicit-request-to-continue')
    || typeof plan.review.scope !== 'string' || !plan.review.scope.trim()
    || typeof plan.review.requestQuote !== 'string' || !plan.review.requestQuote.trim()
    || !Number.isSafeInteger(plan.userId) || plan.userId < 1
    || !Number.isSafeInteger(plan.issueNumber) || plan.issueNumber < 1
    || !Number.isSafeInteger(plan.requestCommentId) || plan.requestCommentId < 1
    || !/^[0-9a-f]{64}$/.test(plan.requestBodySha256)
    || !Number.isFinite(Date.parse(plan.requestUpdatedAt))
    || typeof plan.responseBody !== 'string' || !plan.responseBody.trim()) throw new Error('explicit reviewed continuation request required')
  requireRepository(plan.repository)
  if (plan.requestSource !== undefined && !['comment', 'issue-body'].includes(plan.requestSource)) throw new Error('unknown request source')
  if (plan.requestSource === 'issue-body' && (plan.repository !== 'AI-Scarlett/DSH-Store'
    || plan.operation !== 'requested-author-reply' || plan.review.kind !== 'admission-recheck'
    || !isAdmissionRecheckRequest(plan.review.requestQuote) || plan.review.priorExplicitRequest)) throw new Error('explicit issue-body admission request required')
  const related = plan.review.relatedRequests ?? []
  if (!Array.isArray(related) || related.length > 8 || related.some(r => !Number.isSafeInteger(r.issueNumber) || r.issueNumber < 1
    || !Number.isSafeInteger(r.commentId) || r.commentId < 1 || !/^[a-f0-9]{64}$/.test(r.bodySha256 ?? '')
    || !Number.isFinite(Date.parse(r.updatedAt)) || !isAdmissionRecheckRequest(r.quote))
    || new Set([plan.requestCommentId, ...related.map(r => r.commentId)]).size !== related.length + 1
    || new Set([plan.issueNumber, ...related.map(r => r.issueNumber)]).size !== related.length + 1
    || related.length && (plan.operation !== 'requested-author-reply' || plan.requestSource === 'issue-body'
      || plan.review.kind !== 'admission-recheck')) throw new Error('invalid coalesced admission requests')
  if (ownerResult) {
    if (plan.ownerAuthorization?.source !== 'direct-user-request' || plan.ownerAuthorization.quote !== OWNER_REVIEW_QUOTE
      || plan.ownerAuthorization.grantId !== OWNER_REVIEW_GRANT || plan.review.kind !== 'admission-recheck') throw new Error('finite owner review-result approval required')
    validateOwnerCorrection(plan.userId, plan.repository, correctionEvidence(plan))
  }
  if (plan.operation === 'owner-authorized-admission-correction') {
    if (plan.ownerAuthorization?.source !== 'direct-user-request' || plan.ownerAuthorization.quote !== CORRECTION_QUOTE
      || plan.ownerAuthorization.grantId !== CORRECTION_GRANT || plan.review.kind !== 'admission-recheck') throw new Error('finite owner correction approval required')
    validateOwnerCorrection(plan.userId, plan.repository, correctionEvidence(plan))
  }
  const quote = plan.review.requestQuote.trim()
  if (/^(?:thanks?\W*|thank you\W*|谢谢\W*|感谢\W*|好的\W*|ok\W*|[\p{Extended_Pictographic}\p{Emoji_Modifier}\s\uFE0F]+)$/iu.test(quote)) {
    throw new Error('acknowledgement is not continuation consent')
  }
}
function correctionEvidence(plan) {
  return { grantId: plan.ownerAuthorization?.grantId, issueNumber: plan.issueNumber, commentId: plan.requestCommentId, requestHash: plan.requestBodySha256 }
}
export async function verifyReplyRequest(github, plan) {
  validateReplyGrant(plan)
  const comments = await github.paginate(`/repos/${plan.repository}/issues/${plan.issueNumber}/comments`)
  const authorComments = comments.filter(comment => comment.user?.id === plan.userId)
    .sort((a, b) => Date.parse(a.updated_at ?? a.created_at) - Date.parse(b.updated_at ?? b.created_at) || a.id - b.id)
  let request = authorComments.at(-1)
  if (plan.requestSource === 'issue-body') {
    request = await github.request('GET', `/repos/${plan.repository}/issues/${plan.issueNumber}`)
    if (request?.number !== plan.issueNumber || request.state !== 'open' || request.pull_request
      || request.user?.id !== plan.userId || authorComments.length
      || comments.some(c => ['ai-scarlett', 'github-actions[bot]'].includes(String(c.user?.login).toLowerCase()))) {
      throw new Error('issue-body request was closed, answered, superseded or belongs to another person')
    }
  }
  if (request?.id !== plan.requestCommentId || digest(request.body) !== plan.requestBodySha256
    || request.updated_at !== plan.requestUpdatedAt
    || !request.body.includes(plan.review.requestQuote)) throw new Error('request changed, withdrawn, superseded or belongs to another person')
  const prior = plan.review.priorExplicitRequest
  if (prior) {
    const original = authorComments.find(comment => comment.id === prior.commentId)
    if (!original || original.updated_at !== prior.updatedAt || digest(original.body) !== prior.bodySha256
      || typeof prior.quote !== 'string' || !original.body.includes(prior.quote)
      || !isAdmissionRecheckRequest(prior.quote)
      || Date.parse(original.created_at) >= Date.parse(request.created_at)
      || comments.some(comment => ['ai-scarlett', 'github-actions[bot]'].includes(String(comment.user?.login).toLowerCase())
        && Date.parse(comment.created_at) > Date.parse(original.created_at))) {
      throw new Error('coalesced review request was changed, answered or is not explicit author consent')
    }
  }
  if (plan.review.kind === 'other-request' && isAdmissionRecheckRequest(request.body)) throw new Error('an admission recheck cannot bypass the terminal decision gate')
  const person = humanIdentity(await github.request('GET', `/user/${plan.userId}`))
  if (!person || person.node_id !== request.user.node_id) throw new Error('request author identity mismatch')
  for (const related of plan.review.relatedRequests ?? []) {
    await verifyReplyRequest(github, { ...plan, issueNumber: related.issueNumber,
      requestCommentId: related.commentId, requestBodySha256: related.bodySha256, requestUpdatedAt: related.updatedAt,
      review: { ...plan.review, requestQuote: related.quote, relatedRequests: [], priorExplicitRequest: undefined } })
  }
  return person
}
export async function sendReviewedReply({ github, plan, seed }) {
  const person = await verifyReplyRequest(github, plan)
  const body = contactBody(plan.responseBody, person, false)
  const claim = await reserveContact({
    github, repository: 'AI-Scarlett/DSH-Store', key: plan.repository,
    recipient: person, claimId: digest(JSON.stringify(plan)), seed,
    ...(['owner-authorized-admission-correction', 'owner-authorized-review-result'].includes(plan.operation)
      ? { ownerCorrection: correctionEvidence(plan) }
      : { continuation: { commentId: plan.requestCommentId, requestHash: plan.requestBodySha256,
        ...(plan.requestSource === 'issue-body' ? { requestSource: 'issue-body', issueNumber: plan.issueNumber } : {}),
        ...(plan.review.relatedRequests?.length ? { relatedRequests: plan.review.relatedRequests.map(r => ({ commentId: r.commentId, requestHash: r.bodySha256 })) } : {}) } }),
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
  if (plan.review.kind === 'admission-recheck') {
    const resolutionBytes = await readFile('registry/author-resolutions.json')
    const remoteResolution = await github.request('GET', '/repos/AI-Scarlett/DSH-Store/contents/registry/author-resolutions.json?ref=main')
    if (remoteResolution.encoding !== 'base64' || digest(Buffer.from(remoteResolution.content, 'base64')) !== digest(resolutionBytes)) throw new Error('resolution is not the reviewed main authority')
    verifyReplyResolution(plan, resolutionBytes, (await loadCatalogFromFiles()).entries)
  }
  process.stdout.write(`REQUESTED_REPLY ${JSON.stringify(await sendReviewedReply({ github, plan }))}\n`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
