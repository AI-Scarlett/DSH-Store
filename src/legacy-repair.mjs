import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  access, appendFile, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const LEGACY_REPAIR_PACKAGE = 'dsh-safe-plugin-manager'
export const LEGACY_REPAIR_REPOSITORY = 'https://github.com/AI-Scarlett/DSH-Store'
export const LEGACY_REPAIR_ERROR = 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED'
export const LEGACY_REPAIR_MIN_VERSION = '0.8.5'
export const LEGACY_REPAIR_PROFILE_FILES = Object.freeze([
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml',
])

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const COMMIT_SHA = /^[0-9a-f]{40}$/
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const LIFECYCLE_SCRIPTS = Object.freeze(['preinstall', 'install', 'postinstall', 'prepare'])
const PLAN_TTL_MS = 10 * 60_000
const TARGET_MANIFEST_MAX_BYTES = 256 * 1024
const LOCAL_JSON_MAX_BYTES = 2 * 1024 * 1024

function repairError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra })
}

function parseVersion(value) {
  const match = VERSION.exec(String(value ?? ''))
  return match ? {
    value: String(value),
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  } : null
}

export function compareRepairVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  for (let index = 0; index < a.numbers.length; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function validateProfileName(value) {
  if (!PROFILE_NAME.test(value ?? '')) throw repairError('REPAIR_PROFILE_INVALID', 'Profile 名称无效。')
  return value
}

function validateTarget(input = {}) {
  const repositoryUrl = input.repositoryUrl ?? LEGACY_REPAIR_REPOSITORY
  if (repositoryUrl !== LEGACY_REPAIR_REPOSITORY) {
    throw repairError('REPAIR_SOURCE_INVALID', '修复器只允许使用 DSH STORE 官方 GitHub 仓库。')
  }
  const commit = String(input.commit ?? '').toLowerCase()
  if (!COMMIT_SHA.test(commit)) throw repairError('REPAIR_COMMIT_INVALID', '目标必须是完整的 40 位 Git Commit。')
  const version = String(input.version ?? '')
  if (!parseVersion(version)) throw repairError('REPAIR_VERSION_INVALID', '目标商城版本无效。')
  return { repositoryUrl, commit, version }
}

export function legacyRepairSpecifier(commit) {
  if (!COMMIT_SHA.test(commit ?? '')) throw repairError('REPAIR_COMMIT_INVALID', '目标必须是完整的 40 位 Git Commit。')
  return `git+${LEGACY_REPAIR_REPOSITORY}.git#${commit}`
}

function profileDirectory(dshHome, profile) {
  if (!isAbsolute(dshHome)) throw repairError('REPAIR_HOME_INVALID', 'DSH_HOME 必须是绝对路径。')
  const root = resolve(dshHome, 'profiles')
  const target = resolve(root, validateProfileName(profile))
  const scoped = relative(root, target)
  if (!scoped || scoped.startsWith('..') || isAbsolute(scoped)) throw repairError('REPAIR_PROFILE_INVALID', 'Profile 路径越界。')
  return target
}

async function readBounded(path, maximum = LOCAL_JSON_MAX_BYTES) {
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size > maximum) throw repairError('REPAIR_FILE_INVALID', `文件大小或类型不受支持：${path}`)
  return readFile(path)
}

