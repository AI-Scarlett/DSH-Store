import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { request as requestHttp } from 'node:http'
import { connect } from 'node:net'
import { delimiter, dirname, isAbsolute, join } from 'node:path'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const now = () => new Date().toISOString()
const PROBE_RETENTION_MS = 24 * 60 * 60 * 1_000
const PROBE_LOG_MAX_BYTES = 4 * 1_024 * 1_024

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

function httpExchange({ host, port, path, method = 'GET', body = '', timeoutMs, maxBytes = 65_536 }) {
  return new Promise(resolve => {
    const startedAt = Date.now()
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      resolve({ ...value, durationMs: Math.max(0, Date.now() - startedAt) })
    }
    const request = requestHttp({
      host, port, path, method,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : undefined,
    }, response => {
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > maxBytes) {
          response.destroy()
          finish({ ok: false, statusCode: response.statusCode, bytes: size, reason: 'response-too-large' })
          return
        }
        chunks.push(chunk)
      })
      response.once('end', () => finish({
        ok: true, statusCode: response.statusCode, bytes: size, body: Buffer.concat(chunks).toString('utf8'),
      }))
      response.once('error', () => finish({ ok: false, statusCode: response.statusCode, reason: 'response-error' }))
    })
    request.setTimeout(timeoutMs, () => {
      request.destroy()
      finish({ ok: false, reason: 'timeout' })
    })
    request.once('error', () => finish({ ok: false, reason: 'request-error' }))
    request.end(body || undefined)
  })
}

async function probeDshHost(config) {
  const timeoutMs = config.healthProbeTimeoutMs ?? 1_500
  const root = await httpExchange({ host: config.host, port: config.port, path: '/', timeoutMs })
  if (!root.ok || root.statusCode !== 200) {
    return {
      healthy: false, reason: root.reason ?? `root-http-${root.statusCode ?? 'unknown'}`,
      rootStatus: root.statusCode ?? null, rootDurationMs: root.durationMs, rootBytes: root.bytes ?? null,
    }
  }
  const runtime = await httpExchange({
    host: config.host, port: config.port, path: '/api2/dsh-safe-plugin-manager/runtime', method: 'POST',
    body: JSON.stringify({ profile: config.profile }), timeoutMs,
  })
  if (!runtime.ok || runtime.statusCode !== 200) {
    return {
      healthy: false, reason: runtime.reason ?? `runtime-http-${runtime.statusCode ?? 'unknown'}`,
      rootStatus: root.statusCode, runtimeStatus: runtime.statusCode ?? null,
      rootDurationMs: root.durationMs, rootBytes: root.bytes ?? null,
      runtimeDurationMs: runtime.durationMs, runtimeBytes: runtime.bytes ?? null,
    }
  }
  let payload
  try { payload = JSON.parse(runtime.body) } catch {
    return {
      healthy: false, reason: 'runtime-json-invalid', rootStatus: root.statusCode, runtimeStatus: runtime.statusCode,
      rootDurationMs: root.durationMs, rootBytes: root.bytes ?? null,
      runtimeDurationMs: runtime.durationMs, runtimeBytes: runtime.bytes ?? null,
    }
  }
  const value = payload?.value
  if (payload?.ok !== true || value?.profile !== config.profile || typeof value?.bootId !== 'string' || value.bootId.length === 0) {
    return {
      healthy: false, reason: 'runtime-identity-mismatch', rootStatus: root.statusCode,
      runtimeStatus: runtime.statusCode, profile: typeof value?.profile === 'string' ? value.profile : null,
      rootDurationMs: root.durationMs, rootBytes: root.bytes ?? null,
      runtimeDurationMs: runtime.durationMs, runtimeBytes: runtime.bytes ?? null,
    }
  }
  return {
    healthy: true, reason: null, rootStatus: root.statusCode, runtimeStatus: runtime.statusCode,
    profile: value.profile, bootId: value.bootId,
    rootDurationMs: root.durationMs, rootBytes: root.bytes ?? null,
    runtimeDurationMs: runtime.durationMs, runtimeBytes: runtime.bytes ?? null,
  }
}

function boundedText(value, max = 128) {
  return typeof value === 'string' ? value.slice(0, max) : null
}

