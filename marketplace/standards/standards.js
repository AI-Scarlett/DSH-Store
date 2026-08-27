const translations = {
  zh: {
    'meta.title': '插件收录标准｜DSH STORE',
    'meta.description': 'DSH STORE 收录标准：公开插件候选门槛、固定 Commit 检查项、自动准入边界、拒绝条件和持续复查流程。',
    'a11y.skip': '跳到主要内容',
    'nav.home': '首页', 'nav.store': '插件目录', 'nav.standards': '收录标准', 'nav.build': '开发插件', 'nav.faq': '常见问题', 'nav.about': '关于我们', 'nav.policy': '政策原文', 'nav.submit': '提交插件',
    'hero.title1': '收录前，', 'hero.title2': '先把标准公开。', 'hero.lead': 'DSH STORE 从公开 GitHub 项目中发现候选，但“被发现”不等于“已收录”。只有固定来源、结构、权限、兼容性与证据门槛逐项成立，插件才可能进入受保护的 Catalog。', 'hero.signal': '候选库没有安装动作；未晋级 Catalog 前，任何条目都不能进入商城受保护安装通道。',
    'action.checks': '查看检查清单', 'action.candidate': '了解候选标准', 'action.submit': '提交插件 ↗', 'action.build': '按标准开发插件', 'action.top': '回到顶部 ↑',
    'principles.title': '我们按证据收录，不按热度背书。', 'principles.lead': 'Star、截图、README 宣称和提交标签只能帮助发现项目，不能替代固定源码、权限与安装契约检查。',
    'principle.one.title': '来源可追溯', 'principle.one.body': '只接受公开 canonical GitHub 仓库，并把每次审核固定到完整 40 位 Commit。',
    'principle.two.title': '结构可复现', 'principle.two.body': 'manifest、Bundle Patch、入口 ID、运行文件和生命周期脚本必须组成一致的安装契约。',
    'principle.three.title': '权限最小且透明', 'principle.three.body': '文件、网络、命令、凭据、Profile 与外部依赖逐项披露；无法确认就保持 unknown。',
    'principle.four.title': '未知即停止晋级', 'principle.four.body': '歧义、截断、漂移或证据不足都会暂缓或阻止收录，不通过降低门槛获得“通过”。',
    'candidate.title': '候选可以被看见，但不能被误认为可安装。', 'candidate.lead': '候选库负责保留发现与复查线索；Catalog 才是商城身份与策略权威。两者使用不同门槛和动作权限。',
    'candidate.discovery.title': '进入候选库', 'candidate.discovery.one': '公开 GitHub 仓库，项目与 DSH 插件具有可复核关联', 'candidate.discovery.two': '按 canonical 仓库去重，记录发现来源与当前状态', 'candidate.discovery.three': '可标记 discovered、reviewing 或 rejected', 'candidate.discovery.note': '候选记录不含安装字段，也不提供安装、构建或运行按钮。',
    'candidate.catalog.title': '晋级 Catalog', 'candidate.catalog.one': '完整 Commit 上的标准 DSH Bundle 与许可证成立', 'candidate.catalog.two': '源码检查面完整，身份、入口、权限与兼容性无歧义', 'candidate.catalog.three': '机器计划绑定 base Commit 和输入哈希，经 PR、CI 与合并验证', 'candidate.catalog.note': '只有合并后的远端 Catalog 与公开页面读回，才能证明实际收录。',
    'route.direct.title': '标准直连', 'route.direct.body': '仓库根目录已经包含完整标准 Bundle，可进入固定源码审核。',
    'route.monorepo.title': '单仓多包', 'route.monorepo.body': '插件位于明确子目录，manifestPath 与 installPath 必须唯一且不可越界。',
    'route.adapter.title': '需要适配器', 'route.adapter.body': '上游不是 DSH Bundle，但存在受支持的窄接口；需另建标准适配器，不能冒充直装。',
    'route.blocked.title': '阻止收录', 'route.blocked.body': '来源、许可、宿主边界或安全契约无法成立；保留原因，但不开放受保护安装。',
    'checks.title': '我们会检查哪些内容？', 'checks.lead': '每项都从同一个固定 Commit 取证。检查结果描述对应范围，不会从静态证据推断真实运行结果。',
    'checks.head.surface': '检查面', 'checks.head.content': '核对内容', 'checks.head.gate': '不满足时',
    'check.source.title': '仓库与固定身份', 'check.source.body': 'canonical HTTPS GitHub 地址、完整 Commit、默认分支来源、包路径与重复身份', 'check.source.gate': '拒绝或暂缓',
    'check.manifest.title': 'Manifest 一致性', 'check.manifest.body': '包名、语义化版本、repository、license、files、Node.js 与 DSH 声明', 'check.manifest.gate': '身份不一致即阻止',
    'check.bundle.title': 'Bundle 与入口', 'check.bundle.body': 'dsh.bundle.patch 路径、Patch 内容、唯一 entryIds，以及是否触碰受保护组件', 'check.bundle.gate': '非标准或冲突即阻止',
    'check.build.title': '构建与安装契约', 'check.build.body': '运行文件是否存在；preinstall、install、postinstall、prepare 是否精确披露；依赖是否自包含', 'check.build.gate': '隐藏脚本或缺产物即阻止',
    'check.permission.title': '权限与数据边界', 'check.permission.body': '文件、网络、命令、凭据、Profile、会话、原生制品与外部服务信号', 'check.permission.gate': '保守标级；自动准入失败',
    'check.security.title': '安全与失败行为', 'check.security.body': '硬编码密钥、临时外传端点、破坏性命令、挖矿、敏感日志、动态执行与越界路径', 'check.security.gate': '硬信号阻止；风险信号警告',
    'check.compatibility.title': '兼容性与证据', 'check.compatibility.body': '精确 DSH 版本、Node.js、系统、Profile 范围，以及安装、运行、安全证据状态', 'check.compatibility.gate': '未知保持 unknown',
    'check.catalog.title': 'Catalog 合约', 'check.catalog.body': '分类、中文名、用途、搜索词、状态、更新策略、当前目录重复项与 schema', 'check.catalog.gate': 'Registry 校验失败关闭',
    'bounds.title': '自动化只读固定源码，并且检查面有硬上限。', 'bounds.lead': '上限用于保证“读全”和确定性，不是大插件不安全的结论。超限、截断或暂时无法读取时，结果是检查不完整并失败关闭。', 'bounds.tree': '最多仓库树条目', 'bounds.files': '最多运行时文件', 'bounds.single': '单文件上限', 'bounds.total': '运行时源码总上限', 'bounds.noexec': '自动化不会运行第三方 install、prepare、build、test 或运行时代码，也不会下载依赖来补足结论。',
    'blockers.title': '这些情况不会进入受保护安装通道。', 'blockers.lead': '硬性边界优先于评分、热度、作者声明或历史版本表现。',
    'blocker.source.title': '来源不可固定', 'blocker.source.body': '非 GitHub、浮动分支或标签、仓库归属不明、路径歧义或许可证权威不可验证。',
    'blocker.contract.title': '安装契约不完整', 'blocker.contract.body': '缺 manifest、Bundle Patch、唯一入口、运行产物，或生命周期脚本与实际源码不一致。',
    'blocker.official.title': '越过 DSH 边界', 'blocker.official.body': '修改 DSH 核心或 @deepseek-ai/*，停用、替换、遮蔽官方清单或受保护组件。',
    'blocker.unknown.title': '证据未知或检查不完整', 'blocker.unknown.body': '源码漂移、接口失败、超限、截断、敏感泄露或破坏性行为信号存在时停止晋级。',
    'flow.title': '从发现到公开收录，每一道门都有证据。', 'flow.lead': '自动扫描每 8 小时运行；Catalog、Pages、国际站和国内站每 3 小时独立核对。没有合格变更时明确记录为 0。',
    'flow.one.title': '发现与去重', 'flow.one.body': '从提交表单、GitHub 主题和检索中发现，按 canonical 仓库去重。',
    'flow.two.title': '固定完整 Commit', 'flow.two.body': '把候选身份、manifest、Patch 与运行面固定在同一份不可变源码上。',
    'flow.three.title': '有界静态检查', 'flow.three.body': '完成结构、安全、权限、依赖、兼容性与 Catalog 合约核对。',
    'flow.four.title': '策略判定', 'flow.four.body': '符合自动低风险门槛才可 source-verified；其他结果进入复核、整改、blocked 或 rejected。',
    'flow.five.title': '哈希绑定 PR 与 CI', 'flow.five.body': '计划绑定 base Commit 和输入哈希，经 Registry 检查、测试与 CodeQL 后才可合并。',
    'flow.six.title': '远端与公开面读回', 'flow.six.body': '分别确认 GitHub Catalog、Pages、国际站和国内站；真实 Profile 安装与运行仍是独立验收。',
    'evidence.title': '收录不是完整安全审计，也不是运行成功证明。', 'evidence.body': '静态检查只证明对应固定源码在明确边界内满足当前政策。真实安装、冷启动、可见 UI、功能效果、故障恢复和独立安全审核必须分别提供证据；unknown 不是失败，也绝不是通过。',
    'footer.lead': '标准公开，证据分层，未知保持未知。', 'footer.note': '候选不等于收录 · 收录不等于安全审计',
  },
  en: {
    'meta.title': 'Plugin Listing Standards | DSH STORE',
    'meta.description': 'DSH STORE listing standards: candidate criteria, fixed-Commit checks, automated admission boundaries, rejection conditions, and continuous review.',
    'a11y.skip': 'Skip to main content',
    'nav.home': 'Home', 'nav.store': 'Plugin catalog', 'nav.standards': 'Listing standards', 'nav.build': 'Build plugins', 'nav.faq': 'FAQ', 'nav.about': 'About us', 'nav.policy': 'Policy source', 'nav.submit': 'Submit plugin',
    'hero.title1': 'Before listing,', 'hero.title2': 'publish the standard.', 'hero.lead': 'DSH STORE discovers candidates from public GitHub projects, but discovery is not listing. A plugin can enter the guarded Catalog only after its pinned source, structure, permissions, compatibility, and evidence gates hold together.', 'hero.signal': 'The Candidate Registry has no install actions. Nothing enters the marketplace’s guarded install path until it is promoted into the Catalog.',
    'action.checks': 'View the checklist', 'action.candidate': 'Read candidate criteria', 'action.submit': 'Submit a plugin ↗', 'action.build': 'Build to the standard', 'action.top': 'Back to top ↑',
    'principles.title': 'We list by evidence, not popularity.', 'principles.lead': 'Stars, screenshots, README claims, and submission labels can aid discovery. They never replace pinned-source, permission, or install-contract checks.',
    'principle.one.title': 'Traceable source', 'principle.one.body': 'Only public canonical GitHub repositories qualify, and every review is pinned to a full 40-character Commit.',
    'principle.two.title': 'Reproducible structure', 'principle.two.body': 'The manifest, Bundle Patch, entry IDs, runtime files, and lifecycle scripts must form one consistent install contract.',
    'principle.three.title': 'Least and visible privilege', 'principle.three.body': 'File, network, command, credential, Profile, and external dependencies are disclosed separately. Unproven facts stay unknown.',
    'principle.four.title': 'Unknown stops promotion', 'principle.four.body': 'Ambiguity, truncation, drift, or missing evidence pauses or blocks admission. The threshold is never lowered to manufacture a pass.',
    'candidate.title': 'Candidates can be visible without being mistaken for installable.', 'candidate.lead': 'The Candidate Registry preserves discovery and re-review signals. The Catalog is the authority for marketplace identity and policy. They have different thresholds and action permissions.',
    'candidate.discovery.title': 'Enter the Candidate Registry', 'candidate.discovery.one': 'A public GitHub repository with a reviewable connection to a DSH plugin', 'candidate.discovery.two': 'Deduplicated by canonical repository, with discovery source and current state recorded', 'candidate.discovery.three': 'May be marked discovered, reviewing, or rejected', 'candidate.discovery.note': 'Candidate records contain no install fields and expose no install, build, or runtime buttons.',
    'candidate.catalog.title': 'Promote into the Catalog', 'candidate.catalog.one': 'A standard DSH Bundle and license hold at one full Commit', 'candidate.catalog.two': 'The source surface is complete, with unambiguous identity, entries, permissions, and compatibility', 'candidate.catalog.three': 'A machine plan binds the base Commit and input hashes, then passes PR, CI, and merge gates', 'candidate.catalog.note': 'Only the merged remote Catalog plus public-page readback proves an actual listing.',
    'route.direct.title': 'Direct', 'route.direct.body': 'The repository root already contains a complete standard Bundle and can enter pinned-source review.',
    'route.monorepo.title': 'Monorepo', 'route.monorepo.body': 'The plugin lives in one explicit subdirectory; manifestPath and installPath must be unique and remain in bounds.',
    'route.adapter.title': 'Adapter required', 'route.adapter.body': 'The upstream is not a DSH Bundle but has a narrow supported seam. A separate standard adapter is required.',
    'route.blocked.title': 'Blocked', 'route.blocked.body': 'Source, license, host boundary, or safety contract cannot be established. The reason stays visible, but guarded install stays off.',
    'checks.title': 'What do we check?', 'checks.lead': 'Every fact is read from the same pinned Commit. A check describes only its evidence scope and never turns static evidence into a runtime claim.',
    'checks.head.surface': 'Surface', 'checks.head.content': 'What is verified', 'checks.head.gate': 'If it fails',
    'check.source.title': 'Repository and identity', 'check.source.body': 'Canonical HTTPS GitHub URL, full Commit, default-branch provenance, package path, and duplicate identities', 'check.source.gate': 'Reject or defer',
    'check.manifest.title': 'Manifest consistency', 'check.manifest.body': 'Package name, semantic version, repository, license, files, Node.js, and DSH declarations', 'check.manifest.gate': 'Identity mismatch blocks',
    'check.bundle.title': 'Bundle and entries', 'check.bundle.body': 'dsh.bundle.patch path, Patch content, unique entryIds, and contact with protected components', 'check.bundle.gate': 'Non-standard or conflicting blocks',
    'check.build.title': 'Build and install contract', 'check.build.body': 'Runtime files; exact preinstall, install, postinstall, and prepare disclosure; self-contained dependencies', 'check.build.gate': 'Hidden scripts or missing artifacts block',
    'check.permission.title': 'Permissions and data', 'check.permission.body': 'File, network, command, credential, Profile, session, native artifact, and external-service signals', 'check.permission.gate': 'Conservative level; no auto-admission',
    'check.security.title': 'Safety and failure behavior', 'check.security.body': 'Hard-coded secrets, temporary exfiltration endpoints, destructive commands, mining, sensitive logs, dynamic execution, and path escape', 'check.security.gate': 'Hard signals block; risks warn',
    'check.compatibility.title': 'Compatibility and evidence', 'check.compatibility.body': 'Exact DSH releases, Node.js, system and Profile scope, plus install, runtime, and security evidence states', 'check.compatibility.gate': 'Unknown stays unknown',
    'check.catalog.title': 'Catalog contract', 'check.catalog.body': 'Categories, localized name and purpose, search terms, status, update policy, duplicates, and current schema', 'check.catalog.gate': 'Registry validation fails closed',
    'bounds.title': 'Automation reads fixed source only, within hard bounds.', 'bounds.lead': 'The limits guarantee complete, deterministic reading; they do not claim that larger plugins are unsafe. Oversize, truncated, or temporarily unavailable input yields an incomplete check and fails closed.', 'bounds.tree': 'maximum tree entries', 'bounds.files': 'maximum runtime files', 'bounds.single': 'maximum per file', 'bounds.total': 'maximum runtime source total', 'bounds.noexec': 'Automation never runs third-party install, prepare, build, test, or runtime code, and it does not download dependencies to fill evidence gaps.',
    'blockers.title': 'These conditions never enter the guarded install path.', 'blockers.lead': 'Hard boundaries override scores, popularity, author claims, and historical version performance.',
    'blocker.source.title': 'Source cannot be pinned', 'blocker.source.body': 'Non-GitHub or floating source, unclear ownership, ambiguous paths, or unverifiable license authority.',
    'blocker.contract.title': 'Incomplete install contract', 'blocker.contract.body': 'Missing manifest, Bundle Patch, unique entries, runtime artifacts, or lifecycle scripts that disagree with source.',
    'blocker.official.title': 'DSH boundary violation', 'blocker.official.body': 'Modifying DSH core or @deepseek-ai/*, or disabling, replacing, or shadowing official inventory or protected components.',
    'blocker.unknown.title': 'Unknown or incomplete evidence', 'blocker.unknown.body': 'Source drift, API failure, exceeded bounds, truncation, sensitive leakage, or destructive behavior stops promotion.',
    'flow.title': 'Every gate from discovery to public listing has evidence.', 'flow.lead': 'Discovery runs every 8 hours. The Catalog, Pages, international site, and China site are checked independently every 3 hours. A successful run with no qualifying change reports zero.',
    'flow.one.title': 'Discover and deduplicate', 'flow.one.body': 'Discover through submissions, GitHub topics, and bounded search, then deduplicate by canonical repository.',
    'flow.two.title': 'Pin a full Commit', 'flow.two.body': 'Bind candidate identity, manifest, Patch, and runtime surface to one immutable source.',
    'flow.three.title': 'Run bounded static checks', 'flow.three.body': 'Check structure, safety, permissions, dependencies, compatibility, and the Catalog contract.',
    'flow.four.title': 'Apply policy', 'flow.four.body': 'Only the automatic low-risk contract can become source-verified; other results go to review, remediation, blocked, or rejected.',
    'flow.five.title': 'Hash-bound PR and CI', 'flow.five.body': 'Bind the plan to the base Commit and input hashes, then require Registry checks, tests, and CodeQL before merge.',
    'flow.six.title': 'Read back remote and public surfaces', 'flow.six.body': 'Verify GitHub Catalog, Pages, international, and China sites separately. Real Profile install and runtime remain independent acceptance.',
    'evidence.title': 'A listing is not a complete security audit or proof of runtime success.', 'evidence.body': 'Static checks prove only that one pinned source meets the current policy within an explicit scope. Real installation, cold start, visible UI, functional outcome, recovery, and independent security review require separate evidence. Unknown is not failure—and never a pass.',
    'footer.lead': 'Public standards, layered evidence, and honest unknowns.', 'footer.note': 'Candidate is not listing · Listing is not a security audit',
  },
}

