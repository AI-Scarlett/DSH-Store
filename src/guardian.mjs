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
    backups: join(root, 'install-backups'),
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
  const handoffDelayMs = options.handoffDelayMs ?? 750
  const plans = new Map()
  const label = 'com.ai-scarlett.dsh-guardian'
  const launchAgentsDir = options.launchAgentsDir ?? join(homedir(), 'Library', 'LaunchAgents')
  const plistPath = join(launchAgentsDir, `${label}.plist`)
  const daemonSource = options.daemonSource ?? fileURLToPath(new URL('./guardian-daemon.mjs', import.meta.url))
  const launchctl = options.launchctl ?? '/bin/launchctl'
  const exec = options.execFile ?? ((file, args) => new Promise((resolve, reject) => execFile(file, args, error => error ? reject(error) : resolve())))

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
      const value = JSON.parse(await readFile(location.status, 'utf8'))
      const [sourceSha256, deployedSha256] = await Promise.all([fileDigest(daemonSource), fileDigest(location.daemon)])
      const daemonCurrent = sourceSha256 !== null && sourceSha256 === deployedSha256
      const heartbeatAgeMs = Math.max(0, currentTime() - Date.parse(value.heartbeatAt))
      const heartbeatFresh = Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs <= staleMs
      const owner = value.owner ?? (Number.isInteger(value.pid) ? 'guardian-legacy' : 'unknown')
      const guardianOwnsHost = guardianOwner(owner)
      const available = heartbeatFresh && guardianOwnsHost && value.available !== false && daemonCurrent
      const errorCode = available ? null : heartbeatFresh && !guardianOwnsHost
        ? 'GUARDIAN_NOT_OWNER'
        : !daemonCurrent ? 'GUARDIAN_VERSION_DRIFT' : value.errorCode ?? 'GUARDIAN_UNAVAILABLE'
      return {
        ...value, owner, heartbeatAgeMs, heartbeatFresh, available, errorCode,
        daemonCurrent, upgradeRequired: !daemonCurrent,
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
    const [daemonSourceSha256, daemonTargetSha256, configSha256, plistSha256] = await Promise.all([
      fileDigest(daemonSource), fileDigest(location.daemon), fileDigest(location.config), fileDigest(plistPath),
    ])
    const upgrading = daemonTargetSha256 !== null
    const plan = {
      schemaVersion: 1, planId, action: upgrading ? 'upgrade-guardian' : 'install-guardian', profile: input.profile ?? 'web',
      createdAt: new Date(currentTime()).toISOString(), expiresAt: new Date(currentTime() + 300_000).toISOString(),
      confirmation: `${upgrading ? 'UPDATE' : 'INSTALL'} DSH GUARDIAN ${input.profile ?? 'web'}`,
      preconditions: { plistSha256, daemonSourceSha256, daemonTargetSha256, configSha256 },
      impact: {
        writes: [join(location.root, 'guardian-daemon.mjs'), join(location.root, 'config.json'), plistPath],
        backupDirectory: join(location.backups, planId),
        replacesLaunchdJob: 'local.dsh.web', installsLaunchdJob: label,
        neverModifies: ['DeepSeek Harness source', '@deepseek-ai/* packages'],
      },
    }
    plans.set(planId, plan)
    return plan
  }

  async function waitForFreshGuardianHeartbeat(domain, minimumHeartbeatAt) {
    const attempts = Math.max(1, Math.ceil(bootstrapTimeoutMs / bootstrapPollMs) + 1)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await exec(launchctl, ['print', `${domain}/${label}`])
        const candidate = await status()
        const heartbeatAt = Date.parse(candidate.heartbeatAt)
        const verifiedOwner = guardianOwner(candidate.owner) || candidate.owner === 'external'
        if (candidate.daemonCurrent && candidate.heartbeatFresh && verifiedOwner
          && Number.isFinite(heartbeatAt) && heartbeatAt >= minimumHeartbeatAt) return candidate
      } catch { /* launchd may not publish the job immediately; retry within the bounded window. */ }
      if (attempt + 1 < attempts) await sleep(bootstrapPollMs)
    }
    throw Object.assign(new Error('Guardian 启动后未在限定时间内写入新的可验证心跳；当前 Host 未被关闭。'), {
      code: 'GUARDIAN_BOOTSTRAP_UNVERIFIED',
    })
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
    const existing = await status()
    if (existing.heartbeatFresh && guardianOwner(existing.owner)) {
      throw Object.assign(new Error('当前 Host 已由现有 Guardian 持有；为避免在请求中终止其子进程，拒绝就地替换守护进程。'), {
        code: 'GUARDIAN_ACTIVE_HANDOFF_REQUIRED',
      })
    }
    await mkdir(location.root, { recursive: true, mode: 0o700 })
    await mkdir(launchAgentsDir, { recursive: true, mode: 0o700 })
    const domain = `gui/${process.getuid()}`
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

    const rollback = async () => {
      const result = { attempted: true, restored: true, relaunchedPreviousGuardian: false }
      await exec(launchctl, ['bootout', `${domain}/${label}`]).catch(() => {})
      try {
        await restoreFile(location.daemon, original.daemon)
        await restoreFile(location.config, original.config)
        await restoreFile(plistPath, original.plist)
        if (original.plist !== null) {
          await exec(launchctl, ['bootstrap', domain, plistPath])
          result.relaunchedPreviousGuardian = true
        }
      } catch {
        result.restored = false
      }
      return result
    }

    try {
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
      const previousHeartbeatAt = Date.parse(existing.heartbeatAt)
      const bootstrapStartedAt = currentTime()
      await exec(launchctl, ['bootout', `${domain}/${label}`]).catch(() => {})
      await exec(launchctl, ['bootstrap', domain, plistPath])
      const guardian = await waitForFreshGuardianHeartbeat(domain, Math.max(bootstrapStartedAt, Number.isFinite(previousHeartbeatAt) ? previousHeartbeatAt + 1 : 0))
      schedule(() => { void exec(launchctl, ['bootout', `${domain}/local.dsh.web`]).catch(() => {}) }, handoffDelayMs)
      return {
        schemaVersion: 1, status: plan.action === 'upgrade-guardian' ? 'updated' : 'installed', label, profile: plan.profile, plistPath,
        handoff: { status: 'scheduled', delayMs: handoffDelayMs, verifiedAt: guardian.heartbeatAt, verifiedOwner: guardian.owner },
      }
    } catch (error) {
      const recovery = await rollback()
      if (error?.code === 'GUARDIAN_BOOTSTRAP_UNVERIFIED') throw Object.assign(error, { recovery })
      throw Object.assign(new Error('Guardian 未能完成启动验证，已恢复守护文件；当前 Host 未被关闭。'), {
        code: 'GUARDIAN_BOOTSTRAP_UNVERIFIED', recovery,
      })
    }
  }

  return { status, requestRestart, createInstallPlan, executeInstall }
}
