import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function upgradeError(code, message) {
  return Object.assign(new Error(message), { code })
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function atomicCopy(source, target) {
  const temporary = `${target}.${randomUUID()}.tmp`
  await copyFile(source, temporary)
  await rename(temporary, target)
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function digest(path) {
  try { return createHash('sha256').update(await readFile(path)).digest('hex') } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function parseLaunchdPid(output) {
  const text = typeof output === 'string' ? output : String(output?.stdout ?? '')
  const value = Number(/(?:^|\n)\s*pid\s*=\s*(\d+)\s*(?:\n|$)/m.exec(text)?.[1])
  return Number.isSafeInteger(value) && value > 1 ? value : null
}

function ownerIsGuardian(value) {
  return value === 'guardian' || value === 'guardian-legacy'
}

function bootId(value) {
  return typeof value?.health?.bootId === 'string' ? value.health.bootId
    : typeof value?.bootId === 'string' ? value.bootId : null
}

function validatePlan(value, now) {
  if (!value || value.schemaVersion !== 1 || value.operation !== 'active-guardian-upgrade') {
    throw upgradeError('GUARDIAN_UPGRADE_PLAN_INVALID', 'Guardian upgrade plan is invalid')
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value.profile ?? '') || !/^[A-Za-z0-9._-]+$/.test(value.label ?? '')) {
    throw upgradeError('GUARDIAN_UPGRADE_PLAN_INVALID', 'Guardian upgrade identity is invalid')
  }
  if (!value.old || !Number.isSafeInteger(value.old.guardianPid) || !Number.isSafeInteger(value.old.hostPid)
    || typeof value.old.hostBootId !== 'string' || value.old.hostBootId.length === 0) {
    throw upgradeError('GUARDIAN_UPGRADE_PLAN_INVALID', 'Guardian upgrade owner binding is invalid')
  }
  const requiredPaths = [
    'status', 'daemon', 'config', 'plist', 'stagedDaemon', 'stagedConfig', 'stagedPlist',
    'backupDir', 'receipt', 'launchctl', 'plan',
  ]
  if (requiredPaths.some(key => !isAbsolute(value.paths?.[key] ?? ''))) {
    throw upgradeError('GUARDIAN_UPGRADE_PLAN_INVALID', 'Guardian upgrade paths must be absolute')
  }
  if (!value.hashes || ['daemon', 'config', 'plist', 'stagedDaemon', 'stagedConfig', 'stagedPlist']
    .some(key => !/^[0-9a-f]{64}$/.test(value.hashes[key] ?? ''))) {
    throw upgradeError('GUARDIAN_UPGRADE_PLAN_INVALID', 'Guardian upgrade hashes are invalid')
  }
  if (!Number.isFinite(Date.parse(value.expiresAt)) || now() > Date.parse(value.expiresAt)) {
    throw upgradeError('GUARDIAN_UPGRADE_PLAN_EXPIRED', 'Guardian upgrade plan expired')
  }
  return value
}

export async function runGuardianUpgrade(rawPlan, options = {}) {
  const now = options.now ?? Date.now
  const sleep = options.delay ?? delay
  const exec = options.execFile ?? ((file, args) => new Promise((resolve, reject) => execFile(file, args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }))))
  const signalProcess = options.signalProcess ?? ((pid, signal) => process.kill(pid, signal))
  const plan = validatePlan(rawPlan, now)
  const timeoutMs = plan.timeoutMs ?? 15_000
  const pollMs = plan.pollMs ?? 250
  const staleMs = plan.staleMs ?? 15_000
  const mainJob = `${plan.domain}/${plan.label}`
  const notBefore = Date.parse(plan.notBefore)
  if (Number.isFinite(notBefore) && now() < notBefore) await sleep(notBefore - now())
  if (now() > Date.parse(plan.expiresAt)) {
    throw upgradeError('GUARDIAN_UPGRADE_PLAN_EXPIRED', 'Guardian upgrade plan expired before handoff')
  }

  async function launchdPid() {
    return parseLaunchdPid(await exec(plan.paths.launchctl, ['print', mainJob]))
  }

  async function alive(pid) {
    try { signalProcess(pid, 0); return true } catch (error) {
      if (error?.code === 'ESRCH') return false
      throw error
    }
  }

  async function stopHost(pid) {
    if (!await alive(pid)) return { pid, signal: null }
    signalProcess(pid, 'SIGTERM')
    for (let attempt = 0; attempt < Math.max(1, Math.ceil(5_000 / pollMs)); attempt += 1) {
      if (!await alive(pid)) return { pid, signal: 'SIGTERM' }
      await sleep(pollMs)
    }
    signalProcess(pid, 'SIGKILL')
    for (let attempt = 0; attempt < Math.max(1, Math.ceil(2_000 / pollMs)); attempt += 1) {
      if (!await alive(pid)) return { pid, signal: 'SIGKILL' }
      await sleep(pollMs)
    }
    throw upgradeError('GUARDIAN_OWNED_HOST_STOP_FAILED', 'The previously verified DSH Host did not stop')
  }

  async function assertHashes(expected, prefix = '') {
    for (const key of ['daemon', 'config', 'plist']) {
      const path = prefix ? plan.paths[`${prefix}${key[0].toUpperCase()}${key.slice(1)}`] : plan.paths[key]
      if (await digest(path) !== expected[key]) throw upgradeError('GUARDIAN_UPGRADE_PRECONDITION_CHANGED', `${key} changed after confirmation`)
    }
  }

  async function waitForOwner(minimumHeartbeatAt, previousGuardianPid = null, requireDifferentBoot = true) {
    const attempts = Math.max(1, Math.ceil(timeoutMs / pollMs) + 1)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const [status, guardianPid] = await Promise.all([readJson(plan.paths.status), launchdPid()])
        const heartbeatAt = Date.parse(status?.heartbeatAt)
        const fresh = Number.isFinite(heartbeatAt) && now() - heartbeatAt <= staleMs
        if (guardianPid !== null && guardianPid !== previousGuardianPid
          && status?.profile === plan.profile && ownerIsGuardian(status?.owner)
          && Number.isSafeInteger(status?.pid) && fresh && heartbeatAt >= minimumHeartbeatAt
          && (!requireDifferentBoot || bootId(status) !== plan.old.hostBootId)
          && (status.guardianPid === undefined || status.guardianPid === guardianPid)) {
          return { status, guardianPid }
        }
      } catch { /* launchd and the daemon publish asynchronously. */ }
      if (attempt + 1 < attempts) await sleep(pollMs)
    }
    throw upgradeError('GUARDIAN_UPGRADE_HEARTBEAT_UNVERIFIED', 'The replacement Guardian did not become the verified Host owner')
  }

  async function assertActiveIdentity() {
    const [current, currentGuardianPid] = await Promise.all([
      readJson(plan.paths.status),
      launchdPid(),
    ])
    const heartbeatAt = Date.parse(current?.heartbeatAt)
    if (currentGuardianPid !== plan.old.guardianPid || current?.profile !== plan.profile
      || current?.pid !== plan.old.hostPid || bootId(current) !== plan.old.hostBootId
      || !ownerIsGuardian(current?.owner) || !Number.isFinite(heartbeatAt)
      || now() - heartbeatAt < 0 || now() - heartbeatAt > staleMs) {
      throw upgradeError('GUARDIAN_ACTIVE_IDENTITY_CHANGED', 'Guardian or DSH Host identity changed before handoff')
    }
  }

  const startedAt = now()
  let oldHostStop = null
  let backupReady = false
  let mainStopped = false
  let replacementBootstrapped = false
  await mkdir(plan.paths.backupDir, { recursive: true, mode: 0o700 })
  try {
    await assertHashes(plan.hashes)
    await assertHashes({
      daemon: plan.hashes.stagedDaemon,
      config: plan.hashes.stagedConfig,
      plist: plan.hashes.stagedPlist,
    }, 'staged')
    await assertActiveIdentity()
    await Promise.all([
      copyFile(plan.paths.daemon, join(plan.paths.backupDir, 'guardian-daemon.mjs')),
      copyFile(plan.paths.config, join(plan.paths.backupDir, 'config.json')),
      copyFile(plan.paths.plist, join(plan.paths.backupDir, 'launch-agent.plist')),
    ])
    await atomicJson(join(plan.paths.backupDir, 'manifest.json'), {
      schemaVersion: 1, operation: plan.operation, planId: plan.planId,
      createdAt: new Date(now()).toISOString(), hashes: {
        daemon: plan.hashes.daemon, config: plan.hashes.config, plist: plan.hashes.plist,
      },
    })
    backupReady = true
    // The live owner can change while backups are copied. Re-check immediately
    // before the first destructive launchd operation so a stale plan can never
    // stop a replacement Guardian or a different DSH Host.
    await assertActiveIdentity()
    await exec(plan.paths.launchctl, ['bootout', mainJob])
    mainStopped = true
    oldHostStop = await stopHost(plan.old.hostPid)
    await Promise.all([
      atomicCopy(plan.paths.stagedDaemon, plan.paths.daemon),
      atomicCopy(plan.paths.stagedConfig, plan.paths.config),
      atomicCopy(plan.paths.stagedPlist, plan.paths.plist),
    ])
    const bootstrapStartedAt = now()
    await exec(plan.paths.launchctl, ['bootstrap', plan.domain, plan.paths.plist])
    replacementBootstrapped = true
    const replacement = await waitForOwner(bootstrapStartedAt, plan.old.guardianPid, true)
    await assertHashes({
      daemon: plan.hashes.stagedDaemon,
      config: plan.hashes.stagedConfig,
      plist: plan.hashes.stagedPlist,
    })
    const receipt = {
      schemaVersion: 1, operation: plan.operation, planId: plan.planId, status: 'completed',
      profile: plan.profile, startedAt: new Date(startedAt).toISOString(), completedAt: new Date(now()).toISOString(),
      previous: plan.old,
      replacement: {
        guardianPid: replacement.guardianPid, hostPid: replacement.status.pid,
        hostBootId: bootId(replacement.status), heartbeatAt: replacement.status.heartbeatAt,
      },
      oldHostStop,
    }
    await atomicJson(plan.paths.receipt, receipt)
    return receipt
  } catch (error) {
    const recovery = {
      attempted: mainStopped || replacementBootstrapped,
      restored: !mainStopped && !replacementBootstrapped,
      relaunchedPreviousGuardian: false,
      heartbeatVerified: !mainStopped && !replacementBootstrapped,
    }
    if (recovery.attempted) {
      try {
        const replacement = replacementBootstrapped ? await readJson(plan.paths.status) : null
        await exec(plan.paths.launchctl, ['bootout', mainJob]).catch(() => {})
        if (replacementBootstrapped && replacement?.profile === plan.profile
          && ownerIsGuardian(replacement?.owner) && Number.isSafeInteger(replacement?.pid)
          && replacement.pid !== plan.old.hostPid) await stopHost(replacement.pid)
        if (!backupReady) throw upgradeError('GUARDIAN_UPGRADE_BACKUP_INCOMPLETE', 'Guardian backup is incomplete')
        await Promise.all([
          atomicCopy(join(plan.paths.backupDir, 'guardian-daemon.mjs'), plan.paths.daemon),
          atomicCopy(join(plan.paths.backupDir, 'config.json'), plan.paths.config),
          atomicCopy(join(plan.paths.backupDir, 'launch-agent.plist'), plan.paths.plist),
        ])
        recovery.restored = true
        const rollbackStartedAt = now()
        await exec(plan.paths.launchctl, ['bootstrap', plan.domain, plan.paths.plist])
        recovery.relaunchedPreviousGuardian = true
        await waitForOwner(rollbackStartedAt, null, false)
        recovery.heartbeatVerified = true
      } catch { /* Receipt keeps rollback uncertainty explicit for the UI and next diagnostic run. */ }
    }
    const receipt = {
      schemaVersion: 1, operation: plan.operation, planId: plan.planId, status: 'rolled-back',
      profile: plan.profile, startedAt: new Date(startedAt).toISOString(), completedAt: new Date(now()).toISOString(),
      error: { code: error?.code ?? 'GUARDIAN_UPGRADE_FAILED', message: String(error?.message ?? error).slice(0, 500) },
      recovery, oldHostStop,
    }
    await atomicJson(plan.paths.receipt, receipt)
    throw Object.assign(upgradeError('GUARDIAN_UPGRADE_FAILED', 'Guardian active upgrade failed'), { receipt })
  } finally {
    await rm(plan.paths.plan, { force: true }).catch(() => {})
  }
}

async function cli() {
  const planPath = process.argv[2]
  if (!isAbsolute(planPath ?? '')) throw upgradeError('GUARDIAN_UPGRADE_PLAN_INVALID', 'Absolute plan path is required')
  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  await runGuardianUpgrade(plan)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch(error => {
    process.stderr.write(`${error?.code ?? 'GUARDIAN_UPGRADE_FAILED'}\n`)
    process.exitCode = 1
  })
}
