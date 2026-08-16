import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readProfileInventory, resolveProfileDirectory, validateProfileName } from './inventory.mjs'
import { readManagedDisabledIds } from './managed-patch.mjs'

function check(id, status, message, details = null) {
  return { id, status, message, details }
}

export async function checkProfileHealth(options = {}) {
  const profile = validateProfileName(options.profile ?? 'web')
  const inventory = options.inventory ?? await readProfileInventory({ dshHome: options.dshHome, profile })
  const checks = []
  if (inventory.diagnostics.length > 0) {
    checks.push(check('inventory', 'error', '插件清单包含诊断错误', { count: inventory.diagnostics.length }))
  } else {
    checks.push(check('inventory', 'pass', `已解析 ${inventory.plugins.length} 个条目`))
  }
  const missing = inventory.plugins.filter(plugin => !plugin.installed)
  checks.push(missing.length === 0
    ? check('dependencies', 'pass', '所有声明依赖均可解析')
    : check('dependencies', 'error', `${missing.length} 个声明依赖无法解析`, { packages: missing.map(item => item.packageName) }))

  let disabledEntryIds = []
  try {
    const profileDir = resolveProfileDirectory(options.dshHome, profile)
    const patch = await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8')
    disabledEntryIds = readManagedDisabledIds(patch)
    checks.push(check('managed-patch', 'pass', `托管停用条目 ${disabledEntryIds.length} 个`))
  } catch (error) {
    if (error?.code === 'ENOENT') checks.push(check('managed-patch', 'warning', 'Profile 没有用户 Patch 文件'))
    else checks.push(check('managed-patch', 'error', '管理器 Patch 区块无法安全解析'))
  }

  if (options.runner?.dumpConfig) {
    const composition = await options.runner.dumpConfig(profile)
    checks.push(composition.ok
      ? check('config-composition', 'pass', 'DSH 配置合成通过')
      : check('config-composition', 'error', composition.timedOut ? 'DSH 配置合成超时' : 'DSH 配置合成失败', {
        exitCode: composition.exitCode,
      }))
  } else {
    checks.push(check('config-composition', 'unverified', '未配置 DSH 命令执行器'))
  }

  const status = checks.some(item => item.status === 'error')
    ? 'unhealthy'
    : checks.some(item => item.status === 'warning' || item.status === 'unverified') ? 'warning' : 'healthy'
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profile,
    status,
    runtime: 'current-web-process-responsive',
    disabledEntryIds,
    checks,
  }
}
