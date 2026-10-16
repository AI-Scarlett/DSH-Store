import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const planPath = 'docs/ops/dsh-native-market-20261016.json'
const digest = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex')
export function validateUpgradePlan(plan, changes, readBase, readCurrent) {
  if (plan?.schemaVersion !== 1 || plan.type !== 'dsh-native-market-upgrade'
    || !/^[a-f0-9]{40}$/.test(plan.baseCommit ?? '') || !Array.isArray(plan.scope)
    || new Set(plan.scope).size !== plan.scope.length
    || JSON.stringify([...plan.scope].sort()) !== JSON.stringify(Object.keys(plan.preconditions ?? {}).sort())
    || plan.scope.some(p => typeof p !== 'string' || !/^[a-zA-Z0-9._/-]+$/.test(p) || p.startsWith('/') || p.includes('..'))
    || plan.authorization?.source !== 'direct-user-request'
    || plan.authorization?.githubWriteCredential !== 'existing-credential-explicitly-authorized'
    || plan.authorization?.credentialExceptionRequest !== '你直接上线啊 不要用短期的') throw new Error('Invalid typed DSH upgrade plan')
  for (const path of plan.scope) if (digest(readBase(path)) !== plan.preconditions[path]) throw new Error(`Base hash changed: ${path}`)
  for (const path of changes) {
    if (!plan.scope.includes(path)) throw new Error(`Outside upgrade scope: ${path}`)
    if (path !== planPath && !/^[a-f0-9]{64}$/.test(plan.postconditions?.[path] ?? '')) throw new Error(`Missing reviewed hash: ${path}`)
  }
  for (const [path, hash] of Object.entries(plan.postconditions ?? {})) {
    if (!plan.scope.includes(path) || path === planPath || digest(readCurrent(path)) !== hash) throw new Error(`Reviewed content changed: ${path}`)
  }
}
function main() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 24 * 1024 * 1024 }).trim()
  if (process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH))
    const from = event.pull_request?.base?.sha ?? event.before
    const to = event.pull_request?.head?.sha ?? event.after
    if (!from || !to || !git('diff', '--name-only', from, to, '--', planPath)) { console.log('DSH_UPGRADE_PLAN_NOT_CHANGED'); return }
  }
  const plan = JSON.parse(readFileSync(planPath))
  git('merge-base', '--is-ancestor', plan.baseCommit, 'HEAD')
  const changes = [...new Set([git('diff', '--name-only', plan.baseCommit), git('ls-files', '--others', '--exclude-standard')].join('\n').split('\n').filter(Boolean))]
  validateUpgradePlan(plan, changes, path => {
    try { return execFileSync('git', ['show', `${plan.baseCommit}:${path}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 24 * 1024 * 1024 }) } catch { return null }
  }, path => readFileSync(path))
  console.log(`DSH_UPGRADE_PLAN_OK base=${plan.baseCommit} changed=${changes.length}`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
