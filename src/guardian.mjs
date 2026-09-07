import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { delimiter, isAbsolute, join } from 'node:path'

function paths(dshHome) {
  const root = join(dshHome, 'dsh-safe-plugin-manager', 'guardian')
  return {
    root, status: join(root, 'status.json'), request: join(root, 'request.json'),
    daemon: join(root, 'guardian-daemon.mjs'), config: join(root, 'config.json'),
    backups: join(root, 'install-backups'), handoffs: join(root, 'upgrade-handoffs'),
    upgradeReceipt: join(root, 'upgrade-receipt.json'),
  }
}

function validateRestartSpec(value, profile) {
  if (!value || !isAbsolute(value.nodePath) || !isAbsolute(value.cliPath) || !isAbsolute(value.cwd)) {
    throw Object.assign(new Error('Guardian 重启路径必须是绝对路径。'), { code: 'GUARDIAN_RESTART_SPEC_INVALID' })
  }
  if (!Array.isArray(value.runtimeArgs) || value.runtimeArgs.some(item => typeof item !== 'string') || value.profile !== profile) {
    throw Object.assign(new Error('Guardian 重启参数无效。'), { code: 'GUARDIAN_RESTART_SPEC_INVALID' })
  }
  if (typeof value.commandPath !== 'string' || value.commandPath.length === 0
    || value.commandPath.split(delimiter).some(item => !item || !isAbsolute(item))) {
    throw Object.assign(new Error('Guardian 命令 PATH 无效。'), { code: 'GUARDIAN_COMMAND_PATH_INVALID' })
  }
  return value
}

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

