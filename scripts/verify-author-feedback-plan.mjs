#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateReplyGrant } from './reply-author-contact.mjs'
import { verifyReplyResolution } from '../src/author-resolution.mjs'
import { validateFirstContacts } from './send-first-author-contact.mjs'
export const planPath = 'docs/ops/author-feedback-resolution-20261015.json'
const hash = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex')
export function validateResolutionPlan(plan, changes, readBase, readCurrent, currentPlanPath = planPath) {
  const authority = plan?.authorization
  const exception = authority?.credentialException
  const credentialAuthorized = authority?.githubWriteCredential === 'short-lived-token-required'
    || (authority?.githubWriteCredential === 'existing-credential-explicitly-authorized'
      && exception?.source === 'direct-user-request'
      && exception.request === '你直接上线啊 不要用短期的'
      && exception.scope === 'this-feedback-publication-only')
  if (plan?.schemaVersion !== 1 || plan.type !== 'author-feedback-resolution' || !/^[a-f0-9]{40}$/.test(plan.baseCommit ?? '')
    || !Array.isArray(plan.scope) || new Set(plan.scope).size !== plan.scope.length
    || JSON.stringify([...plan.scope].sort()) !== JSON.stringify(Object.keys(plan.preconditions ?? {}).sort())
    || plan.scope.some(p => typeof p !== 'string' || !/^[a-zA-Z0-9._/-]+$/.test(p) || p.startsWith('/') || p.includes('..'))
    || !credentialAuthorized) throw new Error('invalid author-feedback policy plan')
  for (const path of plan.scope) if (hash(readBase(path)) !== plan.preconditions[path]) throw new Error(`base file hash changed: ${path}`)
  for (const path of changes) {
    if (!plan.scope.includes(path)) throw new Error(`outside resolution scope: ${path}`)
    if (path !== currentPlanPath && !/^[a-f0-9]{64}$/.test(plan.postconditions?.[path] ?? '')) throw new Error(`missing reviewed postcondition: ${path}`)
  }
  for (const [path, expected] of Object.entries(plan.postconditions ?? {})) {
    if (!plan.scope.includes(path) || path === currentPlanPath || hash(readCurrent(path)) !== expected) throw new Error(`reviewed content changed: ${path}`)
  }
}
function main() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 24 * 1024 * 1024 }).trim()
  let currentPlanPath = process.argv[2] ?? planPath
  if (!/^docs\/ops\/author-feedback-[a-z0-9-]+\.json$/.test(currentPlanPath)) throw new Error('invalid feedback plan path')
  if (process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH))
    const from = event.pull_request?.base?.sha ?? event.before
    const to = event.pull_request?.head?.sha ?? event.after
    if (from && to) {
      // Historical plans remain immutable. Every newly added continuation plan
      // must carry a real terminal decision before it can be merged and sent.
      const added = git('diff', '--name-only', '--diff-filter=A', from, to, '--', 'registry/author-replies').split('\n').filter(Boolean)
      for (const path of added) {
        const reply = JSON.parse(readFileSync(path))
        validateReplyGrant(reply)
        if (!['admission-recheck', 'other-request'].includes(reply.review?.kind)) throw new Error('new reply must classify the verified request')
        if (reply.review.kind === 'admission-recheck') verifyReplyResolution(reply, readFileSync('registry/author-resolutions.json'))
      }
      for (const path of git('diff', '--name-only', '--diff-filter=AM', from, to, '--', 'registry/author-first-contacts').split('\n').filter(Boolean)) {
        if (!/^registry\/author-first-contacts\/[a-z0-9-]+\.json$/.test(path)) throw new Error('invalid first-contact plan path')
        validateFirstContacts(JSON.parse(readFileSync(path)))
      }
    }
    const changedPlans = from && to ? git('diff', '--name-only', from, to, '--', 'docs/ops').split('\n')
      .filter(path => /^docs\/ops\/author-feedback-[a-z0-9-]+\.json$/.test(path)) : []
    if (!changedPlans.length) { console.log('AUTHOR_FEEDBACK_PLAN_NOT_CHANGED'); return }
    if (changedPlans.length !== 1) throw new Error('one fresh feedback plan required')
    currentPlanPath = changedPlans[0]
  }
  const plan = JSON.parse(readFileSync(currentPlanPath))
  git('merge-base', '--is-ancestor', plan.baseCommit, 'HEAD')
  const changes = [...new Set([git('diff', '--name-only', plan.baseCommit), git('ls-files', '--others', '--exclude-standard')].join('\n').split('\n').filter(Boolean))]
  validateResolutionPlan(plan, changes, path => {
    try { return execFileSync('git', ['show', `${plan.baseCommit}:${path}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 24 * 1024 * 1024 }) } catch { return null }
  }, path => readFileSync(path), currentPlanPath)
  console.log(`AUTHOR_FEEDBACK_PLAN_OK base=${plan.baseCommit} changed=${changes.length}`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
