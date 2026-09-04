import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadCatalogFromFiles } from '../src/catalog.mjs'

const statusLabels = {
  approved: '可安装',
  blocked: '不可安装（blocked）',
  unlisted: '已下架（unlisted）',
}

const DETAIL_ROW_LIMIT = 20

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

function visibleRows(value) {
  return array(value).slice(0, DETAIL_ROW_LIMIT)
}

function appendOmittedRows(lines, total, shown) {
  const omitted = Math.max(0, total - shown)
  if (omitted > 0) {
    lines.push(`> 另有 ${omitted} 条未展开，完整记录见本次 Run Artifact 中的机器报告。`, '')
  }
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
  authorNotices = null,
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
  const candidateSurfaces = array(watchdog?.candidateSurfaces)
  const passedCandidateSurfaces = candidateSurfaces.filter(surface => surface?.status === 'passed').length
  const approvedAdded = addedEntries.filter(item => byId.get(item.id)?.status === 'approved').length
  const blockedAdded = addedEntries.filter(item => byId.get(item.id)?.status !== 'approved').length
  const statisticsAvailable = report !== null
    && report?.status !== 'failed'
    && report?.completed !== false
    && report?.statisticsAvailable !== false
  const overallPassed = catalogConclusion === 'success' && statisticsAvailable
    && watchdog?.status === 'passed' && repairTriggered !== true
  const icon = overallPassed ? '✅' : '⚠️'
  const observedAt = report?.observedAt ?? watchdog?.checkedAt ?? '未知'
  const postCatalogEntries = report?.postconditions?.catalogEntries ?? catalogEntries.length
  const partialCheckedEntries = Number.isSafeInteger(sourceChecks.checkedEntries) && sourceChecks.checkedEntries > 0
    ? sourceChecks.checkedEntries
    : null
  const authorNoticeMatches = authorNotices !== null
    && (String(authorNotices.sourceCatalogRunId ?? '') === String(catalogRunId ?? '')
      || (authorNotices.sourceCatalogRunId == null && authorNotices.observedAt === report?.observedAt))
  const authorSummary = authorNoticeMatches ? authorNotices.summary ?? null : null
  const authorStatisticsAvailable = authorSummary !== null
  const candidateCoverageAvailable = authorSummary?.candidateCoverageInvariantPassed === true
    && number(authorSummary.candidateCoverageUnaccounted) === 0
  const title = statisticsAvailable
    ? `DSH STORE 自动更新报告：新增 ${addedEntries.length}，历史更新 ${updatedEntries.length}，兼容性下架 ${compatibilityUnlisted.length}，恢复 ${compatibilityRestored.length}`
    : 'DSH STORE 自动更新报告：本轮扫描失败，统计不可用'

  const lines = [
    '<!-- dsh-catalog-automation-notification -->',
    `## ${icon} ${title}`,
    '',
  ]
  if (mention) lines.push(mention, '')
  lines.push(
    `- 综合结果：**${overallPassed ? '通过' : '需要关注'}**`,
    `- 扫描时间：${markdownCell(observedAt)}`,
  )
  if (statisticsAvailable) {
    lines.push(
      `- 历史 Catalog 检查：${number(sourceChecks.checkedEntries)} 个`,
      `- 新增收录：${addedEntries.length} 个（可安装 ${approvedAdded}，blocked/不可安装 ${blockedAdded}）`,
      `- 历史版本自动更新：${number(sourceChecks.catalogUpdates)} 个；同版本固定 Commit 更新：${number(sourceChecks.sameVersionCatalogUpdates)} 个`,
      `- 最新三个 DSH 兼容窗口：${array(compatibilityPolicy.latestReleases).map(code).join('、') || '未知'}`,
      `- 兼容性暂时下架：${compatibilityUnlisted.length} 个；恢复上架：${compatibilityRestored.length} 个`,
      `- 不兼容且已有其他失败的候选清理：${prunedCandidates.length} 个`,
      `- 发现上游高版本：${number(sourceChecks.newerVersionCandidates)} 个（自动更新 ${number(sourceChecks.catalogUpdates)}，暂缓 ${number(sourceChecks.newerVersionsDeferred)}）`,
      `- 上游源码变化但未提升版本：${number(sourceChecks.sourceChangedWithoutVersionBump)} 个（固定 Commit 已更新 ${number(sourceChecks.sameVersionCatalogUpdates)}，暂缓 ${number(sourceChecks.sameVersionUpdatesDeferred)}）`,
      `- 暂时无法解析：${number(sourceChecks.unresolvedEntries)} 个；临时基础设施失败：${transientFailures.length} 个`,
      `- 当前 Catalog 条目：${number(postCatalogEntries)} 个`,
    )
    if (authorStatisticsAvailable) {
      lines.push(
        `- 向不符合条件项目发送 GitHub 整改消息：${number(authorSummary.githubMessages)} 个项目`,
        `- 触发 GitHub 通知邮件：${number(authorSummary.githubNotificationEmailTriggers)} 个项目；实际送达：**无法验证**`,
        candidateCoverageAvailable
          ? `- 候选全量台账：${number(authorSummary.candidateCoverageAccounted)} / ${number(authorSummary.candidateRegistryRecords)} 条已归类，未覆盖 ${number(authorSummary.candidateCoverageUnaccounted)} 条`
          : '- 候选全量台账：**校验不可用，禁止按已覆盖解读**',
        `- 作者源码修改：仍未通过 ${number(authorSummary.upstreamModifiedStillBlocked)}，问题清除 ${number(authorSummary.upstreamModifiedResolved)}，未检测到新提交 ${number(authorSummary.noUpstreamModificationDetected)}，基线/未知 ${number(authorSummary.sourceTrackingBaselines) + number(authorSummary.sourceModificationUnknown)}`,
      )
    } else {
      lines.push('- 作者整改通知统计：**不可用（本轮没有匹配的作者通知计划，禁止按 0 解读）**')
    }
  } else {
    lines.push('- 扫描统计：**不可用（本轮未完成，禁止按 0 解读）**')
    if (partialCheckedEntries !== null) {
      lines.push(`- 失败前已检查历史 Catalog：至少 ${partialCheckedEntries} 个（部分进度，不是最终统计）`)
    }
    lines.push(
      `- 失败阶段：${markdownCell(report?.failure?.stage ?? '决策报告缺失或未完成')}`,
      `- 失败原因：${markdownCell(report?.failure?.message ?? 'Catalog 自动化没有产生完整的机器决策报告')}`,
      `- 当前 main Catalog 条目：${number(catalogEntries.length)} 个`,
    )
  }
  lines.push(
    `- Catalog 四个公开面核验：${passedSurfaces}/${surfaces.length || 4} 通过`,
    `- 候选库四个公开面核验：${passedCandidateSurfaces}/${candidateSurfaces.length || 4} 通过`,
    `- Catalog 工作流：${zhConclusion(catalogConclusion)}${catalogRunUrl ? ` · [Run #${markdownCell(catalogRunId)}](${catalogRunUrl})` : ''}`,
    `- 公开面核验工作流：${zhConclusion(watchdog?.status)}${watchdogRunUrl ? ` · [Run #${markdownCell(watchdogRunId)}](${watchdogRunUrl})` : ''}${repairTriggered ? ' · 已自动触发修复任务' : ''}`,
    `- 基准 Commit：${shortSha(report?.baseCommit)}`,
    '',
  )

  lines.push('### 新增收录清单', '')
  if (!statisticsAvailable) {
    lines.push('本轮扫描未完成，无法确认新增收录清单；请勿解读为 0。', '')
  } else if (addedEntries.length === 0) {
    lines.push('无新增收录。', '')
  } else {
    lines.push('| 中文名（英文名） | 版本 | 商城状态 | 原项目 | 说明 |', '|---|---:|---|---|---|')
    const rows = visibleRows(addedEntries)
    for (const item of rows) {
      const entry = byId.get(item.id)
      const reasons = array(item.reasons).join('；') || entry?.statusReason || '通过自动策略'
      lines.push(`| ${markdownCell(entryName(entry, item.id))} | ${markdownCell(entry?.version)} | ${markdownCell(statusLabels[entry?.status] ?? entry?.status)} | ${repositoryLink(entry)} | ${markdownCell(reasons)} |`)
    }
    lines.push('')
    appendOmittedRows(lines, addedEntries.length, rows.length)
  }

  lines.push('### 历史插件更新清单', '')
  if (!statisticsAvailable) {
    lines.push('本轮扫描未完成，无法确认历史插件更新清单；请勿解读为 0。', '')
  } else if (updatedEntries.length === 0) {
    lines.push('无历史插件版本更新。', '')
  } else {
    lines.push('| 中文名（英文名） | 变更类型 | 原版本 | 新版本 | 商城状态 | 原项目 |', '|---|---|---:|---:|---|---|')
    const rows = visibleRows(updatedEntries)
    for (const item of rows) {
      const entry = byId.get(item.id)
      const changeKind = item.changeKind === 'same-version-source-update' ? '同版本固定 Commit' : '版本更新'
      lines.push(`| ${markdownCell(entryName(entry, item.id))} | ${changeKind} | ${markdownCell(item.fromVersion)} | ${markdownCell(item.toVersion ?? item.version)} | ${markdownCell(statusLabels[entry?.status] ?? entry?.status)} | ${repositoryLink(entry)} |`)
    }
    lines.push('')
    appendOmittedRows(lines, updatedEntries.length, rows.length)
  }

  lines.push('### 发现高版本但暂缓更新', '')
  if (!statisticsAvailable) {
    lines.push('本轮扫描未完成，暂缓更新统计不可用。', '')
  } else if (higherVersionDeferred.length === 0) {
    lines.push('无暂缓更新项。', '')
  } else {
    lines.push('| 中文名（英文名） | Catalog 版本 | 上游版本 | 暂缓原因 |', '|---|---:|---:|---|')
    const rows = visibleRows(higherVersionDeferred)
    for (const item of rows) {
      const entry = byId.get(item.id)
      lines.push(`| ${markdownCell(entryName(entry, item.id))} | ${markdownCell(item.catalogVersion)} | ${markdownCell(item.upstreamVersion)} | ${markdownCell(item.reason ?? '证据不足，自动失败关闭')} |`)
    }
    lines.push('')
    appendOmittedRows(lines, higherVersionDeferred.length, rows.length)
  }

  lines.push('### 最新三个 DSH 版本兼容性变更', '')
  if (!statisticsAvailable) {
    lines.push('本轮扫描未完成，兼容性上下架统计不可用。', '')
  } else if (compatibilityUnlisted.length === 0 && compatibilityRestored.length === 0) {
    lines.push('无兼容性上下架变更。', '')
  } else {
    lines.push('| 变更 | 中文名（英文名） | 插件版本 | 原项目 | 要求窗口 |', '|---|---|---:|---|---|')
    const changes = [
      ...compatibilityUnlisted.map(item => ({ item, label: '暂时下架并转入候选' })),
      ...compatibilityRestored.map(item => ({ item, label: '恢复上架' })),
    ]
    const rows = visibleRows(changes)
    for (const { item, label } of rows) {
      const entry = byId.get(item.id)
      lines.push(`| ${label} | ${markdownCell(entryName(entry, item.id))} | ${markdownCell(entry?.version ?? item.version)} | ${repositoryLink(entry)} | ${markdownCell(array(item.requiredDshReleases).join(', '))} |`)
    }
    lines.push('')
    appendOmittedRows(lines, changes.length, rows.length)
  }

  lines.push('### 已清理的不兼容失败候选', '')
  if (!statisticsAvailable) {
    lines.push('本轮扫描未完成，候选清理统计不可用。', '')
  } else if (prunedCandidates.length === 0) {
    lines.push('无候选清理。', '')
  } else {
    lines.push('| 候选 | 固定 Commit | 原项目 | 清理原因 |', '|---|---|---|---|')
    const rows = visibleRows(prunedCandidates)
    for (const item of rows) {
      const repositoryUrl = item.repositoryUrl
      const repository = typeof repositoryUrl === 'string' && /^https:\/\/github\.com\//.test(repositoryUrl)
        ? `[原项目](${repositoryUrl})`
        : '未知'
      lines.push(`| ${markdownCell(item.name ?? item.id)} | ${shortSha(item.commit)} | ${repository} | ${markdownCell(item.reason)} |`)
    }
    lines.push('')
    appendOmittedRows(lines, prunedCandidates.length, rows.length)
  }

  lines.push('### 作者整改通知与修改跟踪', '')
  if (!authorStatisticsAvailable) {
    lines.push('本轮没有匹配的作者通知计划，GitHub 消息、GitHub 通知邮件触发和作者修改统计均不可用；请勿解读为 0。', '')
  } else {
    lines.push(
      `- 需要整改的 canonical 项目：${number(authorSummary.desiredRepositories)} 个`,
      `- 本轮已发送 GitHub 整改消息：${number(authorSummary.githubMessages)} 个项目`,
      `- 本轮已触发 GitHub 通知邮件：${number(authorSummary.githubNotificationEmailTriggers)} 个项目`,
      `- 邮件实际送达：**未验证**。是否进入收件箱取决于被提及维护者的 GitHub 通知和邮箱设置，仓库没有读取私人邮箱回执。`,
      candidateCoverageAvailable
        ? `- Candidate Registry 全量覆盖：${number(authorSummary.candidateCoverageAccounted)} / ${number(authorSummary.candidateRegistryRecords)} 条，canonical 仓库 ${number(authorSummary.candidateRegistryRepositories)} 个，未覆盖 ${number(authorSummary.candidateCoverageUnaccounted)} 条。`
        : '- Candidate Registry 全量覆盖：**校验不可用，禁止按已覆盖解读**。',
      `- 符合一次性直接整改通知的候选：${number(authorSummary.candidateDirectNotificationEligible)} 个（已有修复单 ${number(authorSummary.candidateDirectManagedIssues)}，本轮安排 ${number(authorSummary.candidateDirectScheduledThisRun)}，待限速发送 ${number(authorSummary.candidateDirectQueued)}）。`,
      `- 仅在[公开候选库](https://github.com/AI-Scarlett/DSH-Store/blob/main/registry/candidates.json)展示、不主动 @ 的候选：${number(authorSummary.candidatePublicRegistryOnly)} 个（待复检 ${number(authorSummary.candidatePublicReviewing)}，公开整改原因 ${number(authorSummary.candidatePublicRemediation)}，基础设施暂缓 ${number(authorSummary.candidatePublicDeferred)}，发现记录 ${number(authorSummary.candidatePublicDiscoveryOnly)}）。`,
      '- 公开展示不等于向作者发送消息；直接通知只用于具体、确定性的上架整改，不发送纯推广内容，也不去第三方仓库批量开 Issue。',
      `- 检测到上游修改但仍未通过：${number(authorSummary.upstreamModifiedStillBlocked)} 个项目`,
      `- 检测到上游修改且阻断清除：${number(authorSummary.upstreamModifiedResolved)} 个项目`,
      `- 未检测到上游新提交：${number(authorSummary.noUpstreamModificationDetected)} 个项目`,
      `- 首次建立源码追踪基线：${number(authorSummary.sourceTrackingBaselines)} 个项目；暂无法判断：${number(authorSummary.sourceModificationUnknown)} 个项目`,
      `- 阻断清除但未检测到源码变化：${number(authorSummary.resolvedWithoutDetectedSourceChange)} 个项目`,
      '',
    )
    const visibleActions = array(authorNotices.actions).filter(action => action.type !== 'baseline')
    if (visibleActions.length > 0) {
      const actionLabels = {
        create: '新建修复单', update: '原因变化并提醒', notify: '补发提醒',
        'source-update': '检测到新提交但仍未通过', close: '阻断清除并关闭',
      }
      const sourceLabels = {
        'new-baseline': '新通知并建立基线', 'modified-still-blocked': '已修改但仍未通过',
        'not-modified': '未检测到新提交', 'modified-and-resolved': '已修改且问题清除',
        'resolved-without-source-change': '问题清除但未检测到源码变化',
        'resolved-source-unknown': '问题清除，修改状态未知', 'tracking-baseline': '首次建立基线', unknown: '暂无法判断',
      }
      lines.push('| 项目 | 本轮动作 | 作者源码状态 |', '|---|---|---|')
      const rows = visibleRows(visibleActions)
      for (const action of rows) {
        const url = `https://github.com/${action.key}`
        lines.push(`| [${markdownCell(action.key)}](${url}) | ${markdownCell(actionLabels[action.type] ?? action.type)} | ${markdownCell(sourceLabels[action.sourceStatus] ?? action.sourceStatus)} |`)
      }
      lines.push('')
      appendOmittedRows(lines, visibleActions.length, rows.length)
    } else {
      lines.push('本轮没有需要新发或更新的作者整改消息。', '')
    }
  }

  if (surfaces.length > 0) {
    lines.push('### Catalog 公开面核验', '', '| 地址 | 状态 | 条目数 | SHA-256 |', '|---|---|---:|---|')
    const rows = visibleRows(surfaces)
    for (const surface of rows) {
      const url = typeof surface?.url === 'string' ? surface.url : '#'
      lines.push(`| [${markdownCell(url)}](${url}) | ${markdownCell(zhConclusion(surface?.status))} | ${number(surface?.entries)} | ${shortSha(surface?.sha256)} |`)
    }
    lines.push('')
    appendOmittedRows(lines, surfaces.length, rows.length)
  }

  if (candidateSurfaces.length > 0) {
    lines.push('### Candidate Registry 公开面核验', '', '| 地址 | 状态 | 候选数 | SHA-256 |', '|---|---|---:|---|')
    const rows = visibleRows(candidateSurfaces)
    for (const surface of rows) {
      const url = typeof surface?.url === 'string' ? surface.url : '#'
      lines.push(`| [${markdownCell(url)}](${url}) | ${markdownCell(zhConclusion(surface?.status))} | ${number(surface?.entries)} | ${shortSha(surface?.sha256)} |`)
    }
    lines.push('')
    appendOmittedRows(lines, candidateSurfaces.length, rows.length)
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
  const [catalogRoot, report, watchdog, authorNotices] = await Promise.all([
    readJson(options.catalog),
    readJson(options.report, true),
    readJson(options['watchdog-report'], true),
    readJson(options['author-notice-plan'], true),
  ])
  const catalog = catalogRoot?.registry?.indexPath
    ? await loadCatalogFromFiles({ indexUrl: pathToFileURL(resolve(options.catalog)) })
    : catalogRoot
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
    authorNotices,
  })
  await writeFile(resolve(options.output), body, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main()
}
