#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const planPath = 'docs/ops/admission-policy-v2-20261015.json'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).trim()
// Historical source plans do not constrain unrelated future changes. CI checks
// this plan only when it is introduced or edited by the current event.
if (process.env.GITHUB_EVENT_PATH) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const from = event.pull_request?.base?.sha ?? event.before
  const to = event.pull_request?.head?.sha ?? event.after
  if (!from || !to || !git('diff', '--name-only', from, to, '--', 'docs/ops/').split('\n').some(path => path.startsWith('docs/ops/admission-policy-v2'))) {
    console.log('ADMISSION_PLAN_NOT_CHANGED'); process.exit(0)
  }
}
const primary = JSON.parse(readFileSync(planPath, 'utf8'))
if ((primary.followupPlans ?? []).some(path => !/^docs\/ops\/admission-policy-v2-[a-z0-9-]+\.json$/.test(path))) throw new Error('invalid follow-up plan path')
for (const currentPath of [planPath, ...(primary.followupPlans ?? [])]) {
  const plan = JSON.parse(readFileSync(currentPath, 'utf8'))
  if (plan.schemaVersion !== 1 || !['source-admission-policy-upgrade', 'source-compatibility-followup'].includes(plan.type) || !/^[a-f0-9]{40}$/.test(plan.baseCommit)
    || !Array.isArray(plan.scope) || new Set(plan.scope).size !== plan.scope.length
    || JSON.stringify([...Object.keys(plan.preconditions)].sort()) !== JSON.stringify([...plan.scope].sort())) throw new Error('invalid typed admission plan')
  git('merge-base', '--is-ancestor', plan.baseCommit, 'HEAD')
  for (const file of plan.scope) {
    if (file.startsWith('/') || file.includes('..') || file.includes('\\')) throw new Error('invalid plan path')
    let bytes = null
    try { bytes = execFileSync('git', ['show', `${plan.baseCommit}:${file}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }) } catch {}
    const actual = bytes ? createHash('sha256').update(bytes).digest('hex') : null
    if (actual !== plan.preconditions[file]) throw new Error(`base precondition changed: ${file}`)
  }
  const changed = new Set([...git('diff', '--name-only', plan.baseCommit).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))
  for (const file of changed) if (!plan.scope.includes(file)) throw new Error(`outside authorized scope: ${file}`)
  for (const [file, expected] of Object.entries(plan.postconditions ?? {})) {
    if (!plan.scope.includes(file) || file === currentPath) throw new Error('invalid postcondition scope')
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== expected) throw new Error(`reviewed file changed: ${file}`)
  }
  console.log(`ADMISSION_PLAN_OK base=${plan.baseCommit} changed=${changed.size}`)
}
