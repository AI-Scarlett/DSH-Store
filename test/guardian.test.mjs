import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
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
    const commandPath = ['/opt/homebrew/bin', '/usr/bin', '/bin'].join(delimiter)
    const service = createGuardianService({
      dshHome: root, launchAgentsDir, daemonSource, allowNonDarwin: true,
      restartSpec: profile => ({ nodePath: '/node', runtimeArgs: ['--import', '/loader'], cliPath: '/dsh.js', cwd: '/repo', profile, commandPath }),
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
    const config = JSON.parse(await readFile(join(root, 'dsh-safe-plugin-manager', 'guardian', 'config.json'), 'utf8'))
    assert.equal(config.healthProbeTimeoutMs, 1_500)
    assert.equal(config.unhealthyThreshold, 3)
    assert.equal(config.startupGraceMs, 10_000)
    assert.equal(config.commandPath, commandPath)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian launches DSH with the validated command PATH captured by the manager', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-path-'))
  const controller = new AbortController()
  const commandPath = ['/opt/homebrew/bin', '/usr/bin', '/bin'].join(delimiter)
  let launchOptions
  const child = new EventEmitter()
  child.pid = 4242
  child.stderr = new EventEmitter()
  child.kill = signal => { child.emit('exit', 0, signal); return true }
  try {
    await runGuardian({
      nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', stateDir: join(root, 'state'),
      profileDir: join(root, 'profile'), profile: 'web', host: '127.0.0.1', port: 3080, commandPath,
    }, {
      signal: controller.signal,
      listening: async () => false,
      spawn: (file, args, options) => { launchOptions = { file, args, options }; return child },
      delay: async () => controller.abort(),
    })
    assert.equal(launchOptions.file, '/node')
    assert.deepEqual(launchOptions.args, ['/dsh.js', 'web'])
    assert.equal(launchOptions.options.shell, false)
    assert.equal(launchOptions.options.env.PATH, commandPath)
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
      probeHost: async () => ({ healthy: true, profile: 'web', bootId: 'boot-one', rootStatus: 200, runtimeStatus: 200 }),
      spawn: () => child, onPublish: value => states.push(value),
      delay: async ms => { clock += ms; delays += 1; if (delays >= 5) controller.abort() }, pollMs: 1_000,
    })
    const healthy = states.filter(item => item.state === 'healthy')
    assert.ok(healthy.length >= 2)
    assert.equal(states.filter(item => item.state === 'health-checking').length, 2)
    assert.ok(healthy[1].stableForMs > healthy[0].stableForMs)
    assert.equal(healthy[0].owner, 'guardian')
    assert.equal(healthy[0].health.bootId, 'boot-one')
    assert.equal(states.at(-2).state, 'healthy')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian restarts its own half-hung child only after consecutive DSH identity failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-unhealthy-'))
  try {
    let clock = Date.parse('2026-08-17T00:00:00Z')
    let active = false
    let spawnCount = 0
    const states = []
    const controller = new AbortController()
    const spawnChild = () => {
      spawnCount += 1
      active = true
      const child = new EventEmitter()
      child.pid = 5_000 + spawnCount
      child.stderr = new EventEmitter()
      child.kill = signal => {
        active = false
        child.emit('exit', 0, signal)
        return true
      }
      return child
    }
    await runGuardian({
      nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', stateDir: join(root, 'state'),
      profileDir: join(root, 'profile'), profile: 'web', host: '127.0.0.1', port: 3080,
      stableMs: 1_000, startupGraceMs: 1_000, unhealthyThreshold: 2,
      restartWindowMs: 300_000, maxRestarts: 3,
    }, {
      signal: controller.signal, now: () => clock, listening: async () => active,
      probeHost: async () => ({ healthy: false, reason: 'runtime-identity-mismatch', rootStatus: 200, runtimeStatus: 200 }),
      spawn: spawnChild, onPublish: value => states.push(value), pollMs: 1_000,
      delay: async ms => {
        clock += ms
        if (spawnCount >= 2) controller.abort()
      },
    })
    assert.equal(spawnCount, 2)
    const restart = states.find(item => item.state === 'restarting-unhealthy')
    assert.ok(restart)
    assert.equal(restart.owner, 'guardian')
    assert.equal(restart.consecutiveProbeFailures, 2)
    assert.equal(restart.lastError.category, 'health-probe-failed')
    assert.equal(restart.failureCount, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian fails closed on an unknown process occupying the DSH port', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-conflict-'))
  try {
    const controller = new AbortController()
    const states = []
    let spawnCount = 0
    await runGuardian({
      nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', stateDir: join(root, 'state'),
      profileDir: join(root, 'profile'), profile: 'web', host: '127.0.0.1', port: 3080,
    }, {
      signal: controller.signal, listening: async () => true,
      probeHost: async () => ({ healthy: false, reason: 'runtime-http-404', rootStatus: 200, runtimeStatus: 404 }),
      spawn: () => { spawnCount += 1; throw new Error('must not spawn') },
      onPublish: value => states.push(value),
      delay: async () => controller.abort(),
    })
    const conflict = states.find(item => item.state === 'port-conflict')
    assert.ok(conflict)
    assert.equal(conflict.available, false)
    assert.equal(conflict.owner, 'unknown')
    assert.equal(conflict.errorCode, 'GUARDIAN_PORT_CONFLICT')
    assert.equal(spawnCount, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian verifies root and runtime identity but never claims an externally started DSH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-external-'))
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html>')
      return
    }
    if (request.method === 'POST' && request.url === '/api2/dsh-safe-plugin-manager/runtime') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, value: { profile: 'web', bootId: 'external-boot' } }))
      return
    }
    response.writeHead(404); response.end('missing')
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = server.address().port
    const controller = new AbortController()
    const states = []
    let spawnCount = 0
    await runGuardian({
      nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', stateDir: join(root, 'state'),
      profileDir: join(root, 'profile'), profile: 'web', host: '127.0.0.1', port,
      healthProbeTimeoutMs: 1_000,
    }, {
      signal: controller.signal,
      spawn: () => { spawnCount += 1; throw new Error('must not spawn') },
      onPublish: value => states.push(value),
      delay: async () => controller.abort(),
    })
    const external = states.find(item => item.state === 'external-dsh-detected')
    assert.ok(external)
    assert.equal(external.available, false)
    assert.equal(external.owner, 'external')
    assert.equal(external.health.bootId, 'external-boot')
    assert.equal(external.errorCode, 'GUARDIAN_NOT_OWNER')
    assert.equal(spawnCount, 0)
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('guardian service rejects restart when a fresh heartbeat belongs to an external host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-owner-'))
  try {
    const stateDir = join(root, 'dsh-safe-plugin-manager', 'guardian')
    await mkdir(stateDir, { recursive: true })
    await writeFile(join(stateDir, 'status.json'), JSON.stringify({
      schemaVersion: 1, installed: true, available: false, state: 'external-dsh-detected',
      heartbeatAt: new Date().toISOString(), profile: 'web', pid: null, owner: 'external',
    }))
    const service = createGuardianService({ dshHome: root })
    const status = await service.status()
    assert.equal(status.available, false)
    assert.equal(status.errorCode, 'GUARDIAN_NOT_OWNER')
    await assert.rejects(service.requestRestart({ profile: 'web', oldPid: 42 }), error => error.code === 'GUARDIAN_NOT_OWNER')
  } finally { await rm(root, { recursive: true, force: true }) }
})
