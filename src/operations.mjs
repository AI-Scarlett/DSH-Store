import { createHash, randomUUID } from 'node:crypto'
import {
  appendFile, chmod, copyFile, mkdir, readFile, rename, rm, writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { buildMarketplaceSnapshot, githubInstallSpecifier, verifyCatalogEntry } from './catalog.mjs'
import { checkProfileHealth } from './health.mjs'
import { readProfileInventory, resolveProfileDirectory, validateProfileName } from './inventory.mjs'
import { readManagedDisabledIds, setManagedDisabled } from './managed-patch.mjs'

const ACTIONS = new Set(['install', 'update', 'uninstall', 'disable', 'enable'])
const PROFILE_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']
const CRITICAL_ENTRY_IDS = new Set([
  'loader', 'web-server', 'ui-settings-plugin-inventory', 'dsh-safe-plugin-manager',
])
const PLAN_TTL_MS = 5 * 60_000

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function fileState(profileDir, relative) {
  const path = join(profileDir, relative)
  try {
    const content = await readFile(path)
    return { relative, exists: true, sha256: digest(content), size: content.length }
  } catch (error) {
    if (error?.code === 'ENOENT') return { relative, exists: false, sha256: null, size: 0 }
    throw error
  }
}

async function capturePreconditions(profileDir) {
  return Promise.all(PROFILE_FILES.map(relative => fileState(profileDir, relative)))
}

async function verifyPreconditions(profileDir, expected) {
  const current = await capturePreconditions(profileDir)
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    const error = new Error('Profile changed after the operation plan was created')
    error.code = 'PRECONDITION_CHANGED'
    throw error
  }
}

function publicPlan(plan) {
  const { privateData: _privateData, ...value } = plan
  return value
}

function assertManageable(entry, installed, action) {
  if (!entry) throw Object.assign(new Error('plugin is not present in the GitHub registry'), { code: 'NOT_IN_REGISTRY' })
  if (entry.status === 'blocked') throw Object.assign(new Error(entry.statusReason), { code: 'REGISTRY_BLOCKED' })
  if (entry.status === 'unlisted' && ['install', 'update'].includes(action)) {
    throw Object.assign(new Error(entry.statusReason), { code: 'REGISTRY_UNLISTED' })
  }
  if (entry.packageName.startsWith('@deepseek-ai/') || installed?.official) {
    throw Object.assign(new Error('official DSH components are permanently read-only'), { code: 'OFFICIAL_PROTECTED' })
  }
  const selfUpdate = entry.packageName === 'dsh-safe-plugin-manager' && action === 'update'
  if (entry.packageName === 'dsh-safe-plugin-manager' && !selfUpdate) {
    throw Object.assign(new Error('the manager only allows self-update'), { code: 'SELF_PROTECTED' })
  }
  if (!selfUpdate && entry.entryIds.some(id => CRITICAL_ENTRY_IDS.has(id))) {
    throw Object.assign(new Error('plugin targets a protected DSH entry id'), { code: 'CRITICAL_ENTRY_PROTECTED' })
  }
}

async function readDisabled(profileDir) {
  try {
    return readManagedDisabledIds(await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function atomicWrite(path, content) {
  const temporary = `${path}.dsh-safe-plugin-manager-${randomUUID()}.tmp`
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, path)
}

async function updateDisabledPatch(profileDir, entryIds, disabled) {
  const path = join(profileDir, 'cordis.patch.yml')
  let current
  try {
    current = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    current = '[]\n'
  }
  const next = setManagedDisabled(current, entryIds, disabled)
  if (next !== current) await atomicWrite(path, next)
}

async function backupProfile(dshHome, profileDir, transactionId, preconditions) {
  const root = join(dshHome, 'dsh-safe-plugin-manager', 'backups', transactionId)
  await mkdir(root, { recursive: true, mode: 0o700 })
  for (const item of preconditions) {
    if (item.exists) {
      const destination = join(root, item.relative)
      await copyFile(join(profileDir, item.relative), destination)
      await chmod(destination, 0o600)
    }
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, transactionId, createdAt: new Date().toISOString(), files: preconditions,
  }, null, 2) + '\n', { mode: 0o600 })
  return root
}

async function restoreBackup(profileDir, backupDir, preconditions) {
  for (const item of preconditions) {
    const target = join(profileDir, item.relative)
    if (item.exists) await atomicWrite(target, await readFile(join(backupDir, item.relative)))
    else await rm(target, { force: true })
  }
}

