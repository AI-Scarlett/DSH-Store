#!/usr/bin/env node
// Main-reviewed first contacts share the normal immutable-person ledger. This
// entrypoint never grants continuations and never creates an upstream issue.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubClient } from './author-contact-http.mjs'
import { contactBody, digest, humanIdentity, readContactState, requireRepository, reserveContact } from './author-contact-state.mjs'
import { authorFeedbackText } from './collect-author-feedback.mjs'
import { resolveTargets } from './resolve-author-notice-targets.mjs'

const central = 'AI-Scarlett/DSH-Store'
const stopped = /不要再|停止联系|撤回|别再联系|do\s+not\s+contact|don[’']t\s+contact|stop\s+(?:contacting|messaging|notifications)|unsubscribe|withdraw/iu
export function validateFirstContacts(plan) {
  if (plan?.schemaVersion !== 1 || plan.operation !== 'reviewed-first-author-contacts'
    || plan.repository !== central || plan.authorization?.source !== 'direct-user-request'
    || plan.authorization?.quote !== '按照正常流程 该给用户发消息发消息'
    || !Array.isArray(plan.targets) || !plan.targets.length || plan.targets.length > 12) throw new Error('reviewed first-contact scope required')
  const people = new Set(), repositories = new Set()
  for (const target of plan.targets) {
    requireRepository(target.key)
    const person = humanIdentity(target.recipient)
    if (!person || people.has(person.id) || repositories.has(target.key.toLowerCase())
      || !Number.isSafeInteger(target.repositoryId) || target.repositoryId < 1
      || !/^[a-f0-9]{40}$/.test(target.commit ?? '')
      || typeof target.title !== 'string' || !target.title.trim() || target.title.length > 256 || target.title.includes('@')
      || typeof target.body !== 'string' || !target.body.includes(target.commit)
      || Buffer.byteLength(target.body) > 50_000
      || !Array.isArray(target.sourceFiles) || !target.sourceFiles.length || target.sourceFiles.length > 512
      || target.review?.sourceCoverage !== 'complete-bounded-static'
      || target.review?.admission !== 'not-admitted'
      || target.review?.thirdPartyCodeExecuted !== false) throw new Error('invalid first-contact target or source review')
    contactBody(target.body, person)
    people.add(person.id); repositories.add(target.key.toLowerCase())
    const paths = new Set()
    for (const file of target.sourceFiles) {
      if (!/^[A-Za-z0-9._/-]+$/.test(file.path ?? '') || file.path.startsWith('/') || file.path.includes('..')
        || paths.has(file.path) || !/^[a-f0-9]{40}$/.test(file.blob ?? '')
        || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')) throw new Error('invalid reviewed source binding')
      paths.add(file.path)
    }
    if (!paths.has('package.json') || !paths.has(target.patchPath) || !paths.has('LICENSE')) throw new Error('manifest, Bundle and license bindings required')
  }
}

export async function verifyFirstContactSource(github, target) {
  const person = await resolveTargets(path => github.request('GET', path), target.key)
  if (!person || person.id !== target.recipient.id || person.node_id !== target.recipient.node_id
    || person.login !== target.recipient.login) throw new Error('first-contact identity changed')
  const repository = await github.request('GET', `/repos/${target.key}`)
  if (repository.id !== target.repositoryId || repository.private !== false || repository.archived || repository.disabled) throw new Error('repository identity or public state changed')
  const head = await github.request('GET', `/repos/${target.key}/commits/${encodeURIComponent(repository.default_branch)}`)
  if (head.sha !== target.commit) throw new Error('reviewed source Commit changed; do not send stale findings')
  const tree = await github.request('GET', `/repos/${target.key}/git/trees/${target.commit}?recursive=1`)
  if (tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 10_000) throw new Error('source tree coverage unknown')
  for (const file of target.sourceFiles) {
    if (!tree.tree.some(item => item.path === file.path && item.type === 'blob' && item.mode === '100644' && item.sha === file.blob)) throw new Error('reviewed source file changed')
  }
  return person
}

// Read complete current Store discussion history as well as imported history.
// An unimported mention or a withdrawal fails closed, including on other repos.
export async function firstContactDiscussionGate(github, target) {
  const issues = await github.paginate(`/repos/${central}/issues?state=all`)
  const comments = await github.paginate(`/repos/${central}/issues/comments?`)
  const login = target.recipient.login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const mention = new RegExp(`@${login}(?![A-Za-z0-9-])`, 'i')
  for (const item of [...issues, ...comments]) {
    if (item.user?.id === target.recipient.id && stopped.test(authorFeedbackText(item.body))) return 'withdrawal-in-current-history'
    if (['ai-scarlett', 'github-actions[bot]'].includes(String(item.user?.login).toLowerCase())
      && (mention.test(item.body ?? '') || String(item.body ?? '').toLowerCase().includes(`key=${target.key.toLowerCase()} `))) return 'unimported-prior-contact'
  }
  return null
}

export async function sendFirstContacts({ github, plan, seed, report = () => {} }) {
  validateFirstContacts(plan)
  // Validate the complete reviewed set before any reservation or notification.
  await readContactState(github, central, seed)
  for (const target of plan.targets) await verifyFirstContactSource(github, target)
  const results = []
  for (const target of plan.targets) {
    let result
    try {
      const blocked = await firstContactDiscussionGate(github, target)
      if (blocked) result = { sent: false, key: target.key, reason: blocked }
      else {
        const person = await verifyFirstContactSource(github, target)
        const claimId = digest(`${digest(JSON.stringify(plan))}:${person.id}`)
        const claim = await reserveContact({ github, repository: central, recipient: person, key: target.key, claimId, seed })
        if (!claim.allowed) result = { sent: false, key: target.key, reason: claim.reason }
        else {
          // A cancellation or source change after reservation consumes the slot.
          await verifyFirstContactSource(github, target)
          const state = await readContactState(github, central, seed)
          if (state.state.contacts[person.id]?.stopped) throw new Error('contact stopped after reservation')
          const body = contactBody(target.body, person)
          const sent = await github.request('POST', `/repos/${central}/issues`, { title: target.title, body, labels: ['author-action-required', 'candidate-rejected'] })
          const readback = await github.request('GET', `/repos/${central}/issues/${sent.number}`)
          if (readback.title !== target.title || readback.body !== body || readback.state !== 'open') throw new Error('first-contact readback failed; slot stays consumed')
          result = { sent: true, key: target.key, userId: person.id, claimId, issueNumber: sent.number, url: readback.html_url, bodySha256: digest(body) }
        }
      }
    } catch {
      // Do not retry a POST, PATCH, cancelled reservation or uncertain readback.
      result = { sent: false, key: target.key, reason: 'failed-or-uncertain-do-not-retry' }
    }
    results.push(result); report(result)
  }
  return results
}

async function main() {
  const [flag, path, ...extra] = process.argv.slice(2)
  if (flag !== '--plan' || extra.length || !/^registry\/author-first-contacts\/[a-z0-9-]+\.json$/.test(path ?? '')) throw new Error('main-reviewed first-contact plan required')
  const bytes = await readFile(resolve(path)), plan = JSON.parse(bytes)
  validateFirstContacts(plan)
  const github = githubClient(process.env.GITHUB_TOKEN)
  const remote = await github.request('GET', `/repos/${central}/contents/${path}?ref=main`)
  if (remote.encoding !== 'base64' || digest(Buffer.from(remote.content, 'base64')) !== digest(bytes)) throw new Error('first-contact plan is not reviewed on main')
  const results = await sendFirstContacts({ github, plan, report: item => process.stdout.write(`FIRST_AUTHOR_CONTACT ${JSON.stringify(item)}\n`) })
  if (process.env.FIRST_CONTACT_RECEIPT) await writeFile(process.env.FIRST_CONTACT_RECEIPT, JSON.stringify({ planSha256: digest(bytes), results }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  if (results.some(item => item.reason === 'failed-or-uncertain-do-not-retry')) process.exitCode = 1
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
