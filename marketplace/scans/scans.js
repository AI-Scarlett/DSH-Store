const translations = {
  zh: {
    'a11y.skip': '跳到主要内容', 'nav.home': '首页', 'nav.plugins': '插件目录', 'nav.community': '社区与开发者', 'nav.scans': '扫描记录',
    'nav.standards': '收录标准', 'nav.build': '开发插件', 'nav.faq': '常见问题', 'nav.about': '关于我们', 'nav.guide': '使用说明', 'nav.submit': '提交插件',
    'hero.eyebrow': 'SCAN ARCHIVE / PUBLIC EVIDENCE', 'hero.status': '可复核', 'hero.title': '扫描有记录，结果有边界。',
    'hero.lead': '集中查看固定来源的手动全量基准，以及商城自动化扫描的近期运行与结果。扫描结论不等于上架、安装或运行验收。',
    'hero.noteTitle': '透明展示', 'hero.note': '缺失的报告明确标为不可用，不把未知数据伪装成 0。',
    'tabs.manual': '手动扫描', 'tabs.manualHint': '全量基准', 'tabs.automatic': '自动扫描', 'tabs.automaticHint': '近期运行',
    'state.loadingManual': '正在读取手动扫描记录…', 'state.loadingAutomatic': '正在读取近期自动扫描…', 'value.unknown': '未知时间',
    'state.manualError': '手动扫描汇总暂时无法读取。请稍后重试。', 'state.autoError': '自动扫描状态暂时无法读取。请稍后重试。',
    'manual.title': '手动全量基准扫描', 'manual.lead': '一次性固定来源快照；作为本轮发现扫描的基准，不代表已将结果写入商城。',
    'manual.complete': '完整扫描', 'manual.incomplete': '扫描未完成', 'manual.total': '固定源记录', 'manual.processed': '已处理仓库',
    'manual.bundles': '识别 DSH Bundle', 'manual.eligible': '静态门禁通过', 'manual.source': '固定扫描源', 'manual.commit': '源 Commit',
    'manual.storeBase': '商城基准 Commit', 'manual.dshLatest': '扫描时 DSH 最新三个版本',
    'manual.classification': '仓库分类结果', 'manual.classificationHint': '以下分类互斥，总数应等于本次来源仓库数。',
    'manual.blockers': '主要阻塞原因', 'manual.blockersHint': '同一仓库可命中多项原因，数字不可相加。',
    'manual.eligibleList': '通过静态门禁的插件', 'manual.eligibleHint': '仅表示固定 Commit 上的限定静态检查通过；不表示已收录或实际安装运行通过。',
    'manual.registryOverlap': '扫描时与当时目录的仓库重叠', 'manual.inCatalog': '已在 Catalog', 'manual.inCandidates': '已在 Candidate Registry', 'manual.inBoth': '两边都有',
    'manual.boundary': '本次是固定 Commit 上的来源准入扫描，不是 DSH 安装、运行、UI 或安全认证。3 个静态门禁通过项没有写入 Catalog/Candidate Registry。自动化未触发、未联系开发者，也未执行第三方代码。原始逐仓扫描明细和文件级发现未公开。',
    'manual.unknown': '未验证 / 延后', 'manual.review': '候选复核（不可安装）', 'manual.rejected': '硬门禁拒绝', 'manual.eligibleClass': '静态门禁通过',
    'manual.compatible': '兼容的 DSH 版本', 'manual.entryIds': '入口 ID', 'manual.package': '包', 'manual.version': '版本', 'manual.commitLink': '固定源码 Commit ↗',
    'blocker.no-exact-compatible-result-in-latest-three': '最新三个 DSH 版本无精确兼容结果',
    'blocker.node-compatibility-missing': '缺少 Node.js 兼容性声明', 'blocker.dsh-compatibility-range-missing': '缺少 DSH 兼容性范围',
    'blocker.manifest-repository-does-not-match': 'Manifest 仓库地址不一致', 'blocker.runtime-or-optional-dependencies-present': '存在运行时或可选依赖',
    'blocker.scan-catalog-id-collision': '扫描到 Catalog ID 冲突', 'blocker.scan-entry-id-collision': '扫描到入口 ID 冲突',
    'blocker.scan-package-collision': '扫描到包名冲突', 'blocker.install-lifecycle-scripts-present': '包含安装生命周期脚本',
    'blocker.no-dsh-bundle-patch': '缺少 DSH Bundle Patch',
    'auto.title': '近期自动 Catalog 扫描', 'auto.lead': '展示 Pages 构建时可读取的最近 8 次 Catalog 自动化运行。点击记录可查看 GitHub Actions 运行证据。',
    'auto.refresh': '数据随官网约每 3 小时重建更新；自动化报告按 GitHub Actions 保留策略保存。',
    'auto.empty': '目前没有可读取的自动扫描运行记录。', 'auto.emptyHint': '自动扫描记录将在官网下次构建时读取 GitHub Actions 更新。',
    'auto.run': '扫描运行', 'auto.schedule': '定时触发', 'auto.manualTrigger': '手动触发工作流', 'auto.otherTrigger': '自动化触发',
    'auto.success': '成功', 'auto.failure': '失败', 'auto.cancelled': '已取消', 'auto.skipped': '已跳过', 'auto.timedOut': '超时', 'auto.actionRequired': '需要处理', 'auto.neutral': '中性结果', 'auto.stale': '已过期', 'auto.running': '运行中', 'auto.unknown': '状态未知', 'auto.openRun': '查看运行 ↗',
    'auto.reportUnavailable': '扫描统计不可用：报告附件缺失或未生成。', 'auto.failedNoReport': '本次运行未成功，且没有可用统计报告；请在 GitHub Actions 查看日志。',
    'auto.metrics.checked': '检查条目', 'auto.metrics.added': '新增', 'auto.metrics.updated': '更新', 'auto.metrics.unlisted': '兼容下架', 'auto.metrics.restored': '兼容恢复',
    'auto.metrics.pruned': '候选清理', 'auto.metrics.deferred': '延后更新', 'auto.metrics.rejected': '拒绝候选', 'auto.metrics.failures': '临时失败',
    'auto.metrics.sameVersion': '同版本源码更新', 'auto.statsAvailable': '报告统计可用', 'auto.statsPending': '统计未验证',
    'footer.lead': '查看手动基准与自动扫描，不混淆发现、收录和运行验收。', 'footer.explore': '快速导航', 'footer.friends': '友情链接',
    'action.top': '回到顶部 ↑', 'footer.note': '公开汇总 · 固定来源 · 未执行第三方代码',
  },
  en: {
    'a11y.skip': 'Skip to main content', 'nav.home': 'Home', 'nav.plugins': 'Plugin catalog', 'nav.community': 'Community & creators', 'nav.scans': 'Scan history',
    'nav.standards': 'Listing standards', 'nav.build': 'Build plugins', 'nav.faq': 'FAQ', 'nav.about': 'About us', 'nav.guide': 'Usage guide', 'nav.submit': 'Submit plugin',
    'hero.eyebrow': 'SCAN ARCHIVE / PUBLIC EVIDENCE', 'hero.status': 'AUDITABLE', 'hero.title': 'Every scan recorded. Every result bounded.',
    'hero.lead': 'Review the fixed-source manual baseline and recent automated Catalog scans in one place. A scan result is not a listing, installation, or runtime acceptance.',
    'hero.noteTitle': 'Evidence first', 'hero.note': 'Missing reports stay unavailable; unknown values are never presented as zero.',
    'tabs.manual': 'Manual scan', 'tabs.manualHint': 'Full baseline', 'tabs.automatic': 'Automated scans', 'tabs.automaticHint': 'Recent runs',
    'state.loadingManual': 'Loading the manual scan record…', 'state.loadingAutomatic': 'Loading recent automated scans…', 'value.unknown': 'Unknown time',
    'state.manualError': 'The manual scan summary is temporarily unavailable.', 'state.autoError': 'Automated scan status is temporarily unavailable.',
    'manual.title': 'Full manual baseline scan', 'manual.lead': 'A one-time snapshot at a fixed source Commit. It establishes the discovery baseline; it did not write results to the Store.',
    'manual.complete': 'Complete scan', 'manual.incomplete': 'Incomplete scan', 'manual.total': 'Source records', 'manual.processed': 'Repositories processed',
    'manual.bundles': 'DSH Bundles identified', 'manual.eligible': 'Static gates passed', 'manual.source': 'Fixed scan source', 'manual.commit': 'Source Commit',
    'manual.storeBase': 'Store base Commit', 'manual.dshLatest': 'Latest three DSH versions at scan time',
    'manual.classification': 'Repository classifications', 'manual.classificationHint': 'These categories are mutually exclusive and sum to the scanned source repositories.',
    'manual.blockers': 'Most frequent blockers', 'manual.blockersHint': 'A repository may have multiple blockers; do not sum these counts.',
    'manual.eligibleList': 'Plugins that passed static gates', 'manual.eligibleHint': 'Only bounded static checks on a fixed Commit passed; this does not mean listed or runtime-tested.',
    'manual.registryOverlap': 'Registry overlap at scan time', 'manual.inCatalog': 'In Catalog', 'manual.inCandidates': 'In Candidate Registry', 'manual.inBoth': 'In both',
    'manual.boundary': 'This is a fixed-Commit source-admission scan, not DSH install, runtime, UI, or security certification. The three static-gate passes were not written to Catalog/Candidate Registry. No automation or outreach was triggered, and no third-party code was executed. Raw per-repository rows and file-level findings are not published.',
    'manual.unknown': 'Unverified / deferred', 'manual.review': 'Candidate review (non-installable)', 'manual.rejected': 'Hard-gate rejected', 'manual.eligibleClass': 'Static gates passed',
    'manual.compatible': 'Compatible DSH releases', 'manual.entryIds': 'Entry IDs', 'manual.package': 'Package', 'manual.version': 'Version', 'manual.commitLink': 'Pinned source Commit ↗',
    'blocker.no-exact-compatible-result-in-latest-three': 'No exact compatibility in latest three DSH releases',
    'blocker.node-compatibility-missing': 'Node.js compatibility undeclared', 'blocker.dsh-compatibility-range-missing': 'DSH compatibility range missing',
    'blocker.manifest-repository-does-not-match': 'Manifest repository mismatch', 'blocker.runtime-or-optional-dependencies-present': 'Runtime or optional dependencies present',
    'blocker.scan-catalog-id-collision': 'Catalog ID collision in scan', 'blocker.scan-entry-id-collision': 'Entry ID collision in scan',
    'blocker.scan-package-collision': 'Package-name collision in scan', 'blocker.install-lifecycle-scripts-present': 'Install lifecycle scripts present',
    'blocker.no-dsh-bundle-patch': 'DSH Bundle Patch missing',
    'auto.title': 'Recent automated Catalog scans', 'auto.lead': 'Shows up to the eight most recent Catalog automation runs available when Pages builds. Open a run for its GitHub Actions evidence.',
    'auto.refresh': 'The page is rebuilt about every three hours; reports follow GitHub Actions artifact retention.',
    'auto.empty': 'No automated scan runs are currently available.', 'auto.emptyHint': 'The next site build will refresh this view from GitHub Actions.',
    'auto.run': 'Scan run', 'auto.schedule': 'Scheduled', 'auto.manualTrigger': 'Workflow dispatch', 'auto.otherTrigger': 'Automated trigger',
    'auto.success': 'Succeeded', 'auto.failure': 'Failed', 'auto.cancelled': 'Cancelled', 'auto.skipped': 'Skipped', 'auto.timedOut': 'Timed out', 'auto.actionRequired': 'Action required', 'auto.neutral': 'Neutral', 'auto.stale': 'Stale', 'auto.running': 'Running', 'auto.unknown': 'Unknown status', 'auto.openRun': 'Open run ↗',
    'auto.reportUnavailable': 'Scan statistics unavailable: the report artifact is missing or was not produced.', 'auto.failedNoReport': 'This run did not succeed and no statistics report is available; inspect its GitHub Actions logs.',
    'auto.metrics.checked': 'Checked', 'auto.metrics.added': 'Added', 'auto.metrics.updated': 'Updated', 'auto.metrics.unlisted': 'Compatibility unlisted', 'auto.metrics.restored': 'Restored',
    'auto.metrics.pruned': 'Candidates pruned', 'auto.metrics.deferred': 'Deferred updates', 'auto.metrics.rejected': 'Rejected candidates', 'auto.metrics.failures': 'Transient failures',
    'auto.metrics.sameVersion': 'Same-version source updates', 'auto.statsAvailable': 'Report available', 'auto.statsPending': 'Stats unverified',
    'footer.lead': 'Manual baselines and automated scans, clearly separated from listing and runtime acceptance.', 'footer.explore': 'Explore', 'footer.friends': 'Friends',
    'action.top': 'Back to top ↑', 'footer.note': 'Public summary · Fixed sources · No third-party code executed',
  },
}