const storedLocale = (() => {
  try { return localStorage.getItem('dsh-marketplace-locale') } catch { return null }
})()
const defaultLocale = document.documentElement.dataset.defaultLocale === 'en' ? 'en' : 'zh'
const state = { locale: storedLocale === 'en' || storedLocale === 'zh' ? storedLocale : defaultLocale }
const t = key => translations[state.locale]?.[key] || translations.zh[key] || key
const analyticsToken = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)

function setLocale(locale) {
  state.locale = locale === 'en' ? 'en' : 'zh'
  try { localStorage.setItem('dsh-marketplace-locale', state.locale) } catch {}
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN'
  document.title = t('meta.title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'))
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', t('meta.title'))
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', t('meta.description'))
  document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', t('meta.title'))
  document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', t('meta.description'))
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n) })
  document.querySelectorAll('[data-locale]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.locale === state.locale)))
}

function sendDshEvent(event, details = {}) {
  if (!/^https?:$/.test(location.protocol)) return
  const eventName = analyticsToken(event)
  if (!eventName) return
  const url = new URL('/_events/dsh', location.origin)
  url.searchParams.set('event', eventName)
  url.searchParams.set('locale', state.locale)
  url.searchParams.set('site', analyticsToken(location.host))
  for (const field of ['item', 'value']) {
    const token = analyticsToken(details[field])
    if (token) url.searchParams.set(field, token)
  }
  try {
    if (navigator.sendBeacon?.(url, new Blob([], { type: 'text/plain' }))) return
    fetch(url, { method: 'POST', keepalive: true, cache: 'no-store', credentials: 'omit' }).catch(() => {})
  } catch {}
}

function observeReveals() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal').forEach(element => element.classList.add('visible'))
    return
  }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible')
      observer.unobserve(entry.target)
    }
  }), { threshold: .08 })
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element))
}

document.querySelector('.locale-switch')?.addEventListener('click', event => {
  const button = event.target.closest('[data-locale]')
  if (!button || button.dataset.locale === state.locale) return
  setLocale(button.dataset.locale)
  sendDshEvent('locale_switch', { item: state.locale, value: 'standards' })
})

document.addEventListener('click', event => {
  const tracked = event.target.closest('[data-analytics-event]')
  if (tracked) sendDshEvent(tracked.dataset.analyticsEvent, { item: tracked.dataset.analyticsItem })
})

setLocale(state.locale)
observeReveals()
sendDshEvent('standards_view', { item: 'listing_policy' })
