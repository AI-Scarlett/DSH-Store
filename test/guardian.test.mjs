import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { createGuardianService } from '../src/guardian.mjs'
import { createProbeJournal, runGuardian } from '../src/guardian-daemon.mjs'
import { runGuardianUpgrade } from '../src/guardian-upgrader.mjs'
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

test('guardian installation verifies a fresh heartbeat before scheduling fixed-argv Host handoff', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-'))
  try {
    const launchAgentsDir = join(root, 'LaunchAgents'); const daemonSource = join(root, 'daemon.mjs')
    await mkdir(launchAgentsDir); await writeFile(daemonSource, 'export {}\n')
    const calls = []
    const scheduled = []
    const commandPath = ['/opt/homebrew/bin', '/usr/bin', '/bin'].join(delimiter)
    const service = createGuardianService({
      dshHome: root, launchAgentsDir, daemonSource, allowNonDarwin: true,
      restartSpec: profile => ({ nodePath: '/node', runtimeArgs: ['--import', '/loader'], cliPath: '/dsh.js', cwd: '/repo', profile, commandPath }),
      schedule: (callback, delay) => { scheduled.push({ callback, delay }) },
      execFile: async (file, args) => {
        calls.push([file, args])
        if (args[0] === 'bootstrap') {
          await writeFile(join(root, 'dsh-safe-plugin-manager', 'guardian', 'status.json'), JSON.stringify({
            schemaVersion: 1, installed: true, available: false, state: 'external-dsh-detected',
            heartbeatAt: new Date().toISOString(), profile: 'web', owner: 'external',
          }))
        }
      },
    })
    const plan = await service.createInstallPlan({ profile: 'web' })
    await assert.rejects(service.executeInstall({ planId: plan.planId, confirmation: 'wrong' }), error => error.code === 'GUARDIAN_CONFIRMATION_MISMATCH')
    const accepted = await service.createInstallPlan({ profile: 'web' })
    const result = await service.executeInstall({ planId: accepted.planId, confirmation: accepted.confirmation })
    assert.equal(result.status, 'installed')
    assert.equal(result.handoff.status, 'scheduled')
    assert.deepEqual(calls.map(item => item[1][0]), ['bootout', 'bootstrap', 'print'])
    assert.equal(calls.some(item => item[1][1].endsWith('/local.dsh.web')), false)
    assert.deepEqual(scheduled.map(item => item.delay), [750])
    scheduled[0].callback()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls.map(item => item[1][0]), ['bootout', 'bootstrap', 'print', 'bootout'])
    assert.match(calls.at(-1)[1][1], /\/local\.dsh\.web$/)
    const plist = await readFile(join(launchAgentsDir, 'com.ai-scarlett.dsh-guardian.plist'), 'utf8')
    assert.match(plist, /<string>\/node<\/string>/)
    assert.doesNotMatch(plist, /bash|-c/)
    const config = JSON.parse(await readFile(join(root, 'dsh-safe-plugin-manager', 'guardian', 'config.json'), 'utf8'))
    assert.equal(config.healthProbeTimeoutMs, 1_500)
    assert.equal(config.unhealthyThreshold, 3)
    assert.equal(config.startupGraceMs, 10_000)
    assert.equal(config.commandPath, commandPath)
    assert.equal(config.probeRetentionMs, 86_400_000)
    assert.equal(config.probeLogMaxBytes, 4_194_304)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian does not stop the current Host when bootstrap heartbeat verification fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-unverified-'))
  try {
    const launchAgentsDir = join(root, 'LaunchAgents'); const daemonSource = join(root, 'daemon.mjs')
    await mkdir(launchAgentsDir); await writeFile(daemonSource, 'export {}\n')
    let clock = Date.parse('2026-08-19T00:00:00Z')
    const calls = []
    const service = createGuardianService({
      dshHome: root, launchAgentsDir, daemonSource, allowNonDarwin: true,
      bootstrapTimeoutMs: 500, bootstrapPollMs: 100, now: () => clock, delay: async ms => { clock += ms },
      restartSpec: profile => ({ nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', profile, commandPath: '/usr/bin:/bin' }),
      execFile: async (file, args) => { calls.push([file, args]) },
      schedule: () => assert.fail('Host handoff must not be scheduled without a fresh Guardian heartbeat'),
    })
    const plan = await service.createInstallPlan({ profile: 'web' })
    await assert.rejects(service.executeInstall({ planId: plan.planId, confirmation: plan.confirmation }), error => error.code === 'GUARDIAN_BOOTSTRAP_UNVERIFIED')
    assert.equal(calls.some(item => item[1][1].endsWith('/local.dsh.web')), false)
    for (const path of [
      join(root, 'dsh-safe-plugin-manager', 'guardian', 'guardian-daemon.mjs'),
      join(root, 'dsh-safe-plugin-manager', 'guardian', 'config.json'),
      join(launchAgentsDir, 'com.ai-scarlett.dsh-guardian.plist'),
    ]) await assert.rejects(readFile(path), error => error.code === 'ENOENT')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian restores prior artifacts after a bootstrap failure without touching the Host job', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-rollback-'))
  try {
    const launchAgentsDir = join(root, 'LaunchAgents'); const daemonSource = join(root, 'daemon.mjs')
    const stateDir = join(root, 'dsh-safe-plugin-manager', 'guardian')
    await mkdir(launchAgentsDir); await mkdir(stateDir, { recursive: true })
    await writeFile(daemonSource, 'export const next = true\n')
    await writeFile(join(stateDir, 'guardian-daemon.mjs'), 'export const previous = true\n')
    await writeFile(join(stateDir, 'config.json'), '{"previous":true}\n')
    const plistPath = join(launchAgentsDir, 'com.ai-scarlett.dsh-guardian.plist')
    await writeFile(plistPath, '<plist>previous</plist>\n')
    const calls = []
    let bootstrapCalls = 0
    const service = createGuardianService({
      dshHome: root, launchAgentsDir, daemonSource, allowNonDarwin: true,
      restartSpec: profile => ({ nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', profile, commandPath: '/usr/bin:/bin' }),
      execFile: async (file, args) => {
        calls.push([file, args])
        if (args[0] === 'bootstrap' && bootstrapCalls++ === 0) throw new Error('bootstrap failed')
        if (args[0] === 'bootstrap') {
          await writeFile(join(stateDir, 'status.json'), JSON.stringify({
            schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
            heartbeatAt: new Date(Date.now() + 10).toISOString(), profile: 'web', pid: 77,
            health: { bootId: 'rollback-boot' },
          }))
        }
        if (args[0] === 'print') return { stdout: 'pid = 7002\n' }
      },
    })
    const plan = await service.createInstallPlan({ profile: 'web' })
    await assert.rejects(service.executeInstall({ planId: plan.planId, confirmation: plan.confirmation }), error => error.code === 'GUARDIAN_BOOTSTRAP_UNVERIFIED')
    assert.equal(await readFile(join(stateDir, 'guardian-daemon.mjs'), 'utf8'), 'export const previous = true\n')
    assert.equal(await readFile(join(stateDir, 'config.json'), 'utf8'), '{"previous":true}\n')
    assert.equal(await readFile(plistPath, 'utf8'), '<plist>previous</plist>\n')
    assert.equal(calls.some(item => item[1][1].endsWith('/local.dsh.web')), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('active Guardian upgrade binds the owner and launches a delayed out-of-process handoff before the HTTP Host stops', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-active-upgrade-'))
  try {
    const launchAgentsDir = join(root, 'LaunchAgents'); const daemonSource = join(root, 'daemon.mjs')
    const stateDir = join(root, 'dsh-safe-plugin-manager', 'guardian')
    await mkdir(launchAgentsDir); await mkdir(stateDir, { recursive: true })
    await writeFile(daemonSource, 'export const current = true\n')
    await writeFile(join(stateDir, 'guardian-daemon.mjs'), 'export const previous = true\n')
    await writeFile(join(stateDir, 'config.json'), '{"previous":true}\n')
    const plistPath = join(launchAgentsDir, 'com.ai-scarlett.dsh-guardian.plist')
    await writeFile(plistPath, '<plist>previous</plist>\n')
    let clock = Date.parse('2026-09-03T00:00:00Z')
    const calls = []
    const writeStatus = value => writeFile(join(stateDir, 'status.json'), JSON.stringify(value))
    await writeStatus({
      schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
      heartbeatAt: new Date(clock).toISOString(), profile: 'web', pid: 501,
      health: { bootId: 'old-boot' },
    })
    const service = createGuardianService({
      dshHome: root, launchAgentsDir, daemonSource, allowNonDarwin: true, now: () => clock,
      delay: async ms => { clock += ms },
      restartSpec: profile => ({ nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', profile, commandPath: '/usr/bin:/bin' }),
      signalProcess: () => assert.fail('the in-process service must not signal the active HTTP Host'),
      execFile: async (file, args) => {
        calls.push([file, args])
        if (args[0] === 'print') return { stdout: 'pid = 7001\n' }
      },
      schedule: () => assert.fail('active Guardian upgrade must not schedule the legacy local.dsh.web handoff'),
    })
    const plan = await service.createInstallPlan({ profile: 'web' })
    assert.equal(plan.action, 'upgrade-guardian')
    assert.deepEqual(plan.impact.activeHandoff, {
      mode: 'verified-owner-restart', guardianPid: 7001, hostPid: 501, hostBootId: 'old-boot',
    })
    const result = await service.executeInstall({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'update-scheduled')
    assert.equal(result.handoff.status, 'scheduled')
    assert.equal(result.handoff.mode, 'active-guardian-upgrade')
    assert.equal(result.handoff.previousGuardianPid, 7001)
    assert.equal(result.handoff.previousHostPid, 501)
    assert.equal(result.handoff.previousBootId, 'old-boot')
    assert.ok(calls.some(item => item[1]?.[0] === 'bootstrap' && item[1]?.[2]?.endsWith('com.ai-scarlett.dsh-guardian-upgrader.plist')))
    assert.equal(calls.some(item => item[1]?.[0] === 'bootout' && item[1]?.[1]?.endsWith('/com.ai-scarlett.dsh-guardian')), false)
    const handoffPlan = JSON.parse(await readFile(join(
      stateDir, 'upgrade-handoffs', result.handoff.planId, 'plan.json',
    ), 'utf8'))
    assert.equal(handoffPlan.operation, 'active-guardian-upgrade')
    assert.equal(handoffPlan.old.guardianPid, 7001)
    assert.equal(handoffPlan.old.hostPid, 501)
    assert.equal(handoffPlan.old.hostBootId, 'old-boot')
    assert.ok(Date.parse(handoffPlan.notBefore) > clock)
    assert.equal(await readFile(handoffPlan.paths.stagedDaemon, 'utf8'), 'export const current = true\n')
    let activeLaunchdPid = 7001
    const alive = new Set([501])
    const helperCalls = []
    const receipt = await runGuardianUpgrade(handoffPlan, {
      now: () => clock,
      delay: async ms => { clock += ms },
      signalProcess: (pid, signal) => {
        helperCalls.push(['signal', pid, signal])
        if (signal === 0 && !alive.has(pid)) throw Object.assign(new Error('missing'), { code: 'ESRCH' })
        if (signal === 'SIGTERM' || signal === 'SIGKILL') alive.delete(pid)
      },
      execFile: async (file, args) => {
        helperCalls.push([file, args])
        if (args[0] === 'print') return { stdout: `pid = ${activeLaunchdPid}\n` }
        if (args[0] === 'bootout') { activeLaunchdPid = null; return undefined }
        if (args[0] === 'bootstrap') {
          clock += 100; activeLaunchdPid = 7002; alive.add(502)
          await writeStatus({
            schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
            heartbeatAt: new Date(clock).toISOString(), profile: 'web', guardianPid: 7002, pid: 502,
            health: { bootId: 'new-boot' },
          })
        }
      },
    })
    assert.equal(receipt.status, 'completed')
    assert.equal(receipt.previous.guardianPid, 7001)
    assert.equal(receipt.replacement.guardianPid, 7002)
    assert.equal(receipt.replacement.hostPid, 502)
    assert.equal(receipt.replacement.hostBootId, 'new-boot')
    assert.equal(alive.has(501), false)
    assert.equal(alive.has(502), true)
    assert.ok(helperCalls.some(item => item[0] === 'signal' && item[1] === 501 && item[2] === 'SIGTERM'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('active Guardian upgrade fails closed when the bound Host identity drifts after confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-active-drift-'))
  try {
    const launchAgentsDir = join(root, 'LaunchAgents'); const daemonSource = join(root, 'daemon.mjs')
    const stateDir = join(root, 'dsh-safe-plugin-manager', 'guardian')
    await mkdir(launchAgentsDir); await mkdir(stateDir, { recursive: true })
    await writeFile(daemonSource, 'export const current = true\n')
    await writeFile(join(stateDir, 'guardian-daemon.mjs'), 'export const previous = true\n')
    await writeFile(join(stateDir, 'config.json'), '{}\n')
    await writeFile(join(launchAgentsDir, 'com.ai-scarlett.dsh-guardian.plist'), '<plist/>\n')
    const statusPath = join(stateDir, 'status.json')
    const heartbeatAt = new Date().toISOString()
    await writeFile(statusPath, JSON.stringify({
      schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
      heartbeatAt, profile: 'web', pid: 601, health: { bootId: 'bound-boot' },
    }))
    const commands = []
    const service = createGuardianService({
      dshHome: root, launchAgentsDir, daemonSource, allowNonDarwin: true,
      restartSpec: profile => ({ nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', profile, commandPath: '/usr/bin:/bin' }),
      execFile: async (file, args) => { commands.push([file, args]); return { stdout: 'pid = 7101\n' } },
      signalProcess: () => assert.fail('a drifted Host must never be signalled'),
    })
    const plan = await service.createInstallPlan({ profile: 'web' })
    await writeFile(statusPath, JSON.stringify({
      schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
      heartbeatAt: new Date(Date.now() + 10).toISOString(), profile: 'web', pid: 602,
      health: { bootId: 'different-boot' },
    }))
    await assert.rejects(
      service.executeInstall({ planId: plan.planId, confirmation: plan.confirmation }),
      error => error.code === 'GUARDIAN_ACTIVE_IDENTITY_CHANGED',
    )
    assert.equal(commands.some(item => item[1][0] === 'bootout' || item[1][0] === 'bootstrap'), false)
    assert.equal(await readFile(join(stateDir, 'guardian-daemon.mjs'), 'utf8'), 'export const previous = true\n')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('delayed Guardian upgrader rechecks identity immediately before bootout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-delayed-drift-'))
  try {
    const launchAgentsDir = join(root, 'LaunchAgents'); const daemonSource = join(root, 'daemon.mjs')
    const stateDir = join(root, 'dsh-safe-plugin-manager', 'guardian')
    await mkdir(launchAgentsDir); await mkdir(stateDir, { recursive: true })
    await writeFile(daemonSource, 'export const current = true\n')
    await writeFile(join(stateDir, 'guardian-daemon.mjs'), 'export const previous = true\n')
    await writeFile(join(stateDir, 'config.json'), '{}\n')
    await writeFile(join(launchAgentsDir, 'com.ai-scarlett.dsh-guardian.plist'), '<plist/>\n')
    let clock = Date.parse('2026-09-03T00:30:00Z')
    const statusPath = join(stateDir, 'status.json')
    await writeFile(statusPath, JSON.stringify({
      schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
      heartbeatAt: new Date(clock).toISOString(), profile: 'web', pid: 651,
      health: { bootId: 'bound-boot' },
    }))
    const stagingCalls = []
    const service = createGuardianService({
      dshHome: root, launchAgentsDir, daemonSource, allowNonDarwin: true, now: () => clock,
      activeHandoffDelayMs: 1_500,
      restartSpec: profile => ({ nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', profile, commandPath: '/usr/bin:/bin' }),
      execFile: async (_file, args) => {
        stagingCalls.push(args)
        if (args[0] === 'print') return { stdout: 'pid = 7151\n' }
      },
      signalProcess: () => assert.fail('the staging service must not signal the live Host'),
    })
    const plan = await service.createInstallPlan({ profile: 'web' })
    const staged = await service.executeInstall({ planId: plan.planId, confirmation: plan.confirmation })
    const handoffPlan = JSON.parse(await readFile(join(
      stateDir, 'upgrade-handoffs', staged.handoff.planId, 'plan.json',
    ), 'utf8'))
    const helperCalls = []
    await assert.rejects(
      runGuardianUpgrade(handoffPlan, {
        now: () => clock,
        delay: async ms => {
          clock += ms
          await writeFile(statusPath, JSON.stringify({
            schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
            heartbeatAt: new Date(clock).toISOString(), profile: 'web', pid: 652,
            health: { bootId: 'replacement-boot' },
          }))
        },
        execFile: async (_file, args) => {
          helperCalls.push(args)
          if (args[0] === 'print') return { stdout: 'pid = 7151\n' }
        },
        signalProcess: () => assert.fail('a drifted Host must never be signalled'),
      }),
      error => error.code === 'GUARDIAN_UPGRADE_FAILED'
        && error.receipt?.error?.code === 'GUARDIAN_ACTIVE_IDENTITY_CHANGED'
        && error.receipt?.recovery?.attempted === false,
    )
    assert.equal(helperCalls.some(args => args[0] === 'bootout' || args[0] === 'bootstrap'), false)
    assert.equal(stagingCalls.some(args => args[0] === 'bootout' && args[1]?.endsWith('/com.ai-scarlett.dsh-guardian')), false)
    assert.equal(await readFile(join(stateDir, 'guardian-daemon.mjs'), 'utf8'), 'export const previous = true\n')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('failed active Guardian replacement restores the previous artifacts and verifies its fresh owner heartbeat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-active-rollback-'))
  try {
    const launchAgentsDir = join(root, 'LaunchAgents'); const daemonSource = join(root, 'daemon.mjs')
    const stateDir = join(root, 'dsh-safe-plugin-manager', 'guardian')
    await mkdir(launchAgentsDir); await mkdir(stateDir, { recursive: true })
    const oldDaemon = 'export const previous = true\n'; const oldConfig = '{"previous":true}\n'; const oldPlist = '<plist>previous</plist>\n'
    await writeFile(daemonSource, 'export const current = true\n')
    await writeFile(join(stateDir, 'guardian-daemon.mjs'), oldDaemon)
    await writeFile(join(stateDir, 'config.json'), oldConfig)
    const plistPath = join(launchAgentsDir, 'com.ai-scarlett.dsh-guardian.plist')
    await writeFile(plistPath, oldPlist)
    let clock = Date.parse('2026-09-03T01:00:00Z')
    const statusPath = join(stateDir, 'status.json')
    await writeFile(statusPath, JSON.stringify({
      schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
      heartbeatAt: new Date(clock).toISOString(), profile: 'web', pid: 701, health: { bootId: 'old-boot' },
    }))
    const service = createGuardianService({
      dshHome: root, launchAgentsDir, daemonSource, allowNonDarwin: true, now: () => clock,
      bootstrapTimeoutMs: 30, bootstrapPollMs: 10, activeHandoffDelayMs: 20,
      restartSpec: profile => ({ nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', profile, commandPath: '/usr/bin:/bin' }),
      execFile: async (_file, args) => args[0] === 'print' ? { stdout: 'pid = 7201\n' } : undefined,
      signalProcess: () => assert.fail('the staging service must not stop the live Host'),
    })
    const plan = await service.createInstallPlan({ profile: 'web' })
    const staged = await service.executeInstall({ planId: plan.planId, confirmation: plan.confirmation })
    const handoffPlanPath = join(stateDir, 'upgrade-handoffs', staged.handoff.planId, 'plan.json')
    const handoffPlan = JSON.parse(await readFile(handoffPlanPath, 'utf8'))
    let launchdPid = 7201
    let bootstrapCount = 0
    const alive = new Set([701])
    await assert.rejects(
      runGuardianUpgrade(handoffPlan, {
        now: () => clock,
        delay: async ms => { clock += ms },
        signalProcess: (pid, signal) => {
          if (signal === 0 && !alive.has(pid)) throw Object.assign(new Error('missing'), { code: 'ESRCH' })
          if (signal === 'SIGTERM' || signal === 'SIGKILL') alive.delete(pid)
        },
        execFile: async (_file, args) => {
          if (args[0] === 'print') return { stdout: `pid = ${launchdPid}\n` }
          if (args[0] === 'bootout') { launchdPid = null; return undefined }
          if (args[0] === 'bootstrap') {
            bootstrapCount += 1; clock += 100
            if (bootstrapCount === 1) {
              launchdPid = 7201; alive.add(702)
              await writeFile(statusPath, JSON.stringify({
                schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
                heartbeatAt: new Date(clock).toISOString(), profile: 'web', guardianPid: 7201, pid: 702,
                health: { bootId: 'unaccepted-new-boot' },
              }))
            } else {
              launchdPid = 7203; alive.add(703)
              await writeFile(statusPath, JSON.stringify({
                schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
                heartbeatAt: new Date(clock).toISOString(), profile: 'web', pid: 703,
                health: { bootId: 'restored-boot' },
              }))
            }
          }
        },
      }),
      error => error.code === 'GUARDIAN_UPGRADE_FAILED'
        && error.receipt?.recovery?.restored === true
        && error.receipt?.recovery?.relaunchedPreviousGuardian === true
        && error.receipt?.recovery?.heartbeatVerified === true,
    )
    assert.equal(await readFile(join(stateDir, 'guardian-daemon.mjs'), 'utf8'), oldDaemon)
    assert.equal(await readFile(join(stateDir, 'config.json'), 'utf8'), oldConfig)
    assert.equal(await readFile(plistPath, 'utf8'), oldPlist)
    assert.equal(alive.has(701), false)
    assert.equal(alive.has(702), false)
    assert.equal(alive.has(703), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian probe journal records safe fields, samples health, and removes entries older than 24 hours', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-probes-'))
  try {
    let clock = Date.parse('2026-08-18T12:00:00Z')
    const path = join(root, 'probe-log.jsonl')
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1, at: '2026-08-17T11:59:59.000Z', secret: 'must-go' })}\n`)
    const journal = createProbeJournal({ path, now: () => clock, healthySampleMs: 60_000, pruneIntervalMs: 1 })
    const safeProbe = {
      profile: 'web', owner: 'guardian', pid: 42, state: 'healthy', portOpen: true, healthy: true,
      rootStatus: 200, rootDurationMs: 12, rootBytes: 900, runtimeStatus: 200,
      runtimeDurationMs: 8, runtimeBytes: 80, bootId: 'boot-one', responseBody: 'SECRET',
    }
    assert.equal(await journal.record(safeProbe), true)
    clock += 10_000
    assert.equal(await journal.record(safeProbe), false)
    assert.equal(await journal.record({ ...safeProbe, healthy: false, reason: 'timeout', consecutiveFailures: 1 }), true)
    const lines = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(lines.length, 2)
    assert.equal(lines[0].kind, 'dsh-host-probe')
    assert.equal(lines[0].root.durationMs, 12)
    assert.equal(lines[0].runtime.bytes, 80)
    assert.equal(lines[1].reason, 'timeout')
    assert.equal(JSON.stringify(lines).includes('SECRET'), false)
    assert.equal(JSON.stringify(lines).includes('must-go'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian status fails closed when the deployed daemon differs from the bundled probe', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-drift-'))
  try {
    const stateDir = join(root, 'dsh-safe-plugin-manager', 'guardian')
    const daemonSource = join(root, 'source.mjs')
    await mkdir(stateDir, { recursive: true })
    await writeFile(daemonSource, 'export const current = true\n')
    await writeFile(join(stateDir, 'guardian-daemon.mjs'), 'export const current = false\n')
    await writeFile(join(stateDir, 'status.json'), JSON.stringify({
      schemaVersion: 1, installed: true, available: true, state: 'healthy', owner: 'guardian',
      heartbeatAt: new Date().toISOString(), profile: 'web', pid: 42,
    }))
    const service = createGuardianService({ dshHome: root, daemonSource })
    const status = await service.status()
    assert.equal(status.available, false)
    assert.equal(status.upgradeRequired, true)
    assert.equal(status.errorCode, 'GUARDIAN_VERSION_DRIFT')
    assert.deepEqual(status.probeLog, { enabled: false, retentionHours: 24 })
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

test('guardian accepts the authenticated DSH root fence and verifies runtime identity without claiming an external Host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-external-'))
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(401, { 'content-type': 'text/plain' }); response.end('authentication required')
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
    assert.equal(external.health.rootStatus, 401)
    assert.equal(external.health.runtimeStatus, 200)
    assert.equal(external.health.bootId, 'external-boot')
    assert.equal(external.errorCode, 'GUARDIAN_NOT_OWNER')
    assert.equal(spawnCount, 0)
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('guardian keeps accepting the legacy unauthenticated root response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-legacy-root-'))
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html>')
      return
    }
    if (request.method === 'POST' && request.url === '/api2/dsh-safe-plugin-manager/runtime') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, value: { profile: 'web', bootId: 'legacy-root-boot' } }))
      return
    }
    response.writeHead(404); response.end('missing')
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const controller = new AbortController()
    const states = []
    await runGuardian({
      nodePath: '/node', runtimeArgs: [], cliPath: '/dsh.js', cwd: '/repo', stateDir: join(root, 'state'),
      profileDir: join(root, 'profile'), profile: 'web', host: '127.0.0.1', port: server.address().port,
      healthProbeTimeoutMs: 1_000,
    }, {
      signal: controller.signal,
      spawn: () => { throw new Error('must not spawn') },
      onPublish: value => states.push(value),
      delay: async () => controller.abort(),
    })
    const external = states.find(item => item.state === 'external-dsh-detected')
    assert.ok(external)
    assert.equal(external.health.rootStatus, 200)
    assert.equal(external.health.runtimeStatus, 200)
    assert.equal(external.health.bootId, 'legacy-root-boot')
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