const blockerFallback = code => code.replaceAll('-', ' ')
const formatNumber = value => Number.isSafeInteger(value) ? value.toLocaleString(document.documentElement.lang || 'en') : '—'
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const validRepo = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
const validCommit = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
const validRunUrl = value => typeof value === 'string' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(value)
const storedLocale = (() => { try { return localStorage.getItem('dsh-marketplace-locale') } catch { return null } })()
const defaultLocale = document.documentElement.dataset.defaultLocale === 'en' ? 'en' : 'zh'
const state = { locale: storedLocale === 'en' || storedLocale === 'zh' ? storedLocale : defaultLocale, manual: null, automatic: null }
const t = key => translations[state.locale][key] || translations.zh[key] || key

function setLocale(locale) {
  state.locale = locale === 'en' ? 'en' : 'zh'
  try { localStorage.setItem('dsh-marketplace-locale', state.locale) } catch {}
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN'
  document.title = state.locale === 'en' ? 'Scan History | DSH STORE' : '扫描记录与结果 | DSH STORE'
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n) })
  document.querySelectorAll('[data-locale]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.locale === state.locale)))
  if (state.manual) renderManual(state.manual)
  if (state.automatic) renderAutomatic(state.automatic)
}

function dateLabel(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return t('value.unknown')
  return new Intl.DateTimeFormat(state.locale === 'en' ? 'en' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC'
}

function metric(label, value) {
  return `<article class="scan-metric"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong></article>`
}

function renderManual(data) {
  const target = document.querySelector('#manual-scan-content')
  if (!target) return
  const total = data?.source?.sourceCount
  const counts = data?.classificationCounts
  if (data?.schemaVersion !== 1 || !data.complete || !Number.isSafeInteger(total) || !counts
    || Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0)
    || Object.values(counts).reduce((sum, value) => sum + value, 0) !== total
    || !validRepo(data.source.repository) || !validCommit(data.source.commit) || !validCommit(data.storeBaseCommit)) {
    target.className = 'scan-state'
    target.textContent = t('state.manualError')
    return
  }
  const categories = [
    ['store-auto-eligible', t('manual.eligibleClass')],
    ['candidate-review-noninstallable', t('manual.review')],
    ['rejected-hard-gate', t('manual.rejected')],
    ['unverified-deferred', t('manual.unknown')],
  ]
  const classes = categories.map(([key, label]) => {
    const count = counts[key] ?? 0
    const width = total ? Math.max(count > 0 ? 0.35 : 0, count / total * 100) : 0
    return `<li class="scan-class-row"><span>${escapeHtml(label)}</span><span class="scan-track" aria-hidden="true"><i style="width:${width.toFixed(2)}%"></i></span><strong>${formatNumber(count)}</strong></li>`
  }).join('')
  const blockerRows = (data.blockerCountsMayOverlap || []).map(({ code, count }) => {
    const label = t(`blocker.${code}`) === `blocker.${code}` ? blockerFallback(code) : t(`blocker.${code}`)
    return `<li class="scan-blocker-row"><span>${escapeHtml(label)}</span><strong>${formatNumber(count)}</strong></li>`
  }).join('')
  const packageCards = (data.eligiblePackages || []).map(item => {
    if (!validRepo(item.repository) || !validCommit(item.commit)) return ''
    const repoUrl = `https://github.com/${encodeURIComponent(item.repository.split('/')[0])}/${encodeURIComponent(item.repository.split('/')[1])}`
    const commitUrl = `${repoUrl}/commit/${item.commit}`
    return `<li class="scan-package"><h4>${escapeHtml(item.packageName)} <span>v${escapeHtml(item.version)}</span></h4><p><a href="${repoUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.repository)} ↗</a></p><p>${escapeHtml(t('manual.entryIds'))}: ${escapeHtml((item.entryIds || []).join(', '))}</p><p class="scan-compatible">${escapeHtml(t('manual.compatible'))}: ${escapeHtml((item.compatibleDshReleases || []).join(', ') || '—')}</p><p><a href="${commitUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('manual.commitLink'))}</a></p></li>`
  }).join('')
  const latest = (data.dsh?.latestThree || []).map(escapeHtml).join(' · ')
  const date = dateLabel(data.observedAt)
  const sourceUrl = `https://github.com/${encodeURIComponent(data.source.repository.split('/')[0])}/${encodeURIComponent(data.source.repository.split('/')[1])}`
  const sourceCommitUrl = `${sourceUrl}/commit/${data.source.commit}`
  const storeCommitUrl = `https://github.com/AI-Scarlett/DSH-Store/commit/${data.storeBaseCommit}`
  const overlap = data.catalogOverlap || {}
  target.className = 'scan-manual-content'
  target.innerHTML = `
    <div class="scan-section-heading"><div><h2>${escapeHtml(t('manual.title'))}</h2><p>${escapeHtml(t('manual.lead'))}</p></div><span class="scan-status success">${escapeHtml(t('manual.complete'))}</span></div>
    <div class="scan-meta"><span><strong>${escapeHtml(data.scanId)}</strong></span><span>${escapeHtml(date)}</span><span>${escapeHtml(t('manual.source'))}: <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(data.source.repository)} ↗</a></span><span><a href="${sourceCommitUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('manual.commit'))}: ${escapeHtml(data.source.commit)}</a></span><span><a href="${storeCommitUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('manual.storeBase'))}: ${escapeHtml(data.storeBaseCommit.slice(0, 12))} ↗</a></span><span>${escapeHtml(t('manual.dshLatest'))}: ${latest}</span></div>
    <div class="scan-metrics">${metric(t('manual.total'), data.source.sourceCount)}${metric(t('manual.processed'), data.source.processedCount)}${metric(t('manual.bundles'), data.packageCounts?.dshBundles)}${metric(t('manual.eligible'), counts['store-auto-eligible'])}</div>
    <div class="scan-layout">
      <article class="scan-card"><h3>${escapeHtml(t('manual.classification'))}</h3><p class="scan-card-note">${escapeHtml(t('manual.classificationHint'))}</p><ul class="scan-class-list">${classes}</ul><p class="scan-boundary">${escapeHtml(t('manual.boundary'))}</p></article>
      <article class="scan-card"><h3>${escapeHtml(t('manual.blockers'))}</h3><p class="scan-card-note">${escapeHtml(t('manual.blockersHint'))}</p><ul class="scan-blocker-list">${blockerRows}</ul></article>
    </div>
    <article class="scan-card scan-eligible-card"><h3>${escapeHtml(t('manual.eligibleList'))} · ${formatNumber((data.eligiblePackages || []).length)}</h3><p class="scan-card-note">${escapeHtml(t('manual.eligibleHint'))}</p><ul class="scan-package-list">${packageCards}</ul></article>
    <article class="scan-card scan-overlap-card"><h3>${escapeHtml(t('manual.registryOverlap'))}</h3><div class="scan-metrics">${metric(t('manual.inCatalog'), overlap.repositoriesWithCatalog)}${metric(t('manual.inCandidates'), overlap.repositoriesWithCandidates)}${metric(t('manual.inBoth'), overlap.repositoriesInBoth)}</div></article>`
}

