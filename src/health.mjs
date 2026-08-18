import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readProfileInventory, resolveProfileDirectory, validateProfileName } from './inventory.mjs'
import { readManagedDisabledIds } from './managed-patch.mjs'
import { inspectColdStartContract } from './cold-start.mjs'

const PERMISSION_FIELDS = ['files', 'network', 'commands', 'credentials']
const DECISION_FIELDS = [...PERMISSION_FIELDS, 'acceptUnknown']
const PERMISSION_DECISION_SCHEMA_VERSION = 1
const check = (id, status, message, details = null) => ({ id, status, message, details })

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function permissionRequested(field, value) {
  return field === 'credentials'
    ? Array.isArray(value) && value.some(item => item !== 'none')
    : value !== 'none'
}

function canonicalJson(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function permissionDecisionRevision(plugin, catalogEntry) {
  const identity = {
    schemaVersion: PERMISSION_DECISION_SCHEMA_VERSION,
    packageName: plugin.packageName,
    installed: {
      version: plugin.version ?? null,
      source: plugin.source ?? null,
      declaredSpecifier: plugin.declaredSpecifier ?? null,
    },
    catalog: catalogEntry ? {
      id: catalogEntry.id ?? null,
      packageName: catalogEntry.packageName ?? null,
      commit: catalogEntry.commit ?? null,
      version: catalogEntry.version ?? null,
    } : null,
    declaredPermissions: catalogEntry?.details?.permissions ?? null,
  }
  return createHash('sha256').update(canonicalJson(identity)).digest('hex')
}

function acceptedDecisionValues(value, revision) {
  const record = safeObject(value)
  if (record.schemaVersion !== PERMISSION_DECISION_SCHEMA_VERSION || record.revision !== revision) return {}
  const raw = safeObject(record.decisions)
  return Object.fromEntries(DECISION_FIELDS
    .filter(field => typeof raw[field] === 'boolean')
    .map(field => [field, raw[field]]))
}

function permissionReport(plugin, catalogEntry, decisionRecord) {
  if (plugin.official) {
    return {
      status: 'official', decision: 'official-host-trust', requested: null,
      decisionRevision: null,
      approved: [], pending: [], denied: [],
      message: '官方组件由 DSH 宿主信任边界管理，本商城不替用户重新授权。',
    }
  }
  const decisionRevision = permissionDecisionRevision(plugin, catalogEntry)
  const decisions = acceptedDecisionValues(decisionRecord, decisionRevision)
  const declared = catalogEntry?.details?.permissions
  if (!declared) {
    const accepted = decisions.acceptUnknown === true
    const denied = decisions.acceptUnknown === false
    return {
      status: accepted ? 'accepted-unknown' : denied ? 'denied' : 'unknown',
      decision: accepted ? 'accepted' : denied ? 'denied' : 'review-required', requested: null,
      decisionRevision,
      approved: [], pending: accepted || denied ? [] : ['unknown'], denied: denied ? ['unknown'] : [],
      message: accepted
        ? '用户已明确接受该目录外插件的未知权限边界。'
        : denied ? '用户拒绝该目录外插件的未知权限边界。'
          : '目录外插件没有可核验的权限声明，必须由用户明确决定是否接受未知权限。',
    }
  }
  const requested = {
    level: declared.level, files: declared.files, network: declared.network,
    commands: declared.commands, credentials: declared.credentials,
  }
  const approved = []
  const pending = []
  const denied = []
  for (const field of PERMISSION_FIELDS) {
    if (!permissionRequested(field, declared[field])) continue
    if (decisions[field] === true) approved.push(field)
    else if (decisions[field] === false) denied.push(field)
    else pending.push(field)
  }
  const status = denied.length > 0 ? 'denied' : pending.length > 0 ? 'review-required' : 'accepted'
  return {
    status, decision: status, requested, decisionRevision, approved, pending, denied,
    message: status === 'accepted' ? '用户已逐项接受该插件声明的权限。'
      : status === 'denied' ? `用户拒绝权限：${denied.join('、')}`
        : `等待用户选择权限：${pending.join('、')}`,
  }
}

function pluginStatus(checks) {
  if (checks.some(item => item.status === 'error')) return 'unhealthy'
  if (checks.some(item => item.status === 'denied')) return 'blocked-by-user'
  if (checks.some(item => item.status === 'action-required')) return 'action-required'
  if (checks.some(item => item.status === 'warning' || item.status === 'unverified')) return 'warning'
  return 'healthy'
}

function buildPluginReport(plugin, catalogEntry, decisionRecord) {
  const checks = []
  checks.push(plugin.installed
    ? check('installation', 'pass', `已解析本地 manifest，版本 ${plugin.version || '未知'}`)
    : check('installation', 'error', 'Profile 已声明该包，但本地 manifest 无法解析'))
  checks.push(plugin.declaredAsBundle
    ? check('bundle-registration', 'pass', '已列入当前 Profile 的 Bundle 顺序')
    : check('bundle-registration', 'warning', '仅作为依赖存在，未列入当前 Profile 的 Bundle 顺序'))

  if (plugin.official) {
    checks.push(check('source', 'pass', '官方 @deepseek-ai 组件；商城保持只读'))
  } else if (!catalogEntry) {
    checks.push(check('source', 'unverified', '目录外安装，无法核验固定 Commit、许可证与安装契约'))
  } else {
    const sourceMatched = plugin.source === 'git' && typeof plugin.declaredSpecifier === 'string'
      && plugin.declaredSpecifier.includes(catalogEntry.commit)
    checks.push(check('source', sourceMatched ? 'pass' : 'warning', sourceMatched
      ? `安装来源匹配目录固定 Commit ${catalogEntry.commit.slice(0, 12)}`
      : `安装来源为 ${plugin.source}，未证明与目录固定 Commit 一致`, {
      catalogCommit: catalogEntry.commit, declaredSpecifier: plugin.declaredSpecifier,
    }))
    checks.push(check('version', plugin.version === catalogEntry.version ? 'pass' : 'warning',
      plugin.version === catalogEntry.version
        ? `本地版本与目录版本一致：${catalogEntry.version}`
        : `本地版本 ${plugin.version || '未知'}，目录版本 ${catalogEntry.version}`))
    checks.push(catalogEntry.risk.installScripts.length === 0
      ? check('lifecycle-scripts', 'pass', '目录未声明安装生命周期脚本')
      : check('lifecycle-scripts', 'warning', `包含安装生命周期脚本：${catalogEntry.risk.installScripts.join('、')}`))
  }

  const permissions = permissionReport(plugin, catalogEntry, decisionRecord)
  const permissionStatus = permissions.status === 'denied' ? 'denied'
    : ['review-required', 'unknown'].includes(permissions.status) ? 'action-required'
      : permissions.status === 'official' ? 'unverified' : 'pass'
  checks.push(check('permissions', permissionStatus, permissions.message, permissions))
  checks.push(check('runtime', 'unverified', '当前只能证明 Web 管理进程响应；尚无该插件独立 Fiber/业务功能探针'))

  return {
    packageName: plugin.packageName, version: plugin.version, official: plugin.official,
    catalogId: catalogEntry?.id ?? null, catalogName: catalogEntry?.name ?? null,
    source: plugin.source, declaredSpecifier: plugin.declaredSpecifier,
    declaredAsBundle: plugin.declaredAsBundle, status: pluginStatus(checks), permissions, checks,
  }
}

export async function checkProfileHealth(options = {}) {
  const profile = validateProfileName(options.profile ?? 'web')
  const inventory = options.inventory ?? await readProfileInventory({ dshHome: options.dshHome, profile })
  const catalogEntries = Array.isArray(options.catalog?.entries) ? options.catalog.entries : []
  const catalogByPackage = new Map(catalogEntries.map(entry => [entry.packageName, entry]))
  const decisions = safeObject(options.permissionDecisions)
  const checks = []
  checks.push(inventory.diagnostics.length > 0
    ? check('inventory', 'error', '插件清单包含诊断错误', { diagnostics: inventory.diagnostics })
    : check('inventory', 'pass', `已解析 ${inventory.plugins.length} 个 Profile 条目`))
  const missing = inventory.plugins.filter(plugin => !plugin.installed)
  checks.push(missing.length === 0
    ? check('dependencies', 'pass', '所有 Profile 声明依赖均可解析')
    : check('dependencies', 'error', `${missing.length} 个声明依赖无法解析`, { packages: missing.map(item => item.packageName) }))

  let disabledEntryIds = []
  try {
    const patch = await readFile(join(resolveProfileDirectory(options.dshHome, profile), 'cordis.patch.yml'), 'utf8')
    disabledEntryIds = readManagedDisabledIds(patch)
    checks.push(check('managed-patch', 'pass', `管理器 Patch 可安全解析；托管停用条目 ${disabledEntryIds.length} 个`))
  } catch (error) {
    if (error?.code === 'ENOENT') checks.push(check('managed-patch', 'warning', 'Profile 没有用户 Patch 文件'))
    else checks.push(check('managed-patch', 'error', '管理器 Patch 区块无法安全解析'))
  }
  if (options.runner?.dumpConfig) {
    const composition = await options.runner.dumpConfig(profile)
    checks.push(composition.ok ? check('config-composition', 'pass', 'DSH 配置合成通过')
      : check('config-composition', 'error', composition.timedOut ? 'DSH 配置合成超时' : 'DSH 配置合成失败', { exitCode: composition.exitCode }))
  } else checks.push(check('config-composition', 'unverified', '未配置 DSH 命令执行器'))

  const coldStart = await inspectColdStartContract({ dshHome: options.dshHome, profile, inventory })
  checks.push(check('cold-start-entry-ids', coldStart.status, coldStart.message,
    coldStart.collisions.length > 0 ? { collisions: coldStart.collisions } : null))

  const plugins = inventory.plugins.map(plugin => buildPluginReport(
    plugin, catalogByPackage.get(plugin.packageName), safeObject(decisions[plugin.packageName]),
  ))
  const summary = {
    total: plugins.length,
    healthy: plugins.filter(item => item.status === 'healthy').length,
    warning: plugins.filter(item => item.status === 'warning').length,
    unhealthy: plugins.filter(item => item.status === 'unhealthy').length,
    actionRequired: plugins.filter(item => item.status === 'action-required').length,
    blockedByUser: plugins.filter(item => item.status === 'blocked-by-user').length,
    catalogued: plugins.filter(item => item.catalogId !== null).length,
    uncatalogued: plugins.filter(item => !item.official && item.catalogId === null).length,
  }
  const status = checks.some(item => item.status === 'error') || summary.unhealthy > 0 ? 'unhealthy'
    : summary.blockedByUser > 0 ? 'blocked-by-user'
      : summary.actionRequired > 0 ? 'action-required'
        : checks.some(item => ['warning', 'unverified'].includes(item.status)) || summary.warning > 0 ? 'warning' : 'healthy'
  return {
    schemaVersion: 2, generatedAt: new Date().toISOString(), profile, status,
    verdict: status === 'healthy'
      ? '当前已执行的检查未发现问题；这不是插件业务功能或安全性的完整证明。'
      : '不能直接判定通过，请查看逐插件证据并完成权限选择。',
    runtime: 'current-web-process-responsive',
    permissionModel: 'revision-bound-browser-local-user-review-only-not-runtime-enforcement',
    disabledEntryIds, summary, checks, plugins,
  }
}
