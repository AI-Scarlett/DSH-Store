import assert from 'node:assert/strict'
import test from 'node:test'
import { createRestartService } from '../src/restart.mjs'
import { restartHost } from '../src/restart-helper.mjs'
import { createRuntimeStatus, restartCommand } from '../src/runtime.mjs'

test('runtime status exposes a stable boot id and profile-specific fallback command', () => {
  const status = createRuntimeStatus({ profile: 'web', bootId: 'boot-one', startedAt: '2026-08-17T00:00:00Z' })
  assert.equal(status.bootId, 'boot-one')
  assert.deepEqual(status.restartCommand, ['dsh', 'web'])
  assert.equal(status.restartCommandText, 'dsh web')
  assert.deepEqual(restartCommand('tui'), ['dsh', '--profile', 'tui'])
  assert.equal(status.restartSupported, true)
  assert.equal(status.restartMode, 'guarded-helper')
})

test('restart requires a single-use exact plan and launches only the detached helper', () => {
  const calls = []
  let scheduled = null
  const fakeChild = { pid: 4321, unref() { calls.push(['unref']) } }
  const service = createRestartService({
    runtimeStatus: createRuntimeStatus({ profile: 'web', bootId: 'boot-one' }),
    restartSpec: profile => ({ nodePath: '/node', runtimeArgs: ['--import', '/loader'], cliPath: '/dsh.js', cwd: '/repo', profile }),
    helperPath: '/manager/restart-helper.mjs',
    spawn: (file, args, options) => { calls.push([file, args, options]); return fakeChild },
    schedule: callback => { scheduled = callback },
    terminate: () => calls.push(['terminate']),
  })
  const rejected = service.createPlan()
  assert.throws(() => service.execute({ planId: rejected.planId, confirmation: 'wrong' }), error => error.code === 'RESTART_CONFIRMATION_MISMATCH')
  assert.throws(() => service.execute({ planId: rejected.planId, confirmation: rejected.confirmation }), error => error.code === 'RESTART_PLAN_NOT_FOUND')
  const plan = service.createPlan()
  assert.equal(plan.confirmation, 'RESTART DSH web')
  assert.equal(plan.impact.fallbackCommandText, 'dsh web')
  const result = service.execute({ planId: plan.planId, confirmation: plan.confirmation })
  assert.equal(result.status, 'restart-scheduled')
  assert.equal(calls[0][0], process.execPath)
  assert.equal(calls[0][2].shell, false)
  assert.equal(calls[0][2].detached, true)
  assert.equal(typeof scheduled, 'function')
  scheduled()
  assert.deepEqual(calls.at(-1), ['terminate'])
})

test('restart helper does not start a duplicate when a supervisor restored the port', async () => {
  let spawnCalls = 0
  const result = await restartHost({
    oldPid: 2147483647, nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo',
    profile: 'web', host: '127.0.0.1', port: 3080,
  }, {
    supervisorGraceMs: 0,
    portIsListening: async () => true,
    spawn: () => { spawnCalls += 1 },
  })
  assert.equal(result.status, 'supervisor-restored')
  assert.equal(spawnCalls, 0)
})

test('restart helper starts the same profile with fixed arguments when the port stays down', async () => {
  const calls = []
  const result = await restartHost({
    oldPid: 2147483647, nodePath: '/node', runtimeArgs: ['--import', '/loader'], cliPath: '/dsh.js', cwd: '/repo',
    profile: 'web', host: '127.0.0.1', port: 3080,
  }, {
    supervisorGraceMs: 0,
    portIsListening: async () => false,
    spawn: (file, args, options) => {
      calls.push([file, args, options])
      return { pid: 55, unref() { calls.push(['unref']) } }
    },
  })
  assert.equal(result.status, 'started')
  assert.equal(result.pid, 55)
  assert.deepEqual(calls[0][0], '/node')
  assert.deepEqual(calls[0][1], ['--import', '/loader', '/dsh.js', 'web'])
  assert.equal(calls[0][2].shell, false)
})

test('restart helper escalates only the confirmed old pid after graceful timeout', async () => {
  const kills = []
  let checks = 0
  const result = await restartHost({
    oldPid: 4242, nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo',
    profile: 'web', host: '127.0.0.1', port: 3080,
  }, {
    waitForExitMs: 0, waitForKillMs: 10,
    processExists: pid => { assert.equal(pid, 4242); checks += 1; return checks < 3 },
    killProcess: (pid, signal) => kills.push([pid, signal]),
    supervisorGraceMs: 0,
    portIsListening: async () => true,
  })
  assert.equal(result.status, 'supervisor-restored')
  assert.deepEqual(kills, [[4242, 'SIGKILL']])
})