function statusLabel(run) {
  if (run.status !== 'completed') return t(run.status === 'in_progress' || run.status === 'queued' ? 'auto.running' : 'auto.unknown')
  const conclusionLabels = {
    success: 'auto.success', failure: 'auto.failure', timed_out: 'auto.timedOut', startup_failure: 'auto.failure',
    cancelled: 'auto.cancelled', skipped: 'auto.skipped', neutral: 'auto.neutral', stale: 'auto.stale', action_required: 'auto.actionRequired',
  }
  return conclusionLabels[run.conclusion] ? t(conclusionLabels[run.conclusion]) : t('auto.unknown')
}

function runEventLabel(event) {
  if (event === 'schedule') return t('auto.schedule')
  if (event === 'workflow_dispatch') return t('auto.manualTrigger')
  return event ? t('auto.otherTrigger') : t('auto.unknown')
}

function runMetrics(run) {
  const report = run.statisticsAvailable ? run : null
  if (!report) return `<p class="scan-unavailable">${escapeHtml(run.status === 'completed' && run.conclusion !== 'success' ? t('auto.failedNoReport') : t('auto.reportUnavailable'))}</p>`
  const source = report.sourceVersionChecks
  const rows = [
    ['auto.metrics.checked', source?.checkedEntries], ['auto.metrics.added', report.added], ['auto.metrics.updated', report.updated],
    ['auto.metrics.unlisted', report.compatibilityUnlisted], ['auto.metrics.restored', report.compatibilityRestored],
    ['auto.metrics.pruned', report.prunedCandidates], ['auto.metrics.deferred', report.deferredUpdates],
    ['auto.metrics.rejected', report.rejectedCandidates], ['auto.metrics.failures', report.transientFailures],
    ['auto.metrics.sameVersion', source?.sameVersionCatalogUpdates],
  ]
  return `<div class="scan-run-metrics">${rows.map(([key, value]) => `<div class="scan-run-metric"><span>${escapeHtml(t(key))}</span><strong>${formatNumber(value)}</strong></div>`).join('')}</div>`
}

