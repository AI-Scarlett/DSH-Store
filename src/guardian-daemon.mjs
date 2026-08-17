import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { dirname, isAbsolute, join } from 'node:path'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const now = () => new Date().toISOString()

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function listening(host, port) {
  return new Promise(resolve => {
    const socket = connect({ host, port })
    const done = value => { socket.destroy(); resolve(value) }
    socket.setTimeout(700)
    socket.once('connect', () => done(true)); socket.once('timeout', () => done(false)); socket.once('error', () => done(false))
  })
}

function validate(config) {
  if (!isAbsolute(config.nodePath) || !isAbsolute(config.cliPath) || !isAbsolute(config.cwd) || !isAbsolute(config.stateDir) || !isAbsolute(config.profileDir)) throw new Error('guardian paths must be absolute')
  if (!Array.isArray(config.runtimeArgs) || config.runtimeArgs.some(value => typeof value !== 'string')) throw new Error('invalid runtime arguments')
  if (!/^[A-Za-z0-9._-]+$/.test(config.profile)) throw new Error('invalid profile')
  if (config.host !== '127.0.0.1' || !Number.isInteger(config.port)) throw new Error('invalid listener')
  return config
}

function safeFailureSummary(text) {
  const duplicate = /duplicate loader entry id:\s*([A-Za-z0-9._-]+)/i.exec(text)
  if (duplicate) return { category: 'duplicate-entry-id', entryId: duplicate[1] }
  if (/EADDRINUSE/i.test(text)) return { category: 'port-in-use' }
  if (/MODULE_NOT_FOUND|Cannot find module/i.test(text)) return { category: 'module-not-found' }
  return { category: 'startup-exit' }
}