async function readJson(path, maximum = LOCAL_JSON_MAX_BYTES) {
  let bytes
  try { bytes = await readBounded(path, maximum) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  try { return JSON.parse(bytes.toString('utf8')) } catch {
    throw repairError('REPAIR_JSON_INVALID', `JSON 文件无效：${path}`)
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function fileRecord(directory, name, includeContent = false) {
  const path = join(directory, name)
  try {
    const bytes = await readBounded(path, 8 * 1024 * 1024)
    return { relative: name, exists: true, sha256: sha256(bytes), size: bytes.length, ...(includeContent ? { bytes } : {}) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { relative: name, exists: false, sha256: null, size: 0, ...(includeContent ? { bytes: null } : {}) }
    throw error
  }
}

async function captureProfile(directory, includeContent = false) {
  return Promise.all(LEGACY_REPAIR_PROFILE_FILES.map(name => fileRecord(directory, name, includeContent)))
}

function recordsMatch(left, right) {
  return left.length === right.length && left.every((item, index) => {
    const candidate = right[index]
    return item.relative === candidate.relative && item.exists === candidate.exists && item.sha256 === candidate.sha256
  })
}

function packageDirectory(profileDir, packageName) {
  const root = resolve(profileDir, 'node_modules')
  const target = resolve(root, ...packageName.split('/'))
  const scoped = relative(root, target)
  if (!scoped || scoped.startsWith('..') || isAbsolute(scoped)) throw repairError('REPAIR_PACKAGE_PATH_INVALID', '插件包路径越界。')
  return target
}

function lifecycleScripts(manifest) {
  return LIFECYCLE_SCRIPTS.filter(name => typeof manifest?.scripts?.[name] === 'string' && manifest.scripts[name].trim() !== '')
}

async function installedManifest(profileDir, packageName) {
  return readJson(join(packageDirectory(profileDir, packageName), 'package.json'))
}

async function inspectLifecycleBlockers(profileDir, dependencies) {
  const results = []
  for (const [packageName, specifier] of Object.entries(dependencies ?? {})) {
    if (!/(?:^github:|^git\+https:\/\/github\.com\/)/i.test(String(specifier))) continue
    const manifest = await installedManifest(profileDir, packageName)
    if (!manifest) continue
    const scripts = lifecycleScripts(manifest)
    if (scripts.length > 0) results.push({ packageName, version: manifest.version ?? null, scripts })
  }
  return results.sort((left, right) => left.packageName.localeCompare(right.packageName, 'en'))
}

async function fetchTargetManifest(target, request = globalThis.fetch, timeoutMs = 12_000) {
  if (typeof request !== 'function') throw repairError('REPAIR_NETWORK_UNAVAILABLE', '当前 Node.js 无法访问官方固定源码。')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const url = `https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/${target.commit}/package.json`
  try {
    const response = await request(url, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-store-legacy-repair' },
      signal: controller.signal,
    })
    if (!response.ok) throw repairError('REPAIR_SOURCE_UNAVAILABLE', `官方固定源码返回 HTTP ${response.status}。`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > TARGET_MANIFEST_MAX_BYTES) throw repairError('REPAIR_SOURCE_INVALID', '官方固定 manifest 超过大小限制。')
    let manifest
    try { manifest = JSON.parse(bytes.toString('utf8')) } catch { throw repairError('REPAIR_SOURCE_INVALID', '官方固定 manifest 不是有效 JSON。') }
    if (manifest?.name !== LEGACY_REPAIR_PACKAGE || manifest?.version !== target.version) {
      throw repairError('REPAIR_SOURCE_MISMATCH', '官方固定 manifest 的包名或版本与修复目标不一致。')
    }
    if (manifest?.dsh?.bundle?.patch !== './cordis.patch.yml') {
      throw repairError('REPAIR_SOURCE_MISMATCH', '官方固定 manifest 缺少标准 DSH Bundle Patch。')
    }
    if (lifecycleScripts(manifest).length > 0) {
      throw repairError('REPAIR_TARGET_HAS_SCRIPTS', '目标商城包含生命周期脚本，安全修复器拒绝执行。')
    }
    if (manifest?.bin?.['dsh-store-repair'] !== './bin/dsh-store-repair.mjs') {
      throw repairError('REPAIR_SOURCE_MISMATCH', '目标商城未声明固定的官方修复器入口。')
    }
    return { url, sha256: sha256(bytes), manifest }
  } catch (error) {
    if (error?.name === 'AbortError') throw repairError('REPAIR_SOURCE_TIMEOUT', '读取官方固定源码超时。')
    if (error?.code) throw error
    throw repairError('REPAIR_NETWORK_FAILED', '读取官方固定源码失败。')
  } finally {
    clearTimeout(timer)
  }
}

async function resolveExecutable(name, environment = process.env, platform = process.platform) {
  const candidates = String(environment.PATH ?? '').split(delimiter).filter(Boolean)
  const filenames = platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name]
  for (const directory of candidates) {
    if (!isAbsolute(directory)) continue
    for (const filename of filenames) {
      const path = join(directory, filename)
      try {
        await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
        return path
      } catch { /* continue */ }
    }
  }
  throw repairError('REPAIR_DSH_CLI_NOT_FOUND', 'PATH 中未找到官方 dsh CLI。')
}

function boundedOutput(value) {
  return String(value ?? '').slice(-16_384)
}

async function execResult(file, args, options = {}) {
  return new Promise(resolveResult => {
    execFile(file, args, {
      cwd: options.cwd, env: options.env, timeout: options.timeoutMs ?? 180_000,
      maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    }, (error, stdout, stderr) => resolveResult({
      ok: !error, exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
      stdout: boundedOutput(stdout), stderr: boundedOutput(stderr),
    }))
  })
}

async function defaultRunner(dshHome, profileDir, environment) {
  const dsh = await resolveExecutable('dsh', environment)
  const env = { ...environment, DSH_HOME: dshHome }
  return {
    command: dsh,
    async plugin(profile, args) { return execResult(dsh, ['plugin', '--profile', profile, ...args], { cwd: profileDir, env }) },
    async dumpConfig(profile) { return execResult(dsh, ['--profile', profile, '--dump-config'], { cwd: profileDir, env, timeoutMs: 30_000 }) },
  }
}

async function atomicWrite(path, value, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, value, { mode })
  await rename(temporary, path)
}

async function atomicJson(path, value) {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeBackup(backupDir, profileDir, records, plan) {
  await mkdir(dirname(backupDir), { recursive: true, mode: 0o700 })
  await mkdir(backupDir, { recursive: false, mode: 0o700 })
  for (const record of records) {
    if (record.exists) await copyFile(join(profileDir, record.relative), join(backupDir, record.relative))
  }
  await atomicJson(join(backupDir, 'manifest.json'), {
    schemaVersion: 1, transactionId: plan.transactionId, createdAt: plan.createdAt,
    profile: plan.profile, packageName: LEGACY_REPAIR_PACKAGE,
    current: plan.current, target: plan.target,
    preconditions: records.map(({ bytes: _bytes, ...record }) => record),
  })
}

async function restoreBackup(profileDir, backupDir, records) {
  for (const record of records) {
    const target = join(profileDir, record.relative)
    if (!record.exists) {
      await rm(target, { force: true })
      continue
    }
    const source = join(backupDir, record.relative)
    const temporary = `${target}.${randomUUID()}.restore`
    await copyFile(source, temporary)
    await rename(temporary, target)
  }
}

function guardianPaths(dshHome) {
  const root = join(dshHome, 'dsh-safe-plugin-manager', 'guardian')
  return { root, status: join(root, 'status.json'), request: join(root, 'request.json'), pending: join(root, 'pending-recovery.json') }
}

function guardianIsUsable(value, profile, now) {
  const heartbeatAgeMs = now - Date.parse(value?.heartbeatAt)
  return value?.available === true && value?.owner === 'guardian' && value?.state === 'healthy'
    && value?.profile === profile && typeof value?.health?.bootId === 'string'
    && Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs >= 0 && heartbeatAgeMs <= 15_000
}

async function readGuardian(dshHome, profile, now) {
  const value = await readJson(guardianPaths(dshHome).status, 256 * 1024)
  return guardianIsUsable(value, profile, now) ? {
    available: true, pid: value.pid, heartbeatAt: value.heartbeatAt, bootId: value.health.bootId,
  } : { available: false, pid: null, heartbeatAt: value?.heartbeatAt ?? null, bootId: value?.health?.bootId ?? null }
}

async function requestGuardianRestart(dshHome, plan) {
  const location = guardianPaths(dshHome)
  const request = {
    schemaVersion: 1, requestId: randomUUID(), type: 'restart', profile: plan.profile,
    oldPid: plan.guardian.pid, previousBootId: plan.guardian.bootId,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  await atomicJson(location.request, request)
  return request
}

async function waitForGuardianResult(dshHome, plan, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000
  const intervalMs = options.intervalMs ?? 1_000
  const now = options.now ?? Date.now
  const delay = options.delay ?? (milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds)))
  const deadline = now() + timeoutMs
  const location = guardianPaths(dshHome)
  while (now() <= deadline) {
    const status = await readJson(location.status, 256 * 1024)
    if (status?.state === 'rolled-back' && status?.recovery?.transactionId === plan.transactionId) {
      return { status: 'rolled-back', guardian: status }
    }
    const bootId = status?.health?.bootId
    if (status?.available === true && status?.owner === 'guardian' && status?.state === 'healthy'
      && status?.profile === plan.profile && typeof bootId === 'string' && bootId !== plan.guardian.bootId
      && Number(status.stableForMs) >= 30_000) {
      return { status: 'verified', guardian: status }
    }
    await delay(intervalMs)
  }
  return { status: 'timeout', guardian: await readJson(location.status, 256 * 1024) }
}

function publicPlan(plan) {
  const { privateData: _privateData, ...value } = plan
  return value
}

function commandFailure(result) {
  const output = `${result?.stderr ?? ''}\n${result?.stdout ?? ''}`
  const pnpmCode = output.match(/\b(ERR_PNPM_[A-Z0-9_]+)\b/)?.[1] ?? null
  return repairError('REPAIR_DSH_COMMAND_FAILED', '官方 DSH 插件命令执行失败。', {
    exitCode: result?.exitCode ?? null, diagnostic: pnpmCode,
  })
}

export function createLegacyRepairService(options = {}) {
  const dshHome = resolve(options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  const request = options.fetch ?? globalThis.fetch
  const currentTime = options.now ?? Date.now
  const createId = options.randomUUID ?? randomUUID
  const plans = new Map()

  async function createPlan(input = {}) {
    const profile = validateProfileName(input.profile ?? 'web')
    const target = validateTarget(input.target)
    const profileDir = profileDirectory(dshHome, profile)
    const packageManifest = await readJson(join(profileDir, 'package.json'))
    if (!packageManifest || typeof packageManifest !== 'object' || Array.isArray(packageManifest)) {
      throw repairError('REPAIR_PROFILE_MANIFEST_MISSING', '目标 Profile 缺少有效 package.json。')
    }
    const declaredSpecifier = packageManifest.dependencies?.[LEGACY_REPAIR_PACKAGE]
      ?? packageManifest.devDependencies?.[LEGACY_REPAIR_PACKAGE]
    if (typeof declaredSpecifier !== 'string') throw repairError('REPAIR_MANAGER_NOT_INSTALLED', '目标 Profile 未安装 DSH STORE。')
    const installed = await installedManifest(profileDir, LEGACY_REPAIR_PACKAGE)
    const currentVersion = installed?.version
    if (!parseVersion(currentVersion)) throw repairError('REPAIR_INSTALLED_VERSION_INVALID', '无法确认当前商城版本。')
    if ((compareRepairVersions(currentVersion, LEGACY_REPAIR_MIN_VERSION) ?? -1) < 0) {
      throw repairError('REPAIR_VERSION_UNSUPPORTED', `安全修复器只处理 ${LEGACY_REPAIR_MIN_VERSION} 及以上历史商城。`)
    }
    if ((compareRepairVersions(currentVersion, target.version) ?? 1) >= 0) {
      throw repairError('REPAIR_NOT_REQUIRED', '当前商城版本不低于修复目标，无需执行历史修复。')
    }
    const sourceVerification = await fetchTargetManifest(target, request, options.sourceTimeoutMs)
    const blockers = await inspectLifecycleBlockers(profileDir, packageManifest.dependencies)
    const preconditions = await captureProfile(profileDir)
    const guardian = await readGuardian(dshHome, profile, currentTime())
    const runner = options.runner ?? await defaultRunner(dshHome, profileDir, options.environment ?? process.env)
    const transactionId = createId()
    const createdAt = new Date(currentTime()).toISOString()
    const backupDir = join(dshHome, 'backups', `dsh-store-legacy-repair-${profile}-${transactionId}`)
    const plan = {
      schemaVersion: 1, planId: createId(), transactionId, action: 'legacy-safe-update', profile,
      createdAt, expiresAt: new Date(currentTime() + (options.planTtlMs ?? PLAN_TTL_MS)).toISOString(),
      confirmation: `REPAIR DSH STORE ${profile} ${target.version} ${target.commit.slice(0, 7)}`,
      current: { version: currentVersion, declaredSpecifier }, target,
      sourceVerification: { manifestUrl: sourceVerification.url, manifestSha256: sourceVerification.sha256 },
      detectedLifecyclePackages: blockers,
      guardian,
      impact: {
        command: { file: runner.command ?? options.command ?? 'injected-dsh-runner', args: ['plugin', '--profile', profile, 'add', '--ignore-scripts', legacyRepairSpecifier(target.commit)] },
        lifecyclePolicy: 'ignore-all-scripts',
        mayModify: [...LEGACY_REPAIR_PROFILE_FILES, 'node_modules', 'dsh.profile.bundles'],
        neverModify: ['DeepSeek Harness source', '@deepseek-ai/* packages', 'other Profiles'],
        backupDirectory: backupDir,
        restart: guardian.available ? 'guardian-verified' : 'manual-required',
      },
      preconditions,
      privateData: { profileDir, backupDir, runner },
    }
    plans.set(plan.planId, plan)
    return publicPlan(plan)
  }

  async function execute(input = {}) {
    const plan = plans.get(input.planId)
    if (!plan) throw repairError('REPAIR_PLAN_NOT_FOUND', '修复计划不存在或已使用。')
    plans.delete(input.planId)
    if (currentTime() > Date.parse(plan.expiresAt)) throw repairError('REPAIR_PLAN_EXPIRED', '修复计划已过期。')
    if (input.confirmation !== plan.confirmation) throw repairError('REPAIR_CONFIRMATION_MISMATCH', '修复确认语不匹配。')
    const { profileDir, backupDir, runner } = plan.privateData
    const stateDir = join(dshHome, 'dsh-safe-plugin-manager')
    await mkdir(stateDir, { recursive: true, mode: 0o700 })
    const lockPath = join(stateDir, `legacy-repair-${plan.profile}.lock`)
    let lock
    let backupWritten = false
    let packageMayHaveChanged = false
    try {
      try { lock = await open(lockPath, 'wx', 0o600) } catch (error) {
        if (error?.code === 'EEXIST') throw repairError('REPAIR_BUSY', '另一个商城修复事务正在运行。')
        throw error
      }
      await lock.writeFile(`${JSON.stringify({ transactionId: plan.transactionId, createdAt: plan.createdAt })}\n`)
      const actual = await captureProfile(profileDir)
      if (!recordsMatch(plan.preconditions, actual)) throw repairError('REPAIR_PRECONDITION_CHANGED', 'Profile 在确认后发生变化，修复已取消。')
      const backupRecords = await captureProfile(profileDir, true)
      await writeBackup(backupDir, profileDir, backupRecords, plan)
      backupWritten = true
      const result = await runner.plugin(plan.profile, ['add', '--ignore-scripts', legacyRepairSpecifier(plan.target.commit)])
      packageMayHaveChanged = result.ok || result.exitCode !== 127
      if (!result.ok) throw commandFailure(result)
      const configured = await runner.dumpConfig(plan.profile)
      if (!configured.ok) throw repairError('REPAIR_CONFIG_FAILED', '更新后 DSH 配置无法合成。', { exitCode: configured.exitCode ?? null })
      const packageManifest = await readJson(join(profileDir, 'package.json'))
      const declared = packageManifest?.dependencies?.[LEGACY_REPAIR_PACKAGE]
        ?? packageManifest?.devDependencies?.[LEGACY_REPAIR_PACKAGE]
      const installed = await installedManifest(profileDir, LEGACY_REPAIR_PACKAGE)
      if (!String(declared ?? '').includes(plan.target.commit) || installed?.version !== plan.target.version) {
        throw repairError('REPAIR_POSTCONDITION_FAILED', '更新后的商城版本或固定 Commit 与计划不一致。')
      }
      const patchPath = installed?.dsh?.bundle?.patch
      const packageRoot = packageDirectory(profileDir, LEGACY_REPAIR_PACKAGE)
      const resolvedPatch = typeof patchPath === 'string' ? resolve(packageRoot, patchPath) : null
      const patchScope = resolvedPatch ? relative(packageRoot, resolvedPatch) : null
      if (!resolvedPatch || !patchScope || patchScope.startsWith('..') || isAbsolute(patchScope)) {
        throw repairError('REPAIR_POSTCONDITION_FAILED', '更新后的 DSH Bundle manifest 无效。')
      }
      try { await access(resolvedPatch, constants.R_OK) } catch { throw repairError('REPAIR_POSTCONDITION_FAILED', '更新后的 DSH Bundle Patch 不可读取。') }
      const postconditions = await captureProfile(profileDir)
      const auditBase = {
        schemaVersion: 1, transactionId: plan.transactionId, action: plan.action, profile: plan.profile,
        packageName: LEGACY_REPAIR_PACKAGE, fromVersion: plan.current.version, targetVersion: plan.target.version,
        targetCommit: plan.target.commit, lifecyclePolicy: 'ignore-all-scripts', at: new Date(currentTime()).toISOString(),
      }
      if (!plan.guardian.available) {
        const value = { ...auditBase, status: 'applied-restart-required', backupDir }
        await appendFile(join(stateDir, 'history.jsonl'), `${JSON.stringify(value)}\n`, { mode: 0o600 })
        return value
      }
      const liveGuardian = await readGuardian(dshHome, plan.profile, currentTime())
      if (!liveGuardian.available || liveGuardian.bootId !== plan.guardian.bootId || liveGuardian.pid !== plan.guardian.pid) {
        const value = { ...auditBase, status: 'applied-restart-required', backupDir, guardianChangedAfterPlan: true }
        await appendFile(join(stateDir, 'history.jsonl'), `${JSON.stringify(value)}\n`, { mode: 0o600 })
        return value
      }
      const location = guardianPaths(dshHome)
      await atomicJson(location.pending, {
        schemaVersion: 1, transactionId: plan.transactionId, profile: plan.profile,
        packageName: LEGACY_REPAIR_PACKAGE, backupDir,
        preconditions: plan.preconditions, postconditions,
        authorizedByConfirmation: plan.confirmation, createdAt: new Date(currentTime()).toISOString(),
      })
      const restartRequest = await requestGuardianRestart(dshHome, plan)
      const restart = await waitForGuardianResult(dshHome, plan, {
        timeoutMs: options.restartTimeoutMs, intervalMs: options.restartPollMs,
        now: currentTime, delay: options.delay,
      })
      const status = restart.status === 'verified' ? 'applied-runtime-verified'
        : restart.status === 'rolled-back' ? 'rolled-back-by-guardian' : 'applied-restart-unverified'
      const value = { ...auditBase, status, backupDir, guardianRequestId: restartRequest.requestId, restart: restart.status }
      await appendFile(join(stateDir, 'history.jsonl'), `${JSON.stringify(value)}\n`, { mode: 0o600 })
      return value
    } catch (error) {
      let rollback = 'not-required'
      let dependencyRestore = 'not-required'
      if (backupWritten) {
        try {
          await restoreBackup(profileDir, backupDir, plan.preconditions)
          rollback = 'profile-restored'
          if (packageMayHaveChanged) {
            const restore = await runner.plugin(plan.profile, ['install', '--offline', '--ignore-scripts'])
            dependencyRestore = restore.ok ? 'succeeded' : 'failed'
          }
          const restored = await captureProfile(profileDir)
          if (!recordsMatch(plan.preconditions, restored)) rollback = 'failed'
        } catch { rollback = 'failed' }
      }
      const value = {
        schemaVersion: 1, transactionId: plan.transactionId, status: 'rolled-back', action: plan.action,
        profile: plan.profile, packageName: LEGACY_REPAIR_PACKAGE,
        error: { code: error?.code ?? 'REPAIR_FAILED', message: String(error?.message ?? error), diagnostic: error?.diagnostic ?? null },
        rollback, dependencyRestore, backupDir: backupWritten ? backupDir : null,
      }
      await appendFile(join(stateDir, 'history.jsonl'), `${JSON.stringify({ ...value, at: new Date(currentTime()).toISOString() })}\n`, { mode: 0o600 })
      return value
    } finally {
      await lock?.close().catch(() => {})
      await rm(lockPath, { force: true }).catch(() => {})
    }
  }

  return { createPlan, execute }
}