function renderAutomatic(status) {
  const target = document.querySelector('#automatic-scan-content')
  if (!target) return
  const runs = Array.isArray(status?.recentScanRuns) ? status.recentScanRuns : []
  const items = runs.filter(run => Number.isSafeInteger(run.runId) && run.runId > 0).slice(0, 8).map(run => {
    const isSuccess = run.status === 'completed' && run.conclusion === 'success'
    const isFailure = run.status === 'completed' && run.conclusion && run.conclusion !== 'success'
    const statusClass = isSuccess ? 'success' : isFailure ? 'failure' : ''
    const actionLink = validRunUrl(run.url) ? `<a class="scan-run-link" href="${escapeHtml(run.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('auto.openRun'))}</a>` : ''
    const time = run.createdAt ? `<time datetime="${escapeHtml(run.createdAt)}">${escapeHtml(dateLabel(run.createdAt))}</time>` : ''
    return `<article class="scan-run"><div class="scan-run-header"><strong>${escapeHtml(t('auto.run'))} #${run.runId}</strong><span class="scan-status ${statusClass}">${escapeHtml(statusLabel(run))}</span><span>${escapeHtml(runEventLabel(run.event))}</span>${time}<span>${escapeHtml(run.statisticsAvailable ? t('auto.statsAvailable') : t('auto.statsPending'))}</span></div>${actionLink}${runMetrics(run)}</article>`
  }).join('')
  target.className = 'scan-automatic-content'
  target.innerHTML = `<div class="scan-section-heading"><div><h2>${escapeHtml(t('auto.title'))}</h2><p>${escapeHtml(t('auto.lead'))}</p></div></div><p class="scan-meta">${escapeHtml(t('auto.refresh'))}</p>${items ? `<div class="scan-run-list">${items}</div>` : `<div class="scan-state"><strong>${escapeHtml(t('auto.empty'))}</strong><p>${escapeHtml(t('auto.emptyHint'))}</p></div>`}`
}