async function appendAudit(dshHome, event) {
  const dir = join(dshHome, 'dsh-safe-plugin-manager')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await appendFile(join(dir, 'history.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 })
}

async function acquireLock(dshHome, profile) {
  const parent = join(dshHome, 'dsh-safe-plugin-manager', 'locks')
  const path = join(parent, `${profile}.lock`)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw Object.assign(new Error('another plugin operation is already running for this Profile'), { code: 'PROFILE_LOCKED' })
    }
    throw error
  }
  return async () => rm(path, { recursive: true, force: true })
}

function planImpact(action, entry) {
  const packageOperation = ['install', 'update', 'uninstall'].includes(action)
  return {
    mayModify: packageOperation
      ? ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'node_modules', 'dsh.profile.bundles']
      : ['cordis.patch.yml managed block'],
    neverModify: ['DeepSeek Harness source', '@deepseek-ai/* packages', 'other Profiles', 'managed-block external content'],
    restartRequired: packageOperation,
    installScripts: ['install', 'update'].includes(action) ? entry.risk.installScripts : [],
  }
}

export function createOperationService(options = {}) {
  const dshHome = options.dshHome
  const defaultProfile = validateProfileName(options.defaultProfile ?? 'web')
  const catalogService = options.catalogService
  const runner = options.runner
  const mutationsEnabled = options.mutationsEnabled === true
  const sourceVerifier = options.sourceVerifier ?? verifyCatalogEntry
  const telemetryClient = options.telemetryClient ?? { recordInstall: async () => ({ status: 'disabled' }) }
  const planTtlMs = options.planTtlMs ?? PLAN_TTL_MS
  const plans = new Map()

  async function createPlan(input = {}) {
    if (!mutationsEnabled) throw Object.assign(new Error('guarded write mode is disabled by configuration'), { code: 'MUTATIONS_DISABLED' })
    const action = typeof input.action === 'string' ? input.action : ''
    if (!ACTIONS.has(action)) throw Object.assign(new Error('unsupported operation action'), { code: 'INVALID_ACTION' })
    const profile = validateProfileName(input.profile ?? defaultProfile)
    const profileDir = resolveProfileDirectory(dshHome, profile)
    const inventory = await readProfileInventory({ dshHome, profile })
    const catalog = await catalogService.load()
    const entry = catalog.entries.find(item => item.id === input.pluginId) ?? null
    const installed = entry ? inventory.plugins.find(item => item.packageName === entry.packageName) ?? null : null
    assertManageable(entry, installed, action)
    if (action === 'install' && installed) throw Object.assign(new Error('plugin is already installed'), { code: 'ALREADY_INSTALLED' })
    if (action !== 'install' && !installed) throw Object.assign(new Error('plugin is not installed'), { code: 'NOT_INSTALLED' })
    if (action === 'update') {
      if (['link', 'file', 'workspace'].includes(installed.source)) {
        throw Object.assign(new Error('local development links cannot be replaced by the market'), { code: 'LOCAL_SOURCE_PROTECTED' })
      }
      const market = buildMarketplaceSnapshot(catalog, inventory)
      const state = market.entries.find(item => item.id === entry.id)
      if (!state?.updateAvailable) throw Object.assign(new Error('registry does not contain a newer version'), { code: 'NO_UPDATE' })
    }
    let sourceVerification = { status: 'not-required', verifiedAt: null }
    if (['install', 'update'].includes(action)) {
      try {
        sourceVerification = await sourceVerifier(entry)
      } catch {
        throw Object.assign(new Error('GitHub fixed-commit source verification failed'), { code: 'SOURCE_VERIFICATION_FAILED' })
      }
    }
    const disabledIds = new Set(await readDisabled(profileDir))
    if (action === 'disable' && entry.entryIds.every(id => disabledIds.has(id))) {
      throw Object.assign(new Error('plugin is already disabled by this manager'), { code: 'ALREADY_DISABLED' })
    }
    if (action === 'enable' && entry.entryIds.every(id => !disabledIds.has(id))) {
      throw Object.assign(new Error('plugin is not disabled by this manager'), { code: 'ALREADY_ENABLED' })
    }
    const planId = randomUUID()
    const createdAt = new Date()
    const preconditions = await capturePreconditions(profileDir)
    const confirmation = `${action.toUpperCase()} ${entry.packageName} ${profile}`
    const plan = {
      schemaVersion: 1,
      planId,
      action,
      profile,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + planTtlMs).toISOString(),
      plugin: {
        id: entry.id,
        packageName: entry.packageName,
        currentVersion: installed?.version ?? null,
        targetVersion: ['install', 'update'].includes(action) ? entry.version : null,
        repositoryUrl: entry.repositoryUrl,
        commit: entry.commit,
        entryIds: entry.entryIds,
      },
      confirmation,
      impact: planImpact(action, entry),
      sourceVerification,
      preconditions,
      privateData: { entry, profileDir },
    }
    plans.set(planId, plan)
    return publicPlan(plan)
  }

  async function execute(input = {}) {
    const plan = plans.get(input.planId)
    if (!plan) throw Object.assign(new Error('operation plan is missing or already used'), { code: 'PLAN_NOT_FOUND' })
    plans.delete(input.planId)
    if (Date.now() > Date.parse(plan.expiresAt)) throw Object.assign(new Error('operation plan expired'), { code: 'PLAN_EXPIRED' })
    if (input.confirmation !== plan.confirmation) throw Object.assign(new Error('confirmation text does not match the operation plan'), { code: 'CONFIRMATION_MISMATCH' })
    const transactionId = randomUUID()
    const release = await acquireLock(dshHome, plan.profile)
    let backupDir = null
    let packageCommandStarted = false
    try {
      await verifyPreconditions(plan.privateData.profileDir, plan.preconditions)
      backupDir = await backupProfile(dshHome, plan.privateData.profileDir, transactionId, plan.preconditions)
      const { action } = plan
      const { entry } = plan.privateData
      if (action === 'install' || action === 'update') {
        packageCommandStarted = true
        const result = await runner.plugin(plan.profile, ['add', githubInstallSpecifier(entry)])
        if (!result.ok) throw Object.assign(new Error('official DSH plugin command failed'), { code: 'DSH_PLUGIN_COMMAND_FAILED', exitCode: result.exitCode })
      } else if (action === 'uninstall') {
        packageCommandStarted = true
        const result = await runner.plugin(plan.profile, ['remove', entry.packageName])
        if (!result.ok) throw Object.assign(new Error('official DSH plugin command failed'), { code: 'DSH_PLUGIN_COMMAND_FAILED', exitCode: result.exitCode })
        await updateDisabledPatch(plan.privateData.profileDir, entry.entryIds, false)
      } else {
        await updateDisabledPatch(plan.privateData.profileDir, entry.entryIds, action === 'disable')
      }
      const health = await checkProfileHealth({ dshHome, profile: plan.profile, runner })
      if (health.status === 'unhealthy') throw Object.assign(new Error('post-operation health check failed'), { code: 'HEALTH_CHECK_FAILED' })
      const value = {
        schemaVersion: 1, transactionId, status: 'applied', action,
        profile: plan.profile, packageName: entry.packageName, backupId: transactionId,
        restartRequired: plan.impact.restartRequired, health,
      }
      if (action === 'install') value.installReceipt = await telemetryClient.recordInstall({ pluginId: entry.id, version: entry.version })
      await appendAudit(dshHome, { ...value, at: new Date().toISOString() })
      return value
    } catch (error) {
      let rollback = 'not-required'
      if (backupDir) {
        try {
          await restoreBackup(plan.privateData.profileDir, backupDir, plan.preconditions)
          if (packageCommandStarted) {
            const restoreInstall = await runner.plugin(plan.profile, ['install', '--offline'])
            if (!restoreInstall.ok) throw new Error('dependency restore command failed')
          }
          rollback = 'succeeded'
        } catch {
          rollback = 'failed'
        }
      }
      const value = {
        schemaVersion: 1, transactionId, status: 'rolled-back', action: plan.action,
        profile: plan.profile, packageName: plan.plugin.packageName, backupId: backupDir ? transactionId : null,
        error: { code: error?.code ?? 'OPERATION_FAILED', message: String(error?.message ?? error), exitCode: error?.exitCode ?? null },
        rollback,
      }
      await appendAudit(dshHome, { ...value, at: new Date().toISOString() })
      return value
    } finally {
      await release()
    }
  }

  return { createPlan, execute }
}
