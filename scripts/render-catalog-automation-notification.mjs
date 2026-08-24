import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const statusLabels = {
  approved: '可安装',
  blocked: '不可安装（blocked）',
  unlisted: '已下架（unlisted）',
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
    options[name.slice(2)] = value
    index += 1
  }
  return options
}

function markdownCell(value) {
  return String(value ?? '未知').replace(/\r?\n/g, ' ').replaceAll('|', '\\|')
}

function code(value) {
  return `\`${String(value ?? 'unknown').replaceAll('`', '')}\``
}

function shortSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40,64}$/.test(value) ? code(value.slice(0, 12)) : '未知'
}

function repositoryLink(entry) {
  const url = entry?.repositoryUrl
  return typeof url === 'string' && /^https:\/\/github\.com\//.test(url) ? `[原项目](${url})` : '未知'
}

function entryName(entry, id) {
  return entry?.name ?? code(id)
}

function array(value) {
  return Array.isArray(value) ? value : []
}

function number(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function zhConclusion(value) {
  if (value === 'success' || value === 'passed') return '通过'
  if (value === 'failure' || value === 'failed') return '失败'
  if (value === 'cancelled') return '已取消'
  return '未知'
}

export function renderCatalogAutomationNotification({
  catalog,
  report = null,
  watchdog = null,
  catalogRunId = null,
  catalogRunUrl = null,
  catalogConclusion = null,
  watchdogRunId = null,
  watchdogRunUrl = null,
  repairTriggered = false,
  mention = null,
}) {
  const catalogEntries = array(catalog?.entries)
  const byId = new Map(catalogEntries.map(entry => [entry.id, entry]))
  const addedEntries = array(report?.addedEntries)
  const updatedEntries = array(report?.updatedEntries)
  const compatibilityUnlisted = array(report?.compatibilityUnlisted)
  const compatibilityRestored = array(report?.compatibilityRestored)
  const compatibilityPolicy = report?.compatibilityPolicy ?? {}
  const prunedCandidates = array(report?.prunedCandidates)
  const deferredUpdates = array(report?.deferredUpdates)
  const higherVersionDeferred = deferredUpdates.filter(item => typeof item?.upstreamVersion === 'string')
  const transientFailures = array(report?.transientFailures)
  const sourceChecks = report?.sourceVersionChecks ?? {}
  const surfaces = array(watchdog?.surfaces)
  const passedSurfaces = surfaces.filter(surface => surface?.status === 'passed').length
  const approvedAdded = addedEntries.filter(item => byId.get(item.id)?.status === 'approved').length
  const blockedAdded = addedEntries.filter(item => byId.get(item.id)?.status !== 'approved').length
  const overallPassed = catalogConclusion === 'success' && report !== null && watchdog?.status === 'passed' && repairTriggered !== true
  const icon = overallPassed ? '✅' : '⚠️'
  const observedAt = report?.observedAt ?? watchdog?.checkedAt ?? '未知'
  const postCatalogEntries = report?.postconditions?.catalogEntries ?? catalogEntries.length

  const lines = [
    '<!-- dsh-catalog-automation-notification -->',
    `## ${icon} DSH STORE 自动更新报告：新增 ${addedEntries.length}，历史更新 ${updatedEntries.length}，兼容性下架 ${compatibilityUnlisted.length}，恢复 ${compatibilityRestored.length}`,
    '',
  ]
  if (mention) lines.push(mention, '')
  lines.push(
    `- 综合结果：**${overallPassed ? '通过' : '需要关注'}**`,
    `- 扫描时间：${markdownCell(observedAt)}`,
    `- 历史 Catalog 检查：${number(sourceChecks.checkedEntries)} 个`,
    `- 新增收录：${addedEntries.length} 个（可安装 ${approvedAdded}，blocked/不可安装 ${blockedAdded}）`,
    `- 历史版本自动更新：${updatedEntries.length} 个`,
    `- 最新三个 DSH 兼容窗口：${array(compatibilityPolicy.latestReleases).map(code).join('、') || '未知'}`,
    `- 兼容性暂时下架：${compatibilityUnlisted.length} 个；恢复上架：${compatibilityRestored.length} 个`,
    `- 不兼容且已有其他失败的候选清理：${prunedCandidates.length} 个`,
    `- 发现上游高版本：${number(sourceChecks.newerVersionCandidates)} 个（自动更新 ${number(sourceChecks.catalogUpdates)}，暂缓 ${number(sourceChecks.newerVersionsDeferred)}）`,
    `- 上游源码变化但未提升版本：${number(sourceChecks.sourceChangedWithoutVersionBump)} 个`,
    `- 暂时无法解析：${number(sourceChecks.unresolvedEntries)} 个；临时基础设施失败：${transientFailures.length} 个`,
    `- 当前 Catalog 条目：${number(postCatalogEntries)} 个`,
    `- 四个公开面核验：${passedSurfaces}/${surfaces.length || 4} 通过`,
    `- Catalog 工作流：${zhConclusion(catalogConclusion)}${catalogRunUrl ? ` · [Run #${markdownCell(catalogRunId)}](${catalogRunUrl})` : ''}`,
    `- 看门狗工作流：${zhConclusion(watchdog?.status)}${watchdogRunUrl ? ` · [Run #${markdownCell(watchdogRunId)}](${watchdogRunUrl})` : ''}${repairTriggered ? ' · 已自动触发修复任务' : ''}`,
    `- 基准 Commit：${shortSha(report?.baseCommit)}`,
    '',
  )

  lines.push('### 新增收录清单', '')
  if (addedEntries.length === 0) {
    lines.push('无新增收录。', '')
  } else {
    lines.push('| 中文名（英文名） | 版本 | 商城状态 | 原项目 | 说明 |', '|---|---:|---|---|---|')
    for (const item of addedEntries) {
      const entry = byId.get(item.id)
      const reasons = array(item.reasons).join('；') || entry?.statusReason || '通过自动策略'
      lines.push(`| ${markdownCell(entryName(entry, item.id))} | ${markdownCell(entry?.version)} | ${markdownCell(statusLabels[entry?.status] ?? entry?.status)} | ${repositoryLink(entry)} | ${markdownCell(reasons)} |`)
    }
    lines.push('')
  }

  lines.push('### 历史插件更新清单', '')
  if (updatedEntries.length === 0) {
    lines.push('无历史插件版本更新。', '')
  } else {
    lines.push('| 中文名（英文名） | 原版本 | 新版本 | 商城状态 | 原项目 |', '|---|---:|---:|---|---|')
    for (const item of updatedEntries) {
      const entry = byId.get(item.id)
      lines.push(`| ${markdownCell(entryName(entry, item.id))} | ${markdownCell(item.fromVersion)} | ${markdownCell(item.toVersion ?? item.version)} | ${markdownCell(statusLabels[entry?.status] ?? entry?.status)} | ${repositoryLink(entry)} |`)
    }
    lines.push('')
  }

  lines.push('### 发现高版本但暂缓更新', '')
  if (higherVersionDeferred.length === 0) {
    lines.push('无暂缓更新项。', '')
  } else {
    lines.push('| 中文名（英文名） | Catalog 版本 | 上游版本 | 暂缓原因 |', '|---|---:|---:|---|')
    for (const item of higherVersionDeferred) {
      const entry = byId.get(item.id)
      lines.push(`| ${markdownCell(entryName(entry, item.id))} | ${markdownCell(item.catalogVersion)} | ${markdownCell(item.upstreamVersion)} | ${markdownCell(item.reason ?? '证据不足，自动失败关闭')} |`)
    }
    lines.push('')
  }

  lines.push('### 最新三个 DSH 版本兼容性变更', '')
  if (compatibilityUnlisted.length === 0 && compatibilityRestored.length === 0) {
    lines.push('无兼容性上下架变更。', '')
  } else {
    lines.push('| 变更 | 中文名（英文名） | 插件版本 | 原项目 | 要求窗口 |', '|---|---|---:|---|---|')
    for (const item of compatibilityUnlisted) {
      const entry = byId.get(item.id)
      lines.push(`| 暂时下架并转入候选 | ${markdownCell(entryName(entry, item.id))} | ${markdownCell(entry?.version ?? item.version)} | ${repositoryLink(entry)} | ${markdownCell(array(item.requiredDshReleases).join(', '))} |`)
    }
    for (const item of compatibilityRestored) {
      const entry = byId.get(item.id)
      lines.push(`| 恢复上架 | ${markdownCell(entryName(entry, item.id))} | ${markdownCell(entry?.version ?? item.version)} | ${repositoryLink(entry)} | ${markdownCell(array(item.requiredDshReleases).join(', '))} |`)
    }
    lines.push('')
  }

  lines.push('### 已清理的不兼容失败候选', '')
  if (prunedCandidates.length === 0) {
    lines.push('无候选清理。', '')
  } else {
    lines.push('| 候选 | 固定 Commit | 原项目 | 清理原因 |', '|---|---|---|---|')
    for (const item of prunedCandidates) {
      const repositoryUrl = item.repositoryUrl
      const repository = typeof repositoryUrl === 'string' && /^https:\/\/github\.com\//.test(repositoryUrl)
        ? `[原项目](${repositoryUrl})`
        : '未知'
      lines.push(`| ${markdownCell(item.name ?? item.id)} | ${shortSha(item.commit)} | ${repository} | ${markdownCell(item.reason)} |`)
    }
    lines.push('')
  }

  if (surfaces.length > 0) {
    lines.push('### 公开面核验', '', '| 地址 | 状态 | 条目数 | SHA-256 |', '|---|---|---:|---|')
    for (const surface of surfaces) {
      const url = typeof surface?.url === 'string' ? surface.url : '#'
      lines.push(`| [${markdownCell(url)}](${url}) | ${markdownCell(zhConclusion(surface?.status))} | ${number(surface?.entries)} | ${shortSha(surface?.sha256)} |`)
    }
    lines.push('')
  }

  lines.push(
    '> 状态边界：本报告只证明 GitHub Catalog 固定源检查、自动策略 PR 和公开商城目录核验；不表示插件已安装到真实 DSH Profile，也不表示插件运行时已验收或经过独立安全审计。',
    '',
  )
  return `${lines.join('\n')}\n`
}

async function readJson(path, optional = false) {
  if (!path && optional) return null
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'))
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null
    throw error
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.catalog || !options.output) throw new Error('--catalog and --output are required')
  const [catalog, report, watchdog] = await Promise.all([
    readJson(options.catalog),
    readJson(options.report, true),
    readJson(options['watchdog-report'], true),
  ])
  const body = renderCatalogAutomationNotification({
    catalog,
    report,
    watchdog,
    catalogRunId: options['catalog-run-id'] ?? null,
    catalogRunUrl: options['catalog-run-url'] ?? null,
    catalogConclusion: options['catalog-conclusion'] ?? null,
    watchdogRunId: options['watchdog-run-id'] ?? null,
    watchdogRunUrl: options['watchdog-run-url'] ?? null,
    repairTriggered: options['repair-triggered'] === 'true',
    mention: options.mention ?? null,
  })
  await writeFile(resolve(options.output), body, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main()
}