document.querySelector('.locale-switch')?.addEventListener('click', event => {
  const button = event.target.closest('[data-locale]')
  if (button) setLocale(button.dataset.locale)
})

document.querySelector('[role="tablist"]')?.addEventListener('click', event => {
  const tab = event.target.closest('[data-scan-tab]')
  if (!tab) return
  const selected = tab.dataset.scanTab
  document.querySelectorAll('[data-scan-tab]').forEach(button => {
    const active = button === tab
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
  })
  document.querySelectorAll('.scan-panel').forEach(panel => { panel.hidden = panel.id !== `panel-${selected}` })
})

document.querySelector('[role="tablist"]')?.addEventListener('keydown', event => {
  const tabs = [...document.querySelectorAll('[data-scan-tab]')]
  const current = tabs.indexOf(event.target.closest('[data-scan-tab]'))
  if (current < 0) return
  const next = event.key === 'ArrowRight' ? (current + 1) % tabs.length
    : event.key === 'ArrowLeft' ? (current + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
  if (next < 0) return
  event.preventDefault()
  tabs[next].focus()
  tabs[next].click()
})

setLocale(state.locale)

const manualUrl = document.body.dataset.manualScanUrl
fetch(manualUrl, { cache: 'force-cache' }).then(response => {
  if (!response.ok) throw new Error('manual scan data unavailable')
  return response.json()
}).then(data => { state.manual = data; renderManual(data) }).catch(() => {
  const target = document.querySelector('#manual-scan-content')
  if (target) { target.className = 'scan-state'; target.dataset.i18n = 'state.manualError'; target.textContent = t('state.manualError') }
})

const statusUrl = document.body.dataset.automationStatusUrl
fetch(statusUrl, { cache: 'no-cache' }).then(response => {
  if (!response.ok) throw new Error('automation status unavailable')
  return response.json()
}).then(data => { state.automatic = data; renderAutomatic(data) }).catch(() => {
  const target = document.querySelector('#automatic-scan-content')
  if (target) { target.className = 'scan-state'; target.dataset.i18n = 'state.autoError'; target.textContent = t('state.autoError') }
})
