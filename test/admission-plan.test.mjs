import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('source plan gate validates every follow-up base hash and exact scope in a disposable repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'admission-plan-'))
  const sha = value => createHash('sha256').update(value).digest('hex')
  const primary = 'docs/ops/admission-policy-v2-20261015.json'
  const next = 'docs/ops/admission-policy-v2-alpha3-20261015.json'
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/verify-admission-plan.mjs', import.meta.url))], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: '' },
  })
  try {
    git('init', '--quiet')
    await writeFile(join(root, 'demo.txt'), 'before')
    git('add', 'demo.txt')
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'fixture baseline')
    const baseCommit = git('rev-parse', 'HEAD')
    await mkdir(join(root, 'docs/ops'), { recursive: true })
    const scope = [primary, next, 'demo.txt']
    const preconditions = { [primary]: null, [next]: null, 'demo.txt': sha('before') }
    const original = { schemaVersion: 1, type: 'source-admission-policy-upgrade', baseCommit, scope, preconditions,
      postconditions: { 'demo.txt': sha('after') }, followupPlans: [next] }
    const followup = { schemaVersion: 1, type: 'source-compatibility-followup', baseCommit, scope, preconditions }
    await writeFile(join(root, 'demo.txt'), 'after')
    await writeFile(join(root, primary), JSON.stringify(original))
    await writeFile(join(root, next), JSON.stringify(followup))
    assert.equal(run().status, 0)
    followup.preconditions['demo.txt'] = sha('wrong baseline')
    await writeFile(join(root, next), JSON.stringify(followup))
    const badHash = run()
    assert.notEqual(badHash.status, 0)
    assert.match(badHash.stderr, /base precondition changed: demo.txt/)
    followup.preconditions['demo.txt'] = sha('before')
    await writeFile(join(root, next), JSON.stringify(followup))
    await writeFile(join(root, 'outside.txt'), 'outside')
    const badScope = run()
    assert.notEqual(badScope.status, 0)
    assert.match(badScope.stderr, /outside authorized scope: outside.txt/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