export function createProbeJournal(options) {
  const path = options.path
  const currentTime = options.now ?? Date.now
  const retentionMs = options.retentionMs ?? PROBE_RETENTION_MS
  const maxBytes = options.maxBytes ?? PROBE_LOG_MAX_BYTES
  const healthySampleMs = options.healthySampleMs ?? 60_000
  const pruneIntervalMs = options.pruneIntervalMs ?? 300_000
  let lastHealthyAt = null
  let lastPrunedAt = 0

  async function prune(force = false) {
    const timestamp = currentTime()
    if (!force && timestamp - lastPrunedAt < pruneIntervalMs) return
    lastPrunedAt = timestamp
    let content
    try { content = await readFile(path, 'utf8') } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    const cutoff = timestamp - retentionMs
    const valid = content.split('\n').filter(Boolean).flatMap(line => {
      try {
        const parsed = JSON.parse(line)
        return Number.isFinite(Date.parse(parsed.at)) && Date.parse(parsed.at) >= cutoff ? [line] : []
      } catch { return [] }
    })
    const kept = []
    let bytes = 0
    for (let index = valid.length - 1; index >= 0; index -= 1) {
      const lineBytes = Buffer.byteLength(`${valid[index]}\n`)
      if (bytes + lineBytes > maxBytes) break
      kept.unshift(valid[index]); bytes += lineBytes
    }
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, kept.length ? `${kept.join('\n')}\n` : '', { mode: 0o600 })
    await rename(temporary, path)
  }

  async function record(input) {
    const timestamp = currentTime()
    if (input.healthy === true && lastHealthyAt !== null && timestamp - lastHealthyAt < healthySampleMs) return false
    if (input.healthy === true) lastHealthyAt = timestamp
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const entry = {
      schemaVersion: 1, at: new Date(timestamp).toISOString(), kind: 'dsh-host-probe',
      profile: boundedText(input.profile, 64), owner: boundedText(input.owner, 32),
      pid: Number.isInteger(input.pid) ? input.pid : null,
      state: boundedText(input.state, 64), portOpen: input.portOpen === true,
      healthy: input.healthy === true, reason: boundedText(input.reason),
      root: {
        status: Number.isInteger(input.rootStatus) ? input.rootStatus : null,
        durationMs: Number.isFinite(input.rootDurationMs) ? input.rootDurationMs : null,
        bytes: Number.isInteger(input.rootBytes) ? input.rootBytes : null,
      },
      runtime: {
        status: Number.isInteger(input.runtimeStatus) ? input.runtimeStatus : null,
        durationMs: Number.isFinite(input.runtimeDurationMs) ? input.runtimeDurationMs : null,
        bytes: Number.isInteger(input.runtimeBytes) ? input.runtimeBytes : null,
      },
      bootId: boundedText(input.bootId),
      consecutiveFailures: Number.isInteger(input.consecutiveFailures) ? input.consecutiveFailures : 0,
      restartRequired: input.restartRequired === true,
    }
    await appendFile(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    await prune()
    return true
  }

  return { record, prune }
}