export async function runGuardian(rawConfig, options = {}) {
  const config = validate(rawConfig)
  const spawnProcess = options.spawn ?? spawn
  const portReady = options.listening ?? listening
  const sleep = options.delay ?? delay
  const statePath = join(config.stateDir, 'status.json')
  const requestPath = join(config.stateDir, 'request.json')
  const windowMs = config.restartWindowMs ?? 300_000
  const maxRestarts = config.maxRestarts ?? 3
  const stableMs = config.stableMs ?? 30_000
  let child = null
  let stopping = false
  let failures = []
  let lastError = null
  let recoveryAttempted = false

  async function digestFile(path) {
    try { return createHash('sha256').update(await readFile(path)).digest('hex') } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function restorePendingRecovery() {
    const recoveryPath = join(config.stateDir, 'pending-recovery.json')
    const recovery = await readJson(recoveryPath)
    if (!recovery || recovery.profile !== config.profile || typeof recovery.authorizedByConfirmation !== 'string') return { status: 'not-available' }
    for (const item of recovery.postconditions ?? []) {
      if (await digestFile(join(config.profileDir, item.relative)) !== item.sha256) return { status: 'precondition-changed' }
    }
    for (const item of recovery.preconditions ?? []) {
      const target = join(config.profileDir, item.relative)
      if (item.exists) {
        const content = await readFile(join(recovery.backupDir, item.relative))
        const temporary = `${target}.${randomUUID()}.tmp`
        await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, target)
      } else await rm(target, { force: true })
    }
    const install = await new Promise(resolve => {
      const command = spawnProcess(config.nodePath, [...config.runtimeArgs, config.cliPath, 'plugin', '--profile', config.profile, 'install', '--offline'], {
        cwd: config.cwd, env: process.env, shell: false, stdio: 'ignore',
      })
      command.once('exit', code => resolve(code === 0))
      command.once('error', () => resolve(false))
    })
    if (!install) return { status: 'dependency-restore-failed', transactionId: recovery.transactionId }
    await atomicJson(join(config.stateDir, 'quarantine.json'), {
      schemaVersion: 1, packageName: recovery.packageName, transactionId: recovery.transactionId,
      reason: 'cold-start-failed-after-confirmed-operation', at: now(), requiresUserConfirmation: true,
    })
    await rm(recoveryPath, { force: true })
    return { status: 'rolled-back-and-quarantined', transactionId: recovery.transactionId, packageName: recovery.packageName }
  }

  async function publish(state, extra = {}) {
    await atomicJson(statePath, {
      schemaVersion: 1, installed: true, available: true, state, heartbeatAt: now(),
      profile: config.profile, pid: child?.pid ?? null, failureCount: failures.length,
      lastError, circuit: failures.length >= maxRestarts ? 'open' : 'closed', ...extra,
    })
  }

  function launch() {
    const profileArgs = config.profile === 'web' ? ['web'] : ['--profile', config.profile]
    child = spawnProcess(config.nodePath, [...config.runtimeArgs, config.cliPath, ...profileArgs], {
      cwd: config.cwd, env: process.env, shell: false, stdio: ['ignore', 'ignore', 'pipe'],
    })
    let tail = ''
    child.stderr?.on?.('data', chunk => { tail = `${tail}${String(chunk)}`.slice(-4096) })
    child.once('exit', (code, signal) => {
      child = null
      if (!stopping) lastError = { code: Number.isInteger(code) ? code : null, signal: signal ?? null, ...safeFailureSummary(tail) }
    })
  }

  async function stopChild() {
    if (!child) return
    stopping = true
    child.kill('SIGTERM')
    for (let count = 0; child && count < 50; count += 1) await sleep(100)
    if (child) child.kill('SIGKILL')
    stopping = false
  }

  await mkdir(config.stateDir, { recursive: true, mode: 0o700 })
  while (options.signal?.aborted !== true) {
    const cutoff = Date.now() - windowMs
    failures = failures.filter(value => value >= cutoff)
    const request = await readJson(requestPath)
    if (request?.type === 'restart' && Date.parse(request.expiresAt) >= Date.now()) {
      await rm(requestPath, { force: true })
      await publish('restarting', { requestId: request.requestId })
      await stopChild()
    }
    const externalHostReady = !child && await portReady(config.host, config.port)
    if (externalHostReady) {
      await publish('adopting-existing-host')
    } else if (!child && failures.length < maxRestarts) {
      failures.push(Date.now())
      await publish('starting')
      launch()
      await sleep(Math.min(2 ** (failures.length - 1) * 1000, 15_000))
    }
    if (child && await portReady(config.host, config.port)) {
      const observedPid = child.pid
      await publish('health-checking', { stableForMs: 0 })
      await sleep(stableMs)
      if (child?.pid === observedPid && await portReady(config.host, config.port)) {
        failures = []
        recoveryAttempted = false
        lastError = null
        await rm(join(config.stateDir, 'pending-recovery.json'), { force: true })
        await publish('healthy', { stableForMs: stableMs })
      }
    } else if (externalHostReady) {
      await sleep(options.pollMs ?? 1_000)
    } else if (!child && failures.length >= maxRestarts) {
      if (!recoveryAttempted) {
        recoveryAttempted = true
        const recovery = await restorePendingRecovery()
        if (recovery.status === 'rolled-back-and-quarantined') {
          failures = []
          await publish('rolled-back', { recovery })
        } else await publish('circuit-open', { recovery })
      } else await publish('circuit-open', { recovery: 'manual-confirmation-required' })
    } else await publish(child ? 'waiting-for-health' : 'backoff')
    await sleep(options.pollMs ?? 1_000)
  }
  await stopChild()
  await publish('stopped', { available: false })
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const config = validate(JSON.parse(await readFile(process.argv[2], 'utf8')))
  runGuardian(config).catch(async error => {
    await atomicJson(join(config.stateDir, 'status.json'), {
      schemaVersion: 1, installed: true, available: false, state: 'guardian-failed', heartbeatAt: now(),
      errorCode: 'GUARDIAN_FATAL', message: String(error?.message ?? error).slice(0, 500),
    }).catch(() => {})
    process.exitCode = 1
  })
}
