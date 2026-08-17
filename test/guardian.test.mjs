import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGuardianService } from '../src/guardian.mjs'
import { runGuardian } from '../src/guardian-daemon.mjs'
import { EventEmitter } from 'node:events'

test('guardian status fails closed without an external heartbeat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-'))
  try {
    const service = createGuardianService({ dshHome: root })
    const status = await service.status()
    assert.equal(status.available, false)
    assert.equal(status.errorCode, 'GUARDIAN_NOT_INSTALLED')
    await assert.rejects(service.requestRestart({ profile: 'web', oldPid: 42 }), error => error.code === 'GUARDIAN_NOT_INSTALLED')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian installation uses a single-use plan and fixed launchctl arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-'))
  try {
    const launchAgentsDir = join(root, 'LaunchAgents'); const daemonSource = join(root, 'daemon.mjs')
    await mkdir(launchAgentsDir); await writeFile(daemonSource, 'export {}\n')
    const calls = []
    const service = createGuardianService({
      dshHome: root, launchAgentsDir, daemonSource, allowNonDarwin: true,
      restartSpec: profile => ({ nodePath: '/node', runtimeArgs: ['--import', '/loader'], cliPath: '/dsh.js', cwd: '/repo', profile }),
      execFile: async (file, args) => { calls.push([file, args]) },
    })
    const plan = await service.createInstallPlan({ profile: 'web' })
    await assert.rejects(service.executeInstall({ planId: plan.planId, confirmation: 'wrong' }), error => error.code === 'GUARDIAN_CONFIRMATION_MISMATCH')
    const accepted = await service.createInstallPlan({ profile: 'web' })
    const result = await service.executeInstall({ planId: accepted.planId, confirmation: accepted.confirmation })
    assert.equal(result.status, 'installed')
    assert.deepEqual(calls.map(item => item[1][0]), ['bootout', 'bootstrap', 'bootout'])
    const plist = await readFile(join(launchAgentsDir, 'com.ai-scarlett.dsh-guardian.plist'), 'utf8')
    assert.match(plist, /<string>\/node<\/string>/)
    assert.doesNotMatch(plist, /bash|-c/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian completes stability once and keeps publishing healthy heartbeats', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-heartbeat-'))
  try {
    let clock = Date.parse('2026-08-17T00:00:00Z')
    const controller = new AbortController()
    const states = []
    const child = new EventEmitter()
    child.pid = 4321
    child.stderr = new EventEmitter()
    child.kill = () => { child.emit('exit', 0, 'SIGTERM'); return true }
    let delays = 0
    let probes = 0
    await runGuardian({
      nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', stateDir: join(root, 'state'),
      profileDir: join(root, 'profile'), profile: 'web', host: '127.0.0.1', port: 3080,
      stableMs: 3_000, restartWindowMs: 300_000, maxRestarts: 3,
    }, {
      signal: controller.signal, now: () => clock, listening: async () => { probes += 1; return probes > 1 },
      spawn: () => child, onPublish: value => states.push(value),
      delay: async ms => { clock += ms; delays += 1; if (delays >= 8) controller.abort() }, pollMs: 1_000,
    })
    const healthy = states.filter(item => item.state === 'healthy')
    assert.ok(healthy.length >= 2)
    assert.equal(states.filter(item => item.state === 'health-checking').length, 2)
    assert.ok(healthy[1].stableForMs > healthy[0].stableForMs)
    assert.equal(states.at(-2).state, 'healthy')
  } finally { await rm(root, { recursive: true, force: true }) }
})