function validate(config) {
  if (!isAbsolute(config.nodePath) || !isAbsolute(config.cliPath) || !isAbsolute(config.cwd) || !isAbsolute(config.stateDir) || !isAbsolute(config.profileDir)) throw new Error('guardian paths must be absolute')
  if (!Array.isArray(config.runtimeArgs) || config.runtimeArgs.some(value => typeof value !== 'string')) throw new Error('invalid runtime arguments')
  if (!/^[A-Za-z0-9._-]+$/.test(config.profile)) throw new Error('invalid profile')
  if (config.host !== '127.0.0.1' || !Number.isInteger(config.port)) throw new Error('invalid listener')
  if (config.commandPath !== undefined) {
    if (typeof config.commandPath !== 'string' || config.commandPath.length === 0) throw new Error('invalid command path')
    const entries = config.commandPath.split(delimiter)
    if (entries.some(value => !value || !isAbsolute(value))) throw new Error('command path entries must be absolute')
  }
  for (const field of [
    'healthProbeTimeoutMs', 'unhealthyThreshold', 'startupGraceMs', 'probeRetentionMs',
    'probeLogMaxBytes', 'healthyProbeLogIntervalMs', 'probePruneIntervalMs',
  ]) {
    if (config[field] !== undefined && (!Number.isInteger(config[field]) || config[field] <= 0)) throw new Error(`invalid ${field}`)
  }
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
  const probeHost = options.probeHost ?? probeDshHost
  const sleep = options.delay ?? delay
  const currentTime = options.now ?? Date.now
  const statePath = join(config.stateDir, 'status.json')
  const requestPath = join(config.stateDir, 'request.json')
  const windowMs = config.restartWindowMs ?? 300_000
  const maxRestarts = config.maxRestarts ?? 3
  const stableMs = config.stableMs ?? 30_000
  const startupGraceMs = config.startupGraceMs ?? 10_000
  const unhealthyThreshold = config.unhealthyThreshold ?? 3
  const commandEnvironment = config.commandPath
    ? { ...process.env, PATH: config.commandPath }
    : process.env
  let child = null
  const intentionalStops = new WeakSet()
  let failures = []
  let lastError = null
  let recoveryAttempted = false
  let childStartedAt = null
  let healthyPid = null
  let consecutiveProbeFailures = 0
  const probeJournal = options.probeJournal ?? createProbeJournal({
    path: join(config.stateDir, 'probe-log.jsonl'), now: currentTime,
    retentionMs: config.probeRetentionMs, maxBytes: config.probeLogMaxBytes,
    healthySampleMs: config.healthyProbeLogIntervalMs, pruneIntervalMs: config.probePruneIntervalMs,
  })

  async function recordProbe(probe, extra = {}) {
    try {
      await probeJournal.record({
        profile: config.profile, owner: child ? 'guardian' : extra.owner, pid: child?.pid,
        state: extra.state, portOpen: extra.portOpen, consecutiveFailures: consecutiveProbeFailures,
        restartRequired: extra.restartRequired, ...probe,
      })
    } catch { /* Probe logging must never stop Guardian supervision. */ }
  }

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
        cwd: config.cwd, env: commandEnvironment, shell: false, stdio: 'ignore',
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
    const value = {
      schemaVersion: 1, installed: true, available: true, state, heartbeatAt: now(),
      profile: config.profile, pid: child?.pid ?? null, failureCount: failures.length,
      owner: child ? 'guardian' : 'unknown', lastError,
      circuit: failures.length >= maxRestarts ? 'open' : 'closed', ...extra,
    }
    await atomicJson(statePath, value)
    options.onPublish?.(value)
  }

  function launch() {
    const profileArgs = config.profile === 'web' ? ['web'] : ['--profile', config.profile]
    const launched = spawnProcess(config.nodePath, [...config.runtimeArgs, config.cliPath, ...profileArgs], {
      cwd: config.cwd, env: commandEnvironment, shell: false, stdio: ['ignore', 'ignore', 'pipe'],
    })
    child = launched
    childStartedAt = currentTime()
    healthyPid = null
    consecutiveProbeFailures = 0
    let tail = ''
    launched.stderr?.on?.('data', chunk => { tail = `${tail}${String(chunk)}`.slice(-4096) })
    launched.once('exit', (code, signal) => {
      if (child === launched) {
        child = null
        childStartedAt = null
        healthyPid = null
      }
      if (!intentionalStops.delete(launched)) {
        failures.push(currentTime())
        lastError = { code: Number.isInteger(code) ? code : null, signal: signal ?? null, ...safeFailureSummary(tail) }
      }
    })
  }

  async function stopChild() {
    if (!child) return
    const target = child
    intentionalStops.add(target)
    target.kill('SIGTERM')
    for (let count = 0; child === target && count < 50; count += 1) await sleep(100)
    if (child === target) target.kill('SIGKILL')
    for (let count = 0; child === target && count < 20; count += 1) await sleep(100)
    childStartedAt = null
    healthyPid = null
    consecutiveProbeFailures = 0
  }

  function probeSummary(probe) {
    return {
      healthy: probe.healthy === true, reason: probe.reason ?? null,
      rootStatus: probe.rootStatus ?? null, runtimeStatus: probe.runtimeStatus ?? null,
      profile: probe.profile ?? null, bootId: probe.bootId ?? null,
      rootDurationMs: probe.rootDurationMs ?? null, rootBytes: probe.rootBytes ?? null,
      runtimeDurationMs: probe.runtimeDurationMs ?? null, runtimeBytes: probe.runtimeBytes ?? null,
    }
  }

  await mkdir(config.stateDir, { recursive: true, mode: 0o700 })
  while (options.signal?.aborted !== true) {
    const cutoff = currentTime() - windowMs
    failures = failures.filter(value => value >= cutoff)
    const request = await readJson(requestPath)
    if (request?.type === 'restart' && request.profile === config.profile && Date.parse(request.expiresAt) >= currentTime()) {
      await rm(requestPath, { force: true })
      await publish('restarting', { owner: child ? 'guardian' : 'unknown', requestId: request.requestId })
      await stopChild()
    }
    let portOpen = !child && await portReady(config.host, config.port)
    if (!child && portOpen) {
      const probe = probeSummary(await probeHost(config))
      if (probe.healthy) {
        await recordProbe(probe, { owner: 'external', state: 'external-dsh-detected', portOpen: true })
        await publish('external-dsh-detected', { available: false, owner: 'external', health: probe, errorCode: 'GUARDIAN_NOT_OWNER' })
      } else {
        await recordProbe(probe, { owner: 'unknown', state: 'port-conflict', portOpen: true })
        await publish('port-conflict', { available: false, owner: 'unknown', health: probe, errorCode: 'GUARDIAN_PORT_CONFLICT' })
      }
      await sleep(options.pollMs ?? 1_000)
      continue
    }
    if (!child && failures.length >= maxRestarts) {
      if (!recoveryAttempted) {
        recoveryAttempted = true
        const recovery = await restorePendingRecovery()
        if (recovery.status === 'rolled-back-and-quarantined') {
          failures = []
          await publish('rolled-back', { owner: 'guardian', recovery })
        } else await publish('circuit-open', { available: false, owner: 'guardian', recovery })
      } else await publish('circuit-open', { available: false, owner: 'guardian', recovery: 'manual-confirmation-required' })
      await sleep(options.pollMs ?? 1_000)
      continue
    }
    if (!child) {
      await publish('starting', { owner: 'guardian' })
      try { launch() } catch {
        failures.push(currentTime())
        lastError = { category: 'startup-spawn-failed' }
      }
      await sleep(Math.min(2 ** failures.length * 1_000, 15_000))
      continue
    }

    portOpen = await portReady(config.host, config.port)
    const stableForMs = Math.max(0, currentTime() - childStartedAt)
    const probe = portOpen
      ? probeSummary(await probeHost(config))
      : { healthy: false, reason: 'port-not-ready', rootStatus: null, runtimeStatus: null, profile: null, bootId: null }
    if (probe.healthy) {
      consecutiveProbeFailures = 0
      await recordProbe(probe, { state: healthyPid === child.pid || stableForMs >= stableMs ? 'healthy' : 'health-checking', portOpen })
      if (healthyPid === child.pid) {
        await publish('healthy', { owner: 'guardian', stableForMs, health: probe })
      } else if (stableForMs >= stableMs) {
        healthyPid = child.pid
        recoveryAttempted = false
        lastError = null
        await rm(join(config.stateDir, 'pending-recovery.json'), { force: true })
        await publish('healthy', { owner: 'guardian', stableForMs, health: probe })
      } else await publish('health-checking', { owner: 'guardian', stableForMs, health: probe, consecutiveProbeFailures })
    } else {
      consecutiveProbeFailures += 1
      const restartRequired = stableForMs >= startupGraceMs && consecutiveProbeFailures >= unhealthyThreshold
      await recordProbe(probe, { state: restartRequired ? 'restarting-unhealthy' : (portOpen ? 'health-checking' : 'waiting-for-health'), portOpen, restartRequired })
      if (restartRequired) {
        failures.push(currentTime())
        lastError = { category: 'health-probe-failed', reason: probe.reason }
        await publish('restarting-unhealthy', {
          owner: 'guardian', stableForMs, health: probe, consecutiveProbeFailures,
        })
        await stopChild()
      } else await publish(portOpen ? 'health-checking' : 'waiting-for-health', {
        owner: 'guardian', stableForMs, health: probe, consecutiveProbeFailures,
      })
    }
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
