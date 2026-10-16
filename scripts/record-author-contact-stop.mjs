#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubClient } from './author-contact-http.mjs'
import { digest, humanIdentity, readContactState, verifyHistoryPreserved } from './author-contact-state.mjs'

export function validateStopPlan(plan) {
  if (plan?.schemaVersion !== 1 || plan.operation !== 'record-author-stop'
    || plan.repository !== 'AI-Scarlett/DSH-Store'
    || !Number.isSafeInteger(plan.issueNumber) || plan.issueNumber < 1
    || !Number.isSafeInteger(plan.userId) || plan.userId < 1
    || !Number.isSafeInteger(plan.requestCommentId) || plan.requestCommentId < 1
    || !/^[a-f0-9]{64}$/.test(plan.requestBodySha256 ?? '')
    || !Number.isFinite(Date.parse(plan.requestUpdatedAt))
    || plan.review?.decision !== 'explicit-request-to-stop'
    || typeof plan.review.scope !== 'string' || !plan.review.scope.trim()
    || typeof plan.review.requestQuote !== 'string' || !plan.review.requestQuote.trim()) {
    throw new Error('main-reviewed exact author stop request required')
  }
}

async function verifyStopRequest(github, plan) {
  validateStopPlan(plan)
  const comments = await github.paginate(`/repos/${plan.repository}/issues/${plan.issueNumber}/comments`)
  const latest = comments.filter(c => c.user?.id === plan.userId)
    .sort((a, b) => Date.parse(a.updated_at ?? a.created_at) - Date.parse(b.updated_at ?? b.created_at) || a.id - b.id).at(-1)
  if (latest?.id !== plan.requestCommentId || digest(latest.body) !== plan.requestBodySha256
    || latest.updated_at !== plan.requestUpdatedAt || !latest.body.includes(plan.review.requestQuote)) {
    throw new Error('stop request changed or belongs to another person')
  }
  const person = humanIdentity(await github.request('GET', `/user/${plan.userId}`))
  if (!person || person.node_id !== latest.user.node_id) throw new Error('stop author identity mismatch')
  return person
}

// This operation sends no notification. It appends the verified stop evidence
// and permanently raises the existing person's global stop flag through CAS.
export async function recordReviewedStop({ github, plan, seed }) {
  const person = await verifyStopRequest(github, plan)
  const claimId = digest(JSON.stringify(plan))
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await readContactState(github, 'AI-Scarlett/DSH-Store', seed)
    const prior = before.state.contacts[String(person.id)]
    if (!prior || prior.nodeId !== person.node_id) throw new Error('unknown historical person; stop needs identity review')
    if (prior.stopped) return { stopped: true, changed: false, userId: person.id, reason: 'already-stopped' }
    if (prior.reservations[claimId]) throw new Error('existing stop claim without stop flag; manual recovery required')
    await verifyStopRequest(github, plan)
    const state = structuredClone(before.state)
    const record = state.contacts[String(person.id)]
    const evidence = { kind: 'requested-stop', key: plan.repository.toLowerCase(), reservedAt: new Date().toISOString(), commentId: plan.requestCommentId, requestHash: plan.requestBodySha256 }
    record.stopped = true
    record.reservations[claimId] = evidence
    verifyHistoryPreserved(state, before.state)
    try {
      await github.request('PUT', '/repos/AI-Scarlett/DSH-Store/contents/contacts.json', {
        branch: 'author-contact-state', sha: before.fileSha,
        message: `Record author contact stop ${person.id}`,
        content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64'),
      })
    } catch (error) {
      if (error.status === 409) continue
      throw error
    }
    for (let readAttempt = 0; readAttempt < 5; readAttempt++) {
      const after = await readContactState(github, 'AI-Scarlett/DSH-Store', seed)
      verifyHistoryPreserved(after.state, before.state)
      const saved = after.state.contacts[String(person.id)]
      if (saved?.stopped && JSON.stringify(saved.reservations[claimId]) === JSON.stringify(evidence)) {
        return { stopped: true, changed: true, userId: person.id, requestCommentId: plan.requestCommentId, ledgerBlob: after.fileSha, notificationsSent: 0 }
      }
      if (readAttempt < 4) await new Promise(r => setTimeout(r, 200))
    }
    throw new Error('stop readback uncertain; never undo stop evidence')
  }
  throw new Error('stop ledger CAS contention; no notification sent')
}

async function main() {
  const [flag, path, ...extra] = process.argv.slice(2)
  if (flag !== '--plan' || extra.length || !/^registry\/author-stops\/[a-z0-9-]+\.json$/.test(path ?? '')) throw new Error('main-reviewed author-stops plan required')
  const bytes = await readFile(resolve(path)), plan = JSON.parse(bytes)
  validateStopPlan(plan)
  const github = githubClient(process.env.GITHUB_TOKEN)
  const remote = await github.request('GET', `/repos/AI-Scarlett/DSH-Store/contents/${path}?ref=main`)
  if (remote.encoding !== 'base64' || digest(Buffer.from(remote.content, 'base64')) !== digest(bytes)) throw new Error('stop plan is not reviewed on main')
  process.stdout.write(`REQUESTED_STOP ${JSON.stringify(await recordReviewedStop({ github, plan }))}\n`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
