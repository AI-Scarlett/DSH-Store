#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubClient } from './author-contact-http.mjs'
import { contactDecision, contactBody, humanIdentity, readContactState, reserveContact, digest } from './author-contact-state.mjs'

export function submissionDecision(event, state) {
  if (event?.action !== 'opened') return 'not-an-initial-submission'
  if (!Number.isSafeInteger(event?.issue?.number) || event.issue.pull_request) return 'invalid-submission'
  return contactDecision(state, humanIdentity(event.issue.user), 'AI-Scarlett/DSH-Store')
}
export async function sendSubmissionResult({ github, event, report, baseCommit, planPath, seed }) {
  const repository = 'AI-Scarlett/DSH-Store'
  const snapshot = await readContactState(github, repository, seed)
  const decision = submissionDecision(event, snapshot.state)
  const plan = {
    schemaVersion: 1, operation: 'submission-first-contact', baseCommit, decision,
    eventSha256: digest(JSON.stringify(event)), reportSha256: digest(report),
    contactFileSha: snapshot.fileSha, recipient: humanIdentity(event?.issue?.user),
    issueNumber: event?.issue?.number ?? null,
  }
  const claimId = digest(JSON.stringify(plan))
  await writeFile(planPath, JSON.stringify({ ...plan, claimId }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  if (decision !== 'first-contact') return { sent: false, reason: decision }
  if (!/^[0-9a-f]{40}$/.test(baseCommit)) throw new Error('full main SHA required')
  const authority = await github.request('GET', `/repos/${repository}/commits/main`)
  if (authority.sha !== baseCommit) throw new Error('main changed after planning')
  const issue = await github.request('GET', `/repos/${repository}/issues/${plan.issueNumber}`)
  if (issue.user?.id !== plan.recipient.id || issue.updated_at !== event.issue.updated_at || issue.body !== event.issue.body || issue.state !== 'open') {
    throw new Error('submission changed after planning')
  }
  const live = humanIdentity(await github.request('GET', `/user/${plan.recipient.id}`))
  if (!live || live.node_id !== plan.recipient.node_id) throw new Error('submission identity changed')
  const body = contactBody(report, live, false)
  const claim = await reserveContact({ github, repository, recipient: live, key: repository, claimId, seed })
  if (!claim.allowed) return { sent: false, reason: claim.reason }
  const sent = await github.request('POST', `/repos/${repository}/issues/${issue.number}/comments`, { body })
  const readback = await github.request('GET', `/repos/${repository}/issues/comments/${sent.id}`)
  if (readback.body !== body) throw new Error('submission reply readback failed; reservation remains consumed')
  return { sent: true, url: readback.html_url }
}
async function main() {
  const args = process.argv.slice(2), options = {}
  for (let i = 0; i < args.length; i += 2) options[args[i].slice(2)] = args[i + 1]
  for (const key of ['event', 'report', 'base-commit', 'plan']) if (!options[key]) throw new Error(`--${key} required`)
  if (process.env.GITHUB_REPOSITORY !== 'AI-Scarlett/DSH-Store') throw new Error('central contact ledger required')
  const [event, report] = await Promise.all([readFile(resolve(options.event), 'utf8'), readFile(resolve(options.report), 'utf8')])
  const result = await sendSubmissionResult({
    github: githubClient(process.env.GITHUB_TOKEN), event: JSON.parse(event), report,
    baseCommit: options['base-commit'], planPath: resolve(options.plan),
  })
  process.stdout.write(`SUBMISSION_CONTACT ${JSON.stringify(result)}\n`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
