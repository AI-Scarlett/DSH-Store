import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const path = process.argv[2] ?? 'docs/ops/store-090-upgrade-20260915.json'
const plan = JSON.parse(readFileSync(path, 'utf8'))
if (plan.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(plan.baseCommit) || !Array.isArray(plan.scope)) throw new Error('invalid plan')
execFileSync('git', ['merge-base', '--is-ancestor', plan.baseCommit, 'HEAD'])
for (const [file, hash] of Object.entries(plan.preconditions)) {
  let bytes = null
  try { bytes = execFileSync('git', ['show', `${plan.baseCommit}:${file}`], { stdio: ['ignore','pipe','ignore'], maxBuffer: 16 * 1024 * 1024 }) } catch {}
  const actual = bytes ? createHash('sha256').update(bytes).digest('hex') : null
  if (actual !== hash) throw new Error(`base hash mismatch: ${file}`)
}
const changed = execFileSync('git', ['diff', '--name-only', plan.baseCommit], { encoding:'utf8' }).trim().split('\n').filter(Boolean)
const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding:'utf8' }).trim().split('\n').filter(Boolean)
for (const file of [...changed,...added]) if (!plan.scope.includes(file)) throw new Error(`out of scope: ${file}`)
console.log(`UPGRADE_PLAN_OK files=${new Set([...changed,...added]).size}`)