export function createGuardianService(options = {}) {
  const location = paths(options.dshHome)
  const staleMs = options.staleMs ?? 15_000
  const currentTime = options.now ?? Date.now
  const sleep = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay))
  const bootstrapTimeoutMs = options.bootstrapTimeoutMs ?? 10_000
  const bootstrapPollMs = options.bootstrapPollMs ?? 250
  const stopTimeoutMs = options.stopTimeoutMs ?? 5_000
  const stopPollMs = options.stopPollMs ?? 100
  const handoffDelayMs = options.handoffDelayMs ?? 750
  const activeHandoffDelayMs = options.activeHandoffDelayMs ?? 1_500
  const plans = new Map()
  const label = 'com.ai-scarlett.dsh-guardian'
  const launchAgentsDir = options.launchAgentsDir ?? join(homedir(), 'Library', 'LaunchAgents')
  const plistPath = join(launchAgentsDir, `${label}.plist`)
  const daemonSource = options.daemonSource ?? fileURLToPath(new URL('./guardian-daemon.mjs', import.meta.url))
  const upgraderSource = options.upgraderSource ?? fileURLToPath(new URL('./guardian-upgrader.mjs', import.meta.url))
  const upgraderLabel = 'com.ai-scarlett.dsh-guardian-upgrader'
  const upgraderPlistPath = join(launchAgentsDir, `${upgraderLabel}.plist`)
  const launchctl = options.launchctl ?? '/bin/launchctl'
  const exec = options.execFile ?? ((file, args) => new Promise((resolve, reject) => execFile(file, args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }))))
  const signalProcess = options.signalProcess ?? ((pid, signal) => process.kill(pid, signal))

  async function fileDigest(path) {
    try { return createHash('sha256').update(await readFile(path)).digest('hex') } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  function xml(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  }

  function guardianOwner(owner) {
    return owner === 'guardian' || owner === 'guardian-legacy'
  }

  async function readStatusDocumentAt(path) {
    try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error?.code)) return null
      throw error
    }
  }

  const readStatusDocument = () => readStatusDocumentAt(location.status)

  function heartbeatState(value) {
    const heartbeatAgeMs = Math.max(0, currentTime() - Date.parse(value?.heartbeatAt))
    return {
      heartbeatAgeMs,
      heartbeatFresh: Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs <= staleMs,
    }
  }

  function hostBootId(value) {
    return typeof value?.health?.bootId === 'string' ? value.health.bootId
      : typeof value?.bootId === 'string' ? value.bootId : null
  }

  function parseLaunchdPid(output) {
    const text = typeof output === 'string' ? output : String(output?.stdout ?? '')
    const value = Number(/(?:^|\n)\s*pid\s*=\s*(\d+)\s*(?:\n|$)/m.exec(text)?.[1])
    return Number.isSafeInteger(value) && value > 1 ? value : null
  }

  async function launchdGuardianPid(domain) {
    return parseLaunchdPid(await exec(launchctl, ['print', `${domain}/${label}`]))
  }

  function sameActiveIdentity(value, expected) {
    return value?.profile === expected.profile
      && value?.pid === expected.hostPid
      && hostBootId(value) === expected.hostBootId
      && guardianOwner(value?.owner ?? (Number.isInteger(value?.pid) ? 'guardian-legacy' : 'unknown'))
      && heartbeatState(value).heartbeatFresh
  }

  async function processAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return false
    try { signalProcess(pid, 0); return true } catch (error) {
      if (error?.code === 'ESRCH') return false
      throw error
    }
  }

  async function stopOwnedHost(pid) {
    if (!await processAlive(pid)) return { pid, signal: null, stopped: true }
    signalProcess(pid, 'SIGTERM')
    const attempts = Math.max(1, Math.ceil(stopTimeoutMs / stopPollMs))
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!await processAlive(pid)) return { pid, signal: 'SIGTERM', stopped: true }
      await sleep(stopPollMs)
    }
    signalProcess(pid, 'SIGKILL')
    for (let attempt = 0; attempt < Math.max(1, Math.ceil(2_000 / stopPollMs)); attempt += 1) {
      if (!await processAlive(pid)) return { pid, signal: 'SIGKILL', stopped: true }
      await sleep(stopPollMs)
    }
    throw Object.assign(new Error('已验证的旧 DSH Host 未在限定时间内停止，拒绝启动第二个 Host。'), {
      code: 'GUARDIAN_OWNED_HOST_STOP_FAILED',
    })
  }

  async function readOptional(path) {
    try { return await readFile(path) } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function restoreFile(path, content) {
    if (content === null) {
      await rm(path, { force: true })
      return
    }
    const temporary = `${path}.${randomUUID()}.restore`
    await writeFile(temporary, content, { mode: 0o600 })
    await rename(temporary, path)
  }

  async function writeInstallBackup(backupDir, name, content) {
    if (content !== null) await writeFile(join(backupDir, name), content, { mode: 0o600 })
    return content !== null
  }

  async function status() {
    try {
      const value = await readStatusDocument()
      if (value === null) throw Object.assign(new Error('missing Guardian status'), { code: 'ENOENT' })
      const [sourceSha256, deployedSha256, lastUpgrade] = await Promise.all([
        fileDigest(daemonSource), fileDigest(location.daemon),
        readStatusDocumentAt(location.upgradeReceipt),
      ])
      const daemonCurrent = sourceSha256 !== null && sourceSha256 === deployedSha256
      const { heartbeatAgeMs, heartbeatFresh } = heartbeatState(value)
      const owner = value.owner ?? (Number.isInteger(value.pid) ? 'guardian-legacy' : 'unknown')
      const guardianOwnsHost = guardianOwner(owner)
      const available = heartbeatFresh && guardianOwnsHost && value.available !== false && daemonCurrent
      const errorCode = available ? null : heartbeatFresh && !guardianOwnsHost
        ? 'GUARDIAN_NOT_OWNER'
        : !daemonCurrent ? 'GUARDIAN_VERSION_DRIFT' : value.errorCode ?? 'GUARDIAN_UNAVAILABLE'
      return {
        ...value, owner, heartbeatAgeMs, heartbeatFresh, available, errorCode,
        daemonCurrent, upgradeRequired: !daemonCurrent,
        lastUpgrade,
        probeLog: { enabled: daemonCurrent, retentionHours: 24 },
      }
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) {
        return { schemaVersion: 1, installed: true, available: false, state: 'invalid-status', errorCode: 'GUARDIAN_STATUS_INVALID' }
      }
      return { schemaVersion: 1, installed: false, available: false, state: 'not-installed', errorCode: 'GUARDIAN_NOT_INSTALLED' }
    }
  }

  async function requestRestart(input) {
    const current = await status()
    if (!current.available) throw Object.assign(new Error('DSH Guardian 未安装或心跳已停止，拒绝关闭当前 Host。'), { code: current.errorCode ?? 'GUARDIAN_UNAVAILABLE' })
    await mkdir(location.root, { recursive: true, mode: 0o700 })
    const request = {
      schemaVersion: 1, requestId: randomUUID(), type: 'restart', profile: input.profile,
      oldPid: input.oldPid, previousBootId: input.previousBootId,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    await atomicJson(location.request, request)
    return request
  }

  async function createInstallPlan(input = {}) {
    if (process.platform !== 'darwin' && options.allowNonDarwin !== true) throw Object.assign(new Error('当前 Guardian 安装器只支持 macOS launchd。'), { code: 'GUARDIAN_PLATFORM_UNSUPPORTED' })
    const planId = randomUUID()
    const profile = input.profile ?? 'web'
    const domain = `gui/${process.getuid()}`
    const [daemonSourceSha256, daemonTargetSha256, configSha256, plistSha256] = await Promise.all([
      fileDigest(daemonSource), fileDigest(location.daemon), fileDigest(location.config), fileDigest(plistPath),
    ])
    const upgrading = daemonTargetSha256 !== null
    const existing = await readStatusDocument()
    let activeGuardian = null
    if (upgrading && existing && heartbeatState(existing).heartbeatFresh
      && guardianOwner(existing.owner ?? (Number.isInteger(existing.pid) ? 'guardian-legacy' : 'unknown'))) {
      if (existing.profile !== profile || !Number.isSafeInteger(existing.pid) || existing.pid <= 1 || hostBootId(existing) === null
        || configSha256 === null || plistSha256 === null) {
        throw Object.assign(new Error('无法把升级计划绑定到当前 Guardian 与 DSH Host 身份。'), { code: 'GUARDIAN_ACTIVE_IDENTITY_UNVERIFIED' })
      }
      let guardianPid
      try { guardianPid = await launchdGuardianPid(domain) } catch {
        throw Object.assign(new Error('无法从 launchd 验证当前 Guardian 进程。'), { code: 'GUARDIAN_ACTIVE_IDENTITY_UNVERIFIED' })
      }
      if (guardianPid === null) {
        throw Object.assign(new Error('launchd 未返回当前 Guardian 的有效进程号。'), { code: 'GUARDIAN_ACTIVE_IDENTITY_UNVERIFIED' })
      }
      activeGuardian = {
        profile, guardianPid, hostPid: existing.pid, hostBootId: hostBootId(existing),
        heartbeatAt: existing.heartbeatAt,
      }
    }
    const plan = {
      schemaVersion: 1, planId, action: upgrading ? 'upgrade-guardian' : 'install-guardian', profile,
      createdAt: new Date(currentTime()).toISOString(), expiresAt: new Date(currentTime() + 300_000).toISOString(),
      confirmation: `${upgrading ? 'UPDATE' : 'INSTALL'} DSH GUARDIAN ${profile}`,
      preconditions: { plistSha256, daemonSourceSha256, daemonTargetSha256, configSha256, activeGuardian },
      impact: {
        writes: [join(location.root, 'guardian-daemon.mjs'), join(location.root, 'config.json'), plistPath],
        backupDirectory: join(location.backups, planId),
        replacesLaunchdJob: 'local.dsh.web', installsLaunchdJob: label,
        activeHandoff: activeGuardian ? {
          mode: 'verified-owner-restart', guardianPid: activeGuardian.guardianPid,
          hostPid: activeGuardian.hostPid, hostBootId: activeGuardian.hostBootId,
        } : null,
        neverModifies: ['DeepSeek Harness source', '@deepseek-ai/* packages'],
      },
    }
    plans.set(planId, plan)
    return plan
  }

  async function waitForFreshGuardianHeartbeat(domain, minimumHeartbeatAt, requirements = {}) {
    const attempts = Math.max(1, Math.ceil(bootstrapTimeoutMs / bootstrapPollMs) + 1)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const guardianPid = parseLaunchdPid(await exec(launchctl, ['print', `${domain}/${label}`]))
        const candidate = await status()
        const heartbeatAt = Date.parse(candidate.heartbeatAt)
        const verifiedOwner = requirements.requireOwnedHost === true
          ? guardianOwner(candidate.owner)
          : guardianOwner(candidate.owner) || candidate.owner === 'external'
        if (candidate.daemonCurrent && candidate.heartbeatFresh && verifiedOwner
          && candidate.profile === requirements.profile
          && (requirements.previousGuardianPid === undefined || guardianPid !== requirements.previousGuardianPid)
          && (candidate.guardianPid === undefined || guardianPid === null || candidate.guardianPid === guardianPid)
          && Number.isFinite(heartbeatAt) && heartbeatAt >= minimumHeartbeatAt) {
          return { ...candidate, guardianPid: candidate.guardianPid ?? guardianPid }
        }
      } catch { /* launchd may not publish the job immediately; retry within the bounded window. */ }
      if (attempt + 1 < attempts) await sleep(bootstrapPollMs)
    }
    throw Object.assign(new Error('Guardian 启动后未在限定时间内写入新的可验证心跳；当前 Host 未被关闭。'), {
      code: 'GUARDIAN_BOOTSTRAP_UNVERIFIED',
    })
  }

  async function waitForRestoredGuardianHeartbeat(domain, minimumHeartbeatAt, profile) {
    const attempts = Math.max(1, Math.ceil(bootstrapTimeoutMs / bootstrapPollMs) + 1)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const guardianPid = await launchdGuardianPid(domain)
        const candidate = await readStatusDocument()
        const heartbeatAt = Date.parse(candidate?.heartbeatAt)
        if (guardianPid !== null && candidate?.profile === profile
          && guardianOwner(candidate?.owner ?? (Number.isInteger(candidate?.pid) ? 'guardian-legacy' : 'unknown'))
          && heartbeatState(candidate).heartbeatFresh
          && Number.isFinite(heartbeatAt) && heartbeatAt >= minimumHeartbeatAt) {
          return { ...candidate, guardianPid: candidate.guardianPid ?? guardianPid }
        }
      } catch { /* rollback verification is bounded and retried. */ }
      if (attempt + 1 < attempts) await sleep(bootstrapPollMs)
    }
    throw Object.assign(new Error('旧版 Guardian 文件已恢复，但重新启动后的心跳未通过验证。'), {
      code: 'GUARDIAN_ROLLBACK_UNVERIFIED',
    })
  }

  function guardianConfig(restart, profile) {
    return {
      schemaVersion: 1, ...restart, stateDir: location.root, host: '127.0.0.1', port: 3080,
      profileDir: join(options.dshHome, 'profiles', profile),
      stableMs: 30_000, restartWindowMs: 300_000, maxRestarts: 3,
      healthProbeTimeoutMs: 1_500, unhealthyThreshold: 3, startupGraceMs: 10_000,
      probeRetentionMs: 86_400_000, probeLogMaxBytes: 4_194_304,
      healthyProbeLogIntervalMs: 60_000, probePruneIntervalMs: 300_000,
    }
  }

  function guardianPlist(restart, daemonPath = location.daemon, configPath = location.config) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array><string>${xml(restart.nodePath)}</string><string>${xml(daemonPath)}</string><string>${xml(configPath)}</string></array>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>\n<key>StandardOutPath</key><string>${xml(join(location.root, 'guardian.log'))}</string><key>StandardErrorPath</key><string>${xml(join(location.root, 'guardian.log'))}</string>\n</dict></plist>\n`
  }

  async function stageActiveUpgrade(plan, restart, domain, activeGuardian) {
    const handoffDir = join(location.handoffs, plan.planId)
    const stagedDaemon = join(handoffDir, 'guardian-daemon.mjs')
    const stagedConfig = join(handoffDir, 'config.json')
    const stagedPlist = join(handoffDir, 'launch-agent.plist')
    const stagedUpgrader = join(handoffDir, 'guardian-upgrader.mjs')
    const handoffPlanPath = join(handoffDir, 'plan.json')
    await mkdir(handoffDir, { recursive: true, mode: 0o700 })
    await Promise.all([copyFile(daemonSource, stagedDaemon), copyFile(upgraderSource, stagedUpgrader)])
    await atomicJson(stagedConfig, guardianConfig(restart, plan.profile))
    await writeFile(stagedPlist, guardianPlist(restart), { mode: 0o600 })
    const [stagedDaemonSha256, stagedConfigSha256, stagedPlistSha256] = await Promise.all([
      fileDigest(stagedDaemon), fileDigest(stagedConfig), fileDigest(stagedPlist),
    ])
    const expiresAt = new Date(currentTime() + 120_000).toISOString()
    await atomicJson(handoffPlanPath, {
      schemaVersion: 1, operation: 'active-guardian-upgrade', planId: plan.planId,
      createdAt: new Date(currentTime()).toISOString(), notBefore: new Date(currentTime() + activeHandoffDelayMs).toISOString(),
      expiresAt, profile: plan.profile, label, upgraderLabel, domain,
      timeoutMs: bootstrapTimeoutMs, pollMs: bootstrapPollMs, staleMs,
      old: activeGuardian,
      hashes: {
        daemon: plan.preconditions.daemonTargetSha256,
        config: plan.preconditions.configSha256,
        plist: plan.preconditions.plistSha256,
        stagedDaemon: stagedDaemonSha256, stagedConfig: stagedConfigSha256, stagedPlist: stagedPlistSha256,
      },
      paths: {
        plan: handoffPlanPath, status: location.status, daemon: location.daemon, config: location.config,
        plist: plistPath, stagedDaemon, stagedConfig, stagedPlist,
        backupDir: join(location.backups, plan.planId), receipt: location.upgradeReceipt,
        launchctl,
      },
    })
    const upgraderPlist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${upgraderLabel}</string>\n<key>ProgramArguments</key><array><string>${xml(restart.nodePath)}</string><string>${xml(stagedUpgrader)}</string><string>${xml(handoffPlanPath)}</string></array>\n<key>RunAtLoad</key><true/><key>ProcessType</key><string>Interactive</string>\n<key>StandardOutPath</key><string>${xml(join(location.root, 'guardian-upgrade.log'))}</string><key>StandardErrorPath</key><string>${xml(join(location.root, 'guardian-upgrade.log'))}</string>\n</dict></plist>\n`
    await writeFile(`${upgraderPlistPath}.tmp`, upgraderPlist, { mode: 0o600 })
    await rename(`${upgraderPlistPath}.tmp`, upgraderPlistPath)
    await rm(location.upgradeReceipt, { force: true })
    await exec(launchctl, ['bootout', `${domain}/${upgraderLabel}`]).catch(() => {})
    try {
      await exec(launchctl, ['bootstrap', domain, upgraderPlistPath])
    } catch {
      throw Object.assign(new Error('无法启动独立 Guardian 升级交接器；当前 Guardian 与 Host 保持不变。'), {
        code: 'GUARDIAN_UPGRADER_BOOTSTRAP_FAILED',
      })
    }
    return {
      schemaVersion: 1, status: 'update-scheduled', label, profile: plan.profile, plistPath,
      handoff: {
        status: 'scheduled', mode: 'active-guardian-upgrade', planId: plan.planId, delayMs: activeHandoffDelayMs,
        previousGuardianPid: activeGuardian.guardianPid, previousHostPid: activeGuardian.hostPid,
        previousBootId: activeGuardian.hostBootId, receiptPath: location.upgradeReceipt,
      },
    }
  }

  async function executeInstall(input = {}) {
    const plan = plans.get(input.planId)
    if (!plan) throw Object.assign(new Error('Guardian 安装计划不存在或已使用。'), { code: 'GUARDIAN_PLAN_NOT_FOUND' })
    plans.delete(input.planId)
    if (currentTime() > Date.parse(plan.expiresAt)) throw Object.assign(new Error('Guardian 安装计划已过期。'), { code: 'GUARDIAN_PLAN_EXPIRED' })
    if (input.confirmation !== plan.confirmation) throw Object.assign(new Error('Guardian 安装确认语不匹配。'), { code: 'GUARDIAN_CONFIRMATION_MISMATCH' })
    if (await fileDigest(plistPath) !== plan.preconditions.plistSha256
      || await fileDigest(daemonSource) !== plan.preconditions.daemonSourceSha256
      || await fileDigest(location.daemon) !== plan.preconditions.daemonTargetSha256
      || await fileDigest(location.config) !== plan.preconditions.configSha256) {
      throw Object.assign(new Error('Guardian 文件在确认后发生变化。'), { code: 'GUARDIAN_PRECONDITION_CHANGED' })
    }
    const restart = validateRestartSpec(options.restartSpec(plan.profile), plan.profile)
    const domain = `gui/${process.getuid()}`
    const activeGuardian = plan.preconditions.activeGuardian
    const existingDocument = await readStatusDocument()
    if (activeGuardian) {
      let currentGuardianPid
      try { currentGuardianPid = await launchdGuardianPid(domain) } catch { currentGuardianPid = null }
      if (!sameActiveIdentity(existingDocument, activeGuardian) || currentGuardianPid !== activeGuardian.guardianPid) {
        throw Object.assign(new Error('当前 Guardian 或其 DSH Host 在确认后发生变化，已取消主动升级。'), {
          code: 'GUARDIAN_ACTIVE_IDENTITY_CHANGED',
        })
      }
    } else if (existingDocument && heartbeatState(existingDocument).heartbeatFresh
      && guardianOwner(existingDocument.owner ?? (Number.isInteger(existingDocument.pid) ? 'guardian-legacy' : 'unknown'))) {
      throw Object.assign(new Error('确认后出现新的 Guardian 启动所有者，已取消安装以避免双 Host。'), {
        code: 'GUARDIAN_PRECONDITION_CHANGED',
      })
    }
    if (activeGuardian) return stageActiveUpgrade(plan, restart, domain, activeGuardian)
    await mkdir(location.root, { recursive: true, mode: 0o700 })
    await mkdir(launchAgentsDir, { recursive: true, mode: 0o700 })
    const original = {
      daemon: await readOptional(location.daemon), config: await readOptional(location.config), plist: await readOptional(plistPath),
    }
    const backupDir = join(location.backups, plan.planId)
    await mkdir(backupDir, { recursive: true, mode: 0o700 })
    await Promise.all([
      writeInstallBackup(backupDir, 'guardian-daemon.mjs', original.daemon),
      writeInstallBackup(backupDir, 'config.json', original.config),
      writeInstallBackup(backupDir, 'launch-agent.plist', original.plist),
    ])
    await atomicJson(join(backupDir, 'manifest.json'), {
      schemaVersion: 1, createdAt: new Date(currentTime()).toISOString(), planId: plan.planId,
      files: { daemon: original.daemon !== null, config: original.config !== null, plist: original.plist !== null },
    })

    let launchdStopped = false
    let replacementBootstrapped = false
    let activeHostStop = null
    const rollback = async () => {
      const result = {
        attempted: true, restored: true, relaunchedPreviousGuardian: false,
        heartbeatVerified: false, replacementHostStopped: false,
      }
      try {
        const replacement = replacementBootstrapped ? await readStatusDocument().catch(() => null) : null
        if (replacementBootstrapped || launchdStopped) {
          await exec(launchctl, ['bootout', `${domain}/${label}`]).catch(() => {})
        }
        if (replacementBootstrapped && replacement?.profile === plan.profile
          && guardianOwner(replacement?.owner) && Number.isSafeInteger(replacement?.pid)
          && replacement.pid !== activeGuardian?.hostPid) {
          const stopped = await stopOwnedHost(replacement.pid)
          result.replacementHostStopped = stopped.stopped
        }
        await restoreFile(location.daemon, original.daemon)
        await restoreFile(location.config, original.config)
        await restoreFile(plistPath, original.plist)
        if (original.plist !== null && (launchdStopped || replacementBootstrapped)) {
          const rollbackStartedAt = currentTime()
          await exec(launchctl, ['bootstrap', domain, plistPath])
          result.relaunchedPreviousGuardian = true
          await waitForRestoredGuardianHeartbeat(domain, rollbackStartedAt, plan.profile)
          result.heartbeatVerified = true
        }
      } catch {
        result.restored = false
      }
      return result
    }

    try {
      if (activeGuardian) {
        await exec(launchctl, ['bootout', `${domain}/${label}`])
        launchdStopped = true
        activeHostStop = await stopOwnedHost(activeGuardian.hostPid)
      } else {
        await exec(launchctl, ['bootout', `${domain}/${label}`]).then(
          () => { launchdStopped = true },
          () => {},
        )
      }
      const daemonTemporary = `${location.daemon}.${randomUUID()}.tmp`
      await copyFile(daemonSource, daemonTemporary); await rename(daemonTemporary, location.daemon)
      await atomicJson(location.config, {
        schemaVersion: 1, ...restart, stateDir: location.root, host: '127.0.0.1', port: 3080,
        profileDir: join(options.dshHome, 'profiles', plan.profile),
        stableMs: 30_000, restartWindowMs: 300_000, maxRestarts: 3,
        healthProbeTimeoutMs: 1_500, unhealthyThreshold: 3, startupGraceMs: 10_000,
        probeRetentionMs: 86_400_000, probeLogMaxBytes: 4_194_304,
        healthyProbeLogIntervalMs: 60_000, probePruneIntervalMs: 300_000,
      })
      const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array><string>${xml(restart.nodePath)}</string><string>${xml(location.daemon)}</string><string>${xml(location.config)}</string></array>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>\n<key>StandardOutPath</key><string>${xml(join(location.root, 'guardian.log'))}</string><key>StandardErrorPath</key><string>${xml(join(location.root, 'guardian.log'))}</string>\n</dict></plist>\n`
      await writeFile(`${plistPath}.tmp`, plist, { mode: 0o600 }); await rename(`${plistPath}.tmp`, plistPath)
      const previousHeartbeatAt = Date.parse(existingDocument?.heartbeatAt)
      const bootstrapStartedAt = currentTime()
      await exec(launchctl, ['bootstrap', domain, plistPath])
      replacementBootstrapped = true
      const guardian = await waitForFreshGuardianHeartbeat(
        domain,
        Math.max(bootstrapStartedAt, Number.isFinite(previousHeartbeatAt) ? previousHeartbeatAt + 1 : 0),
        {
          profile: plan.profile,
          requireOwnedHost: Boolean(activeGuardian),
          ...(activeGuardian ? { previousGuardianPid: activeGuardian.guardianPid } : {}),
        },
      )
      if (!activeGuardian) {
        schedule(() => { void exec(launchctl, ['bootout', `${domain}/local.dsh.web`]).catch(() => {}) }, handoffDelayMs)
      }
      return {
        schemaVersion: 1, status: plan.action === 'upgrade-guardian' ? 'updated' : 'installed', label, profile: plan.profile, plistPath,
        handoff: activeGuardian ? {
          status: 'completed', mode: 'verified-owner-restart', verifiedAt: guardian.heartbeatAt,
          verifiedOwner: guardian.owner, previousGuardianPid: activeGuardian.guardianPid,
          previousHostPid: activeGuardian.hostPid, hostStopSignal: activeHostStop?.signal ?? null,
          guardianPid: guardian.guardianPid ?? null, hostPid: guardian.pid ?? null,
          bootId: hostBootId(guardian),
        } : {
          status: 'scheduled', delayMs: handoffDelayMs, verifiedAt: guardian.heartbeatAt, verifiedOwner: guardian.owner,
        },
      }
    } catch (error) {
      const recovery = await rollback()
      if (error?.code === 'GUARDIAN_BOOTSTRAP_UNVERIFIED') throw Object.assign(error, { recovery })
      throw Object.assign(new Error(activeGuardian
        ? 'Guardian 主动升级未能完成，已尝试恢复上一版守护并重新接管同一 Profile。'
        : 'Guardian 未能完成启动验证，已恢复守护文件；当前 Host 未被关闭。'), {
        code: 'GUARDIAN_BOOTSTRAP_UNVERIFIED', causeCode: error?.code ?? null, recovery,
      })
    }
  }

  return { status, requestRestart, createInstallPlan, executeInstall }
}
