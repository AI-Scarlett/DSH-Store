const CATALOG_URL = document.body.dataset.catalogUrl || '../registry/catalog.json'
const CANDIDATES_URL = document.body.dataset.candidatesUrl || '../registry/candidates.json'
const AUTOMATION_STATUS_URL = document.body.dataset.automationStatusUrl || null
const IS_DIRECTORY = document.body.classList.contains('plugins-page')

const translations = {
  zh: {
    'meta.title': 'DSH STORE｜DeepSeek Harness（DSH）插件商城',
    'meta.description': 'DSH STORE（dsh.store）是面向 DeepSeek Harness（DSH）的第三方插件商城，提供插件发现、权限与来源核对、安全接入说明及插件开发工具。',
    'directory.meta.title': '全部 DSH 插件｜DSH STORE',
    'directory.meta.description': '浏览 DSH STORE 完整插件目录，按名称、能力、权限与兼容性搜索和筛选。',
    'a11y.skip': '跳到主要内容', 'a11y.skipCatalog': '跳到插件目录',
    'nav.home': '首页', 'nav.discover': '插件目录', 'nav.safety': '信任机制', 'nav.manager': 'DSH Store 插件', 'nav.build': '开发插件', 'nav.faq': '常见问题', 'nav.about': '关于我们', 'nav.guide': '使用说明', 'nav.submit': '提交插件',
    'hero.eyebrow': 'DSH TRUSTED EXTENSION LAYER', 'hero.title1': '可信插件，', 'hero.title2': '安全接入 DSH。',
    'hero.lead': '面向 DeepSeek Harness（DSH）的第三方插件商城。发现插件、核对来源与权限，再通过清楚、可恢复的路径安全接入。',
    'install.title': '安装 DSH Store', 'install.pinned': '固定 Commit', 'install.step1': '打开终端', 'install.step2': '粘贴命令并执行', 'install.step3': '重启 DSH 后打开商城',
    'install.note1': '确认正在操作目标设备', 'install.note2': '来源锁定到完整 Commit', 'install.note3': '在“设置 → 插件”中进入',
    'install.warning': '命令会修改 web Profile。请先备份；如执行失败，不要连续重试。',
    'action.copyCommand': '复制', 'action.fullGuide': '查看说明 ↗', 'action.explore': '查看全部插件', 'action.manager': '了解 DSH Store', 'action.build': '开发 DSH 插件', 'action.installSkill': '安装 build-dsh-plugin', 'action.trust': '了解安全机制', 'action.allFaq': '查看完整常见问题', 'action.home': '返回首页',
    'action.source': '查看源码与说明', 'action.backCommand': '回到首屏复制命令 ↑', 'action.clear': '清除筛选', 'action.viewAll': '查看全部插件', 'action.previous': '上一页', 'action.next': '下一页', 'action.retry': '重新加载', 'action.githubCatalog': '查看 GitHub 目录 ↗', 'action.top': '回到顶部 ↑',
    'action.details': '查看插件详情', 'action.copyCommit': '复制 Commit', 'action.repo': '查看 GitHub 仓库', 'action.manual': '前往 GitHub 手动安装',
    'trust.commit': '固定 Git Commit', 'trust.permissions': '权限先于安装', 'trust.readonly': '浏览保持只读',
    'console.online': '目录在线', 'console.network': 'EXTENSION NETWORK', 'console.heading': '找到新能力',
    'tab.featured': '推荐', 'tab.workflow': '工作流', 'tab.visual': '视觉', 'float.pinned': '来源已固定', 'float.commit': '40 位 Commit',
    'stats.plugins': '在架插件', 'stats.plannable': '可生成计划', 'stats.categories': '能力分类', 'stats.source': 'GitHub 权威目录', 'stats.connecting': '正在核对 catalog.json…',
    'manager.title': '商城本身，也是一个受约束的 DSH 插件。', 'manager.lead': 'DSH Store 通过标准 Host Plugin 与 Client Bundle 接入，把发现、核对和受控操作放进 DSH，而不是改造 DSH。',
    'manager.body': '它不修改 DSH 核心，不遮蔽官方插件清单；任何生命周期变更都需要单次计划、精确确认、备份、检查和回滚。', 'manager.version': '当前版本', 'manager.risk': '生命周期风险', 'manager.identity': '位固定身份',
    'manager.fact1': '标准扩展面', 'manager.fact2': '浏览默认只读', 'manager.fact3': '失败关闭',
    'guide.order': '按顺序操作', 'guide.title1': '备份目标 Profile', 'guide.body1': '备份 package.json、锁文件、工作区文件和 cordis.patch.yml。',
    'guide.title2': '执行固定来源命令', 'guide.body2': '使用 DSH 官方 CLI；不要把 40 位 Commit 改成 main。', 'guide.title3': '检查结果并重启', 'guide.body3': '命令成功后重启 DSH Web，再进入设置里的插件商城。',
    'builder.title': '没有合适的插件？从一个真实问题开始构建。', 'builder.lead': '使用开源 build-dsh-plugin Skill，把问题、结果和成功标准转换为标准工程与证据门槛。',
    'builder.cardTitle': '三个答案，就是开发起点。', 'builder.input1': '现在遇到什么问题？', 'builder.input2': '希望达到什么结果？', 'builder.input3': '怎样观察到它成功？', 'builder.action': '打开开发插件工作台',
    'builder.outputTitle': '从 Brief 到可验证交付物', 'builder.output1': '宿主兼容性', 'builder.output2': '风险与权限', 'builder.output3': '标准源码工程', 'builder.output4': '验证证据等级', 'builder.note': '真实 Profile、重启与发布保持为独立确认步骤。',
    'featured.title': '精选插件，扩展你的 DSH 工作流。', 'featured.lead': '从自动化、知识管理到开发协作，发现来源清晰、信息透明的实用插件。先看能力与权限，再决定是否接入。',
    'catalog.title': '找到你需要的能力', 'catalog.lead': '目录声明来自 GitHub。无法确认的安全、权限或兼容性字段继续显示为未知。', 'catalog.search': '搜索中文名、用途、别名或英文包名', 'catalog.sort': '排序', 'catalog.loading': '正在读取目录…',
    'automation.title': '自动更新有没有成功，一眼就能看到。', 'automation.lead': '这里公开显示新插件发现、历史插件原项目版本检查、四端目录巡检和实际变更；“扫描成功”和“有更新”分别记录。',
    'automation.overall': '总体状态', 'automation.scanner': '插件与版本扫描', 'automation.watchdog': '四端巡检', 'automation.latestChange': '最近一次扫描变更',
    'automation.scannerNote': '每 3 小时扫描新插件并检查全部历史版本', 'automation.watchdogNote': 'GitHub、Pages、国际站、国内站', 'automation.changeUnit': '新增 / 更新',
    'automation.sourceCheck': '历史版本检查', 'automation.sourceCheckUnit': '已检查 / 发现高版本 / 已更新',
    'automation.recent': '最近自动新增', 'automation.recentTitle': '新增了哪些插件', 'automation.recentUpdates': '最近原项目更新', 'automation.recentUpdatesTitle': '哪些插件版本更新了',
    'automation.noUpdates': '最近可读取的运行中没有通过固定源审查的版本更新。', 'automation.loading': '正在读取最近运行记录…', 'automation.evidence': '查看 GitHub 运行证据 ↗',
    'catalog.gatewayKicker': '探索更多能力', 'catalog.gatewayTitle': '查看全部 DSH 插件、权限与兼容性',
    'sort.recommended': '官方最新 DSH 兼容与更新优先', 'sort.name': '名称 A–Z', 'sort.recent': '最近更新', 'sort.risk': '权限由低到高',
    'view.trusted': '可信安装库', 'view.candidates': '候选发现库', 'stats.candidates': '候选项目',
    'assurance.discovered': '已发现', 'assurance.installable': '可安装验证', 'assurance.runtime': '运行验证', 'assurance.security': '安全审查',
    'candidate.notice': '候选库只用于发现；没有安装按钮，也不会进入 DSH 操作计划。通过固定 Commit 与安全契约审核后才能晋级可信安装库。',
    'candidate.search': '搜索候选项目、Topic、来源或 GitHub 仓库', 'candidate.emptyTitle': '候选库当前为空', 'candidate.emptyBody': '尚未开始批量导入候选项目；可信安装库不受影响。',
    'status.available': '可安装', 'status.viewOnly': '仅展示', 'status.unlisted': '已下架',
    'empty.title': '没有找到匹配插件', 'empty.body': '换个关键词，或清除当前分类筛选。', 'error.title': '目录暂时没有加载成功', 'error.body': '请稍后重试，或前往 GitHub 查看最新目录。',
    'safety.title': '信任不是口号，是四个可检查的状态。', 'safety.lead': '收录从不等于安全审计。我们把来源、权限、变更与恢复分开显示，未知事实保持未知。',
    'safety.card1.title': '来源固定', 'safety.card1.body': '可安装条目指向完整 40 位 Git Commit，不把浮动分支伪装成稳定版本。',
    'safety.card2.title': '权限可见', 'safety.card2.body': '文件、网络、命令和凭据边界在操作前集中展示。',
    'safety.card3.title': '先计划再改变', 'safety.card3.body': '每次真实变更使用新的一次性计划，并核对精确文件范围。',
    'safety.card4.title': '随时可恢复', 'safety.card4.body': '执行前备份，执行后健康检查；失败时恢复原始状态。',
    'workflow.title': '安全流程，也可以很方便。', 'workflow.lead': '一个入口、一个命令、一个清楚的验证路径。复杂性留在系统里，决定权留给你。',
    'workflow.step1.title': '找到适合的插件', 'workflow.step1.body': '按能力与使用场景缩小范围，再查看来源、权限和兼容性。',
    'workflow.step2.title': '复制固定来源命令', 'workflow.step2.body': '首屏直接给出命令和执行顺序，不需要翻找文档。', 'workflow.step3.title': '重启后进入 DSH Store', 'workflow.step3.body': '在 DSH 内查看并管理，真实结果与测试状态明确区分。',
    'relation.title': 'DSH STORE 与 DeepSeek Harness 如何连接？', 'relation.lead': '这是面向 DeepSeek Harness 的第三方插件发现与管理入口，不是官方插件清单的替代品。',
    'relation.card1.title': '标准 DSH 接入', 'relation.card1.body': '管理器以 Host Plugin 与 Client Bundle 接入 DSH，不修改 DSH 核心，也不遮蔽官方插件清单。',
    'relation.card2.title': '目录有明确权威源', 'relation.card2.body': '商城运行时信息来自 GitHub registry/catalog.json；安全、权限或兼容性未核实时明确显示未知。',
    'relation.card3.title': '浏览与变更分离', 'relation.card3.body': '在官网浏览不会改写 Profile。真实安装必须使用 DSH 官方 CLI，并经过计划、确认、备份、检查与回滚。',
    'faq.title': '安装之前，先把边界说清楚。', 'faq.q1': '官网会直接安装插件吗？', 'faq.a1': '不会。官网只负责发现与详情展示；生命周期操作需要在 DSH 内生成计划并确认。',
    'faq.q2': '“可安装”等于完成安全审计吗？', 'faq.a2': '不等于。它表示条目满足固定来源、标准 Bundle 与当前策略检查。', 'faq.q3': '如何选择适合自己的插件？', 'faq.a3': '先确认能力是否匹配，再查看来源、权限、兼容性和维护状态；遇到未知信息时保持谨慎。',
    'directory.title1': '发现插件，', 'directory.title2': '扩展 DSH 能力。', 'directory.lead': '按能力、名称、权限或仓库快速查找。每个条目都提供可追溯来源、版本、权限与兼容性信息。',
    'directory.capacity': '搜索关键词留在你的浏览器里', 'directory.capacityNote': '筛选和排序不会上传关键词；目录数据来自可追溯的 GitHub catalog.json。',
    'footer.lead': '科技感来自清晰的系统，信任来自可检查的边界。', 'footer.catalogLead': '发现插件、看清权限，再决定是否接入。', 'footer.note': '收录不等于安全审计 · 浏览不会改写 Profile', 'dialog.title': '插件详情',
    'value.unknown': '未知', 'value.undeclared': '未声明', 'value.none': '无', 'value.noStats': '未启用统计', 'filter.all': '全部',
    'catalog.failed': '目录加载失败', 'catalog.offline': '本地目录未连接', 'catalog.meta': '显示 {shown} / {total} 个插件',
    'toast.commandCopied': '安装命令已复制', 'toast.copyDenied': '浏览器未允许复制，请手动选择命令', 'toast.commitCopied': 'Commit 已复制',
    'dialog.basic': '基本信息', 'dialog.permissions': '权限画像', 'dialog.review': '审核与兼容性', 'dialog.policy': '商城策略说明：',
    'dialog.note': '详情来自 GitHub catalog.json 的目录声明与固定 Commit 核验。收录、扫描或审核均不等于完成安全审计；官网不会直接修改你的 DSH Profile。',
  },
  en: {
    'meta.title': 'DSH STORE | DeepSeek Harness Plugin Marketplace',
    'meta.description': 'DSH STORE is a third-party marketplace for discovering, evaluating, building, and safely connecting DeepSeek Harness plugins.',
    'directory.meta.title': 'All DSH Plugins | DSH STORE',
    'directory.meta.description': 'Browse the complete DSH STORE catalog and filter by name, capability, permission, or compatibility.',
    'a11y.skip': 'Skip to main content', 'a11y.skipCatalog': 'Skip to plugin catalog',
    'nav.home': 'Home', 'nav.discover': 'Plugin catalog', 'nav.safety': 'Trust protocol', 'nav.manager': 'DSH Store plugin', 'nav.build': 'Build plugins', 'nav.faq': 'FAQ', 'nav.about': 'About us', 'nav.guide': 'Usage guide', 'nav.submit': 'Submit plugin',
    'hero.eyebrow': 'DSH TRUSTED EXTENSION LAYER', 'hero.title1': 'Trusted plugins.', 'hero.title2': 'Safe access to DSH.',
    'hero.lead': 'A third-party marketplace for DeepSeek Harness (DSH). Discover plugins, inspect sources and permissions, then connect them through a clear, recoverable path.',
    'install.title': 'Install DSH Store', 'install.pinned': 'Pinned commit', 'install.step1': 'Open Terminal', 'install.step2': 'Paste and run the command', 'install.step3': 'Restart DSH and open the store',
    'install.note1': 'Confirm the target device', 'install.note2': 'Source pinned to a full commit', 'install.note3': 'Open Settings → Plugins',
    'install.warning': 'This command changes the web Profile. Back it up first; if it fails, do not retry repeatedly.',
    'action.copyCommand': 'Copy', 'action.fullGuide': 'View guide ↗', 'action.explore': 'View all plugins', 'action.manager': 'Meet DSH Store', 'action.build': 'Build a DSH plugin', 'action.installSkill': 'Install build-dsh-plugin', 'action.trust': 'See the trust protocol', 'action.allFaq': 'View the complete FAQ', 'action.home': 'Back home',
    'action.source': 'View source and docs', 'action.backCommand': 'Back to the command ↑', 'action.clear': 'Clear filters', 'action.viewAll': 'View all plugins', 'action.previous': 'Previous', 'action.next': 'Next', 'action.retry': 'Retry', 'action.githubCatalog': 'View GitHub catalog ↗', 'action.top': 'Back to top ↑',
    'action.details': 'View plugin details', 'action.copyCommit': 'Copy commit', 'action.repo': 'View GitHub repository', 'action.manual': 'Install manually on GitHub',
    'trust.commit': 'Pinned Git commit', 'trust.permissions': 'Permissions before install', 'trust.readonly': 'Browsing stays read-only',
    'console.online': 'Catalog online', 'console.network': 'EXTENSION NETWORK', 'console.heading': 'Find a new capability',
    'tab.featured': 'Featured', 'tab.workflow': 'Workflow', 'tab.visual': 'Visual', 'float.pinned': 'Source pinned', 'float.commit': '40-char commit',
    'stats.plugins': 'active plugins', 'stats.plannable': 'plan-ready', 'stats.categories': 'capability groups', 'stats.source': 'GitHub authority', 'stats.connecting': 'Verifying catalog.json…',
    'manager.title': 'The store is itself a constrained DSH plugin.', 'manager.lead': 'DSH Store connects through a standard Host Plugin and Client Bundle, bringing discovery, inspection, and guarded operations into DSH without remaking DSH.',
    'manager.body': 'It never changes DSH core or hides the official inventory. Every lifecycle change needs a single-use plan, exact confirmation, backup, checks, and rollback.', 'manager.version': 'current version', 'manager.risk': 'lifecycle risk', 'manager.identity': 'char identity',
    'manager.fact1': 'Standard extension surface', 'manager.fact2': 'Read-only browsing', 'manager.fact3': 'Fail closed',
    'guide.order': 'Follow in order', 'guide.title1': 'Back up the target Profile', 'guide.body1': 'Back up package.json, lockfiles, workspace files, and cordis.patch.yml.',
    'guide.title2': 'Run the pinned-source command', 'guide.body2': 'Use the official DSH CLI. Never replace the 40-character commit with main.', 'guide.title3': 'Check and restart', 'guide.body3': 'After a clean command, restart DSH Web and open the plugin market in Settings.',
    'builder.title': 'No suitable plugin? Start with a real problem.', 'builder.lead': 'Use the open-source build-dsh-plugin Skill to turn a problem, outcome, and success criterion into a standard project and evidence gates.',
    'builder.cardTitle': 'Three answers start the build.', 'builder.input1': 'What problem exists today?', 'builder.input2': 'What outcome should change?', 'builder.input3': 'How will success be observed?', 'builder.action': 'Open the plugin build lab',
    'builder.outputTitle': 'From brief to verifiable artifacts', 'builder.output1': 'Host compatibility', 'builder.output2': 'Risk and permissions', 'builder.output3': 'Standard source project', 'builder.output4': 'Evidence level', 'builder.note': 'Real Profile changes, restart, and release remain separately confirmed steps.',
    'featured.title': 'Featured plugins for better DSH workflows.', 'featured.lead': 'Discover practical plugins for automation, knowledge, and development with traceable sources and transparent details. Review capabilities and permissions before connecting.',
    'catalog.title': 'Find the capability you need', 'catalog.lead': 'Catalog declarations come from GitHub. Unverified security, permission, or compatibility facts remain visibly unknown.', 'catalog.search': 'Search plugins, capabilities, or GitHub repositories', 'catalog.sort': 'Sort', 'catalog.loading': 'Reading catalog…',
    'automation.title': 'See whether automation succeeded at a glance.', 'automation.lead': 'This shows new-plugin discovery, upstream version checks for every historical listing, the four-surface watchdog, and actual changes.',
    'automation.overall': 'Overall status', 'automation.scanner': 'Plugin and version scanner', 'automation.watchdog': 'Four-surface watchdog', 'automation.latestChange': 'Latest scan changes',
    'automation.scannerNote': 'Discovers plugins and checks every listed upstream version every 3 hours', 'automation.watchdogNote': 'GitHub, Pages, international, and China sites', 'automation.changeUnit': 'added / updated',
    'automation.sourceCheck': 'Historical version check', 'automation.sourceCheckUnit': 'checked / newer upstream / updated',
    'automation.recent': 'Recent automatic additions', 'automation.recentTitle': 'What was added', 'automation.recentUpdates': 'Recent upstream updates', 'automation.recentUpdatesTitle': 'Which plugin versions changed',
    'automation.noUpdates': 'No fixed-source version update passed review in the available recent runs.', 'automation.loading': 'Reading recent workflow evidence…', 'automation.evidence': 'View GitHub run evidence ↗',
    'catalog.gatewayKicker': 'Explore more capabilities', 'catalog.gatewayTitle': 'View every DSH plugin, permission, and compatibility detail',
    'sort.recommended': 'Latest official DSH compatibility and freshness', 'sort.name': 'Name A–Z', 'sort.recent': 'Recently updated', 'sort.risk': 'Lowest permission first',
    'view.trusted': 'Trusted install catalog', 'view.candidates': 'Candidate discovery', 'stats.candidates': 'candidates',
    'assurance.discovered': 'Discovered', 'assurance.installable': 'Installability', 'assurance.runtime': 'Runtime', 'assurance.security': 'Security review',
    'candidate.notice': 'Candidates are discovery-only: they have no install action and never enter a DSH operation plan. Promotion requires a pinned commit and the trusted catalog contract.',
    'candidate.search': 'Search candidate projects, topics, sources, or GitHub repositories', 'candidate.emptyTitle': 'The candidate registry is empty', 'candidate.emptyBody': 'Bulk candidate import has not started; the trusted install catalog is unaffected.',
    'status.available': 'Available', 'status.viewOnly': 'View only', 'status.unlisted': 'Unlisted',
    'empty.title': 'No matching plugins', 'empty.body': 'Try another query or clear the active category.', 'error.title': 'The catalog could not be loaded', 'error.body': 'Try again later or view the latest catalog on GitHub.',
    'safety.title': 'Trust is four inspectable states, not a slogan.', 'safety.lead': 'Listing is never a security audit. Source, permissions, change, and recovery stay separate, and unknown facts stay unknown.',
    'safety.card1.title': 'Pinned source', 'safety.card1.body': 'Installable entries point to a full 40-character Git commit, never a floating branch presented as stable.',
    'safety.card2.title': 'Visible permissions', 'safety.card2.body': 'File, network, command, and credential boundaries are shown before any operation.',
    'safety.card3.title': 'Plan before change', 'safety.card3.body': 'Every real change uses a new single-use plan with exact file scope.',
    'safety.card4.title': 'Recovery ready', 'safety.card4.body': 'Back up before execution, check health afterward, and restore the original state on failure.',
    'workflow.title': 'A safe flow can still be convenient.', 'workflow.lead': 'One entry point, one command, and one clear verification path. The system keeps the complexity; you keep the decision.',
    'workflow.step1.title': 'Find the right plugin', 'workflow.step1.body': 'Narrow the field by capability and use case, then inspect source, permissions, and compatibility.',
    'workflow.step2.title': 'Copy the pinned command', 'workflow.step2.body': 'The first screen shows the command and execution order without making you hunt through docs.', 'workflow.step3.title': 'Restart and open DSH Store', 'workflow.step3.body': 'Inspect and manage inside DSH, with runtime results kept distinct from test status.',
    'relation.title': 'How does DSH STORE connect to DeepSeek Harness?', 'relation.lead': 'It is a third-party discovery and management entry point for DeepSeek Harness, not a replacement for the official plugin inventory.',
    'relation.card1.title': 'Standard DSH integration', 'relation.card1.body': 'The manager connects as a Host Plugin and Client Bundle without changing DSH core or hiding the official inventory.',
    'relation.card2.title': 'One authoritative catalog', 'relation.card2.body': 'Runtime marketplace facts come from GitHub registry/catalog.json. Unverified security, permission, or compatibility facts stay visibly unknown.',
    'relation.card3.title': 'Browsing is separate from change', 'relation.card3.body': 'Browsing the site never writes to a Profile. Real installation uses the official DSH CLI with a plan, confirmation, backup, checks, and rollback.',
    'faq.title': 'Make the boundary clear before installing.', 'faq.q1': 'Does the website install plugins directly?', 'faq.a1': 'No. The site is for discovery and details only. Lifecycle actions require a confirmed plan inside DSH.',
    'faq.q2': 'Does “Available” mean security-audited?', 'faq.a2': 'No. It means the entry passes the current fixed-source, standard-bundle, and policy checks.', 'faq.q3': 'How should I choose a plugin?', 'faq.a3': 'Confirm the capability first, then review source, permissions, compatibility, and maintenance. Treat unknown information with caution.',
    'directory.title1': 'Discover plugins.', 'directory.title2': 'Extend DSH.', 'directory.lead': 'Find plugins by capability, name, permission, or repository. Every entry includes traceable source, version, permission, and compatibility details.',
    'directory.capacity': 'Your search terms stay in your browser', 'directory.capacityNote': 'Filtering and sorting never upload your query; catalog data comes from the traceable GitHub catalog.json.',
    'footer.lead': 'Technology feels clear when the system is clear; trust comes from inspectable boundaries.', 'footer.catalogLead': 'Discover plugins, review permissions, then decide whether to connect.', 'footer.note': 'Listing is not a security audit · Browsing never writes to your Profile', 'dialog.title': 'Plugin details',
    'value.unknown': 'Unknown', 'value.undeclared': 'Not declared', 'value.none': 'None', 'value.noStats': 'Stats disabled', 'filter.all': 'All',
    'catalog.failed': 'Catalog load failed', 'catalog.offline': 'Local catalog unavailable', 'catalog.meta': 'Showing {shown} / {total} plugins',
    'toast.commandCopied': 'Install command copied', 'toast.copyDenied': 'Clipboard access was denied. Select the command manually.', 'toast.commitCopied': 'Commit copied',
    'dialog.basic': 'Basic information', 'dialog.permissions': 'Permission profile', 'dialog.review': 'Review and compatibility', 'dialog.policy': 'Marketplace policy: ',
    'dialog.note': 'Details come from GitHub catalog.json declarations and pinned-commit verification. Listing, scanning, or review is not a complete security audit, and this website never changes your DSH Profile.',
  },
}

const formatText = (template, values = {}) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template)
const t = (key, values) => formatText(translations[state?.locale || 'zh']?.[key] || translations.zh[key] || key, values)

const state = {
  catalog: null,
  dshReleaseContext: null,
  entries: [],
  candidates: [],
  catalogView: 'trusted',
  query: '',
  category: '',
  sort: 'recommended',
  page: 1,
  pageSize: 24,
  catalogRequestId: 0,
  candidatesLoaded: false,
  candidatesLoading: false,
  automationStatus: null,
  locale: localStorage.getItem('dsh-marketplace-locale') === 'en' ? 'en' : 'zh',
  selectedEntry: null,
}

const els = {
  search: document.querySelector('#search'),
  sort: document.querySelector('#sort'),
  categories: document.querySelector('#category-pills'),
  clear: document.querySelector('#clear-filter'),
  emptyClear: document.querySelector('#empty-clear'),
  meta: document.querySelector('#catalog-meta'),
  grid: document.querySelector('#plugin-grid'),
  empty: document.querySelector('#empty-state'),
  error: document.querySelector('#load-error'),
  retry: document.querySelector('#retry-catalog'),
  pagination: document.querySelector('#catalog-pagination'),
  previousPage: document.querySelector('#previous-page'),
  nextPage: document.querySelector('#next-page'),
  pageButtons: document.querySelector('#page-buttons'),
  pageStatus: document.querySelector('#page-status'),
  featured: document.querySelector('#featured-grid'),
  preview: document.querySelector('#hero-preview'),
  dialog: document.querySelector('#plugin-dialog'),
  dialogTitle: document.querySelector('#dialog-title'),
  dialogKicker: document.querySelector('#dialog-kicker'),
  dialogBody: document.querySelector('#dialog-body'),
  toast: document.querySelector('#toast'),
  viewTabs: document.querySelector('#catalog-view-tabs'),
  legend: document.querySelector('.result-row .legend'),
  emptyTitle: document.querySelector('#empty-state h3'),
  emptyBody: document.querySelector('#empty-state p'),
}

const labels = {
  zh: {
    pluginType: { feature: '功能插件', theme: '主题', suite: '套件', client: '客户端', provider: 'Provider', unknown: '未知' },
    installSource: { npm: 'npm', github: 'GitHub', 'local-bundle': '本地 Bundle', unknown: '未知' },
    level: { low: '低', medium: '中', high: '高', unknown: '未知' },
    files: { none: '不访问', 'read-only': '只读', write: '可写', unknown: '未知' },
    network: { none: '无', 'specified-services': '指定服务', any: '任意网络', unknown: '未知' },
    commands: { none: '不执行', restricted: '受限命令', shell: '任意 Shell', unknown: '未知' },
    credentials: { none: '不访问', 'api-key': 'API Key', oauth: 'OAuth', keychain: '系统 Keychain', unknown: '未知' },
    reviewStatus: { unreviewed: '未审核', 'automated-scan': '自动扫描', 'manual-review': '人工检查', 'author-verified': '作者认证' },
  },
  en: {
    pluginType: { feature: 'Feature', theme: 'Theme', suite: 'Suite', client: 'Client', provider: 'Provider', unknown: 'Unknown' },
    installSource: { npm: 'npm', github: 'GitHub', 'local-bundle': 'Local bundle', unknown: 'Unknown' },
    level: { low: 'Low', medium: 'Medium', high: 'High', unknown: 'Unknown' },
    files: { none: 'No access', 'read-only': 'Read only', write: 'Write', unknown: 'Unknown' },
    network: { none: 'None', 'specified-services': 'Named services', any: 'Any network', unknown: 'Unknown' },
    commands: { none: 'None', restricted: 'Restricted', shell: 'Any shell', unknown: 'Unknown' },
    credentials: { none: 'No access', 'api-key': 'API key', oauth: 'OAuth', keychain: 'System Keychain', unknown: 'Unknown' },
    reviewStatus: { unreviewed: 'Unreviewed', 'automated-scan': 'Automated scan', 'manual-review': 'Manual review', 'author-verified': 'Author verified' },
  },
}

const englishCategories = {
  marketplace: 'Marketplace', management: 'Management', sessions: 'Sessions & messages', import: 'Import & migration', models: 'Models & accounts', routing: 'Model routing',
  ui: 'UI enhancements', themes: 'Themes', memory: 'Memory', tools: 'Tools', workflow: 'Workflow & automation', notifications: 'Notifications & integrations',
  development: 'Development & runtime', fun: 'Fun', files: 'Files & input', visualization: 'Visualization', design: 'Design & prototyping', search: 'Search & web',
  suites: 'Suites', clients: 'Clients & ecosystem', security: 'Security & privacy', experimental: 'Experimental',
}

const palette = ['#6f83ff', '#ff6c4a', '#8c6ce8', '#00a991', '#e0568c', '#4385c6', '#a36c45', '#6a9f39']
const riskOrder = { low: 0, medium: 1, high: 2, unknown: 3 }
const analyticsToken = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const detailLabel = (group, value) => labels[state.locale]?.[group]?.[value] || String(value || t('value.unknown'))
const categoryLabel = id => state.locale === 'en' ? englishCategories[id] || id : state.catalog?.registry?.categories?.[id] || id
const initials = name => String(name || 'DSH').replace(/^DSH\s*/i, '').split(/[\s_-]+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'D'
const pluginColor = id => palette[[...String(id)].reduce((total, character) => total + character.charCodeAt(0), 0) % palette.length]
const statusLabel = entry => entry.status === 'approved' ? t('status.available') : entry.status === 'blocked' ? t('status.viewOnly') : t('status.unlisted')
const listLabel = (items, fallback = t('value.undeclared')) => Array.isArray(items) && items.length ? items.join(' / ') : fallback
const DSH_VERSION_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest'
const DSH_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const LEGACY_DSH_VERSIONS = { 'rc.5': '0.0.1-rc.5', 'rc.6': '0.1.0-rc.6', 'rc.7': '0.1.0-rc.7', 'rc.8': '0.1.0-rc.8', '0.1.1-rc.1': '0.1.1-rc.1' }
const OPERATION_KEYS = ['install', 'start', 'uninstall', 'rollback']
const unknownOperations = () => Object.fromEntries(OPERATION_KEYS.map(operation => [operation, 'unknown']))
function compareDshVersions(left, right) {
  const parse = version => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
    return match ? { numbers: match.slice(1, 4).map(Number), pre: match[4] || null } : null
  }
  const a = parse(left); const b = parse(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index += 1) if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1
  if (a.pre === b.pre) return 0
  if (a.pre === null) return 1
  if (b.pre === null) return -1
  return a.pre.localeCompare(b.pre, 'en', { numeric: true })
}
function dshVersionCompatibility(value, version) {
  if (!DSH_VERSION.test(version || '') || typeof value !== 'string' || value.trim() === '' || value.trim().toLowerCase() === 'unknown') return 'unknown'
  const clauses = value.trim().split('||').map(clause => clause.trim()).filter(Boolean)
  const parsedClauses = clauses.map(clause => {
    const tokens = [...clause.matchAll(/(?:^|\s)(>=|<=|>|<|\^|~|=)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)]
      .map(match => ({ operator: match[1] || '=', version: match[2] }))
    const residue = clause.replace(/(?:^|\s)(?:>=|<=|>|<|\^|~|=)?\s*\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g, '').trim()
    return residue === '' && tokens.length > 0 ? tokens : null
  })
  if (parsedClauses.length === 0 || parsedClauses.some(clause => clause === null)) return 'unknown'
  return parsedClauses.some(tokens => tokens.every(token => {
      const comparison = compareDshVersions(version, token.version)
      if (comparison === null) return false
      if (token.operator === '^' || token.operator === '~') {
        const target = token.version.match(/^(\d+)\.(\d+)\./)
        const candidate = version.match(/^(\d+)\.(\d+)\./)
        if (!target || !candidate || comparison < 0 || candidate[1] !== target[1]) return false
        return token.operator === '^' && Number(target[1]) > 0 ? true : candidate[2] === target[2]
      }
      return token.operator === '>=' ? comparison >= 0 : token.operator === '<=' ? comparison <= 0
        : token.operator === '>' ? comparison > 0 : token.operator === '<' ? comparison < 0 : comparison === 0
    })) ? 'compatible' : 'incompatible'
}
function createDshReleaseContext(entries, latestResult) {
  const byVersion = new Map()
  const add = key => {
    const version = LEGACY_DSH_VERSIONS[key] || (DSH_VERSION.test(key || '') ? key : null)
    if (!version) return
    const current = byVersion.get(version)
    if (current) { current.aliases.add(key); if (DSH_VERSION.test(key)) current.key = key; return }
    byVersion.set(version, { key, version, aliases: new Set([key]) })
  }
  Object.keys(LEGACY_DSH_VERSIONS).forEach(add)
  entries.forEach(entry => {
    Object.keys(entry?.compatibility?.dshReleases || {}).forEach(add)
    Object.keys(entry?.compatibility?.dshOperations || {}).forEach(add)
  })
  if (latestResult?.version) add(latestResult.version)
  const allReleases = [...byVersion.values()]
    .sort((left, right) => compareDshVersions(left.version, right.version) || left.version.localeCompare(right.version, 'en'))
  const officialLatestIndex = latestResult?.version ? allReleases.findIndex(release => release.version === latestResult.version) : -1
  const releases = officialLatestIndex >= 0
    ? allReleases.slice(Math.max(0, officialLatestIndex - 63), officialLatestIndex + 1)
    : allReleases.slice(-64)
  const latestVersion = latestResult?.version || releases.at(-1)?.version || null
  return {
    schemaVersion: 1, source: latestResult?.version ? 'npm-official' : 'catalog-fallback', latestVersion,
    checkedAt: latestResult?.checkedAt || null, registryUrl: latestResult?.version ? DSH_VERSION_URL : null,
    errorCode: latestResult?.errorCode || null,
    releases: releases.map(release => ({ ...release, aliases: [...release.aliases], label: release.version, latest: release.version === latestVersion })),
  }
}
function projectDshRelease(entry, release) {
  const compatibility = entry?.compatibility || {}
  const keys = [...new Set([release.key, ...(release.aliases || [])].filter(Boolean))]
  const declaredKey = keys.find(key => Object.hasOwn(compatibility.dshReleases || {}, key)) || null
  const operationKey = keys.find(key => Object.hasOwn(compatibility.dshOperations || {}, key)) || null
  const rangeStatus = dshVersionCompatibility(compatibility.dsh, release.version)
  return {
    ...release, declaredKey, rangeStatus, basis: declaredKey ? 'catalog' : rangeStatus === 'unknown' ? 'unknown' : 'range',
    status: declaredKey ? compatibility.dshReleases[declaredKey] : rangeStatus === 'incompatible' ? 'incompatible' : 'unknown',
    operations: { ...unknownOperations(), ...(operationKey ? compatibility.dshOperations[operationKey] : {}) },
  }
}
const compatibilityViewLabel = view => {
  if (view.basis === 'range') return state.locale === 'en'
    ? view.rangeStatus === 'compatible' ? 'Range supports · unverified' : view.rangeStatus === 'incompatible' ? 'Out of range' : 'Unknown'
    : view.rangeStatus === 'compatible' ? '范围支持·待验证' : view.rangeStatus === 'incompatible' ? '范围不支持' : '未声明'
  return state.locale === 'en'
    ? ({ compatible: 'OK', incompatible: 'No', unknown: 'Unknown' }[view.status] || 'Unknown')
    : ({ compatible: '兼容', incompatible: '不兼容', unknown: '未声明' }[view.status] || '未声明')
}
const compatibilityViewClass = view => view.basis === 'range'
  ? view.rangeStatus === 'incompatible' ? 'incompatible' : 'unknown'
  : ['compatible', 'incompatible'].includes(view.status) ? view.status : 'unknown'
const cardReleaseViews = views => {
  const latestIndex = views.findIndex(view => view.latest)
  const end = latestIndex < 0 ? views.length : latestIndex + 1
  return views.slice(Math.max(0, end - 3), end)
}
const compatibilityMatrix = (entry, all = false) => {
  const releases = all ? entry.compatibility.dshReleaseViews : cardReleaseViews(entry.compatibility.dshReleaseViews)
  return `<div class="compatibility-matrix" aria-label="${escape(state.locale === 'en' ? 'Latest DSH release compatibility' : '最新 DSH 版本兼容性')}">${releases.map(view => `<span class="compatibility-cell ${escape(compatibilityViewClass(view))}" title="${escape(`DSH ${view.version}: ${compatibilityViewLabel(view)}`)}"><b>${escape(view.version)}${view.latest ? escape(state.locale === 'en' ? ' · latest' : ' · 最新') : ''}</b><em>${escape(compatibilityViewLabel(view))}</em></span>`).join('')}</div>`
}
const evidenceStatusLabel = status => state.locale === 'en'
  ? ({ verified: 'Verified', failed: 'Failed', unknown: 'Unknown', 'not-applicable': 'N/A' }[status] || 'Unknown')
  : ({ verified: '已验证', failed: '未通过', unknown: '未知', 'not-applicable': '不适用' }[status] || '未知')
const assuranceRail = entry => {
  const items = [
    ['discovery', t('assurance.discovered')], ['installability', t('assurance.installable')],
    ['runtime', t('assurance.runtime')], ['securityReview', t('assurance.security')],
  ]
  return `<div class="assurance-rail" aria-label="${escape(state.locale === 'en' ? 'Trust evidence' : '可信证据')}">${items.map(([key, label]) => {
    const record = entry.assurance?.[key] || { status: 'unknown' }
    return `<span class="assurance-item assurance-${escape(record.status)}" title="${escape(record.summary || evidenceStatusLabel(record.status))}"><b>${escape(label)}</b><em>${escape(evidenceStatusLabel(record.status))}</em></span>`
  }).join('')}</div>`
}
const operationEvidenceText = entry => entry.compatibility.dshReleaseViews.map(view => {
  const record = view.operations
  const label = value => state.locale === 'en'
    ? ({ passed: 'Pass', failed: 'Fail', unknown: 'Unknown' }[value] || 'Unknown')
    : ({ passed: '通过', failed: '失败', unknown: '未知' }[value] || '未知')
  return `${view.version}: ${state.locale === 'en' ? 'install' : '安装'} ${label(record.install)} / ${state.locale === 'en' ? 'start' : '启动'} ${label(record.start)} / ${state.locale === 'en' ? 'uninstall' : '卸载'} ${label(record.uninstall)} / ${state.locale === 'en' ? 'rollback' : '回滚'} ${label(record.rollback)}`
}).join(' · ')
const licenseLabel = value => {
  if (!value || value === 'UNKNOWN') return t('value.unknown')
  if (value === 'UNLICENSED') return state.locale === 'en' ? 'License not published' : '未公开许可证'
  if (value === 'CC-BY-NC-SA-4.0') return state.locale === 'en' ? 'Non-commercial (CC BY-NC-SA 4.0)' : '非商业（CC BY-NC-SA 4.0）'
  return value
}

function normalizeEntry(entry, releaseContext) {
  const details = entry?.details && typeof entry.details === 'object' ? entry.details : {}
  const permissions = details.permissions && typeof details.permissions === 'object' ? details.permissions : {}
  const compatibility = entry?.compatibility && typeof entry.compatibility === 'object' ? entry.compatibility : {}
  const dshReleases = compatibility.dshReleases && typeof compatibility.dshReleases === 'object' ? compatibility.dshReleases : {}
  const dshOperations = compatibility.dshOperations && typeof compatibility.dshOperations === 'object' ? compatibility.dshOperations : {}
  const dshReleaseViews = releaseContext.releases.map(release => projectDshRelease({ compatibility: { ...compatibility, dshReleases, dshOperations } }, release))
  const assurance = entry?.assurance && typeof entry.assurance === 'object' ? entry.assurance : {}
  const evidence = (record, fallback = 'unknown') => ({
    status: record?.status || fallback, method: record?.method || null, checkedAt: record?.checkedAt || null,
    evidenceUrl: record?.evidenceUrl || null, summary: record?.summary || null,
  })
  return {
    ...entry,
    searchTerms: Array.isArray(entry?.searchTerms) ? entry.searchTerms : [],
    categories: Array.isArray(entry?.categories) ? entry.categories : [],
    details: {
      pluginType: details.pluginType || 'unknown',
      installSource: details.installSource || 'unknown',
      license: details.license || 'UNKNOWN',
      reviewStatus: details.reviewStatus || 'unreviewed',
      externalDependencies: Array.isArray(details.externalDependencies) ? details.externalDependencies : [],
      permissions: {
        level: permissions.level || 'unknown',
        files: permissions.files || 'unknown',
        network: permissions.network || 'unknown',
        commands: permissions.commands || 'unknown',
        credentials: Array.isArray(permissions.credentials) && permissions.credentials.length ? permissions.credentials : ['unknown'],
      },
    },
    compatibility: {
      dsh: compatibility.dsh || 'unknown',
      dshReleases,
      dshOperations,
      dshReleaseViews,
      node: compatibility.node || 'unknown',
      systems: Array.isArray(compatibility.systems) ? compatibility.systems : [],
      profiles: Array.isArray(compatibility.profiles) ? compatibility.profiles : [],
    },
    source: {
      updatedAt: entry?.source?.updatedAt || entry?.github?.pushedAt || entry?.github?.updatedAt || null,
      observedAt: entry?.source?.observedAt || null,
      provenance: entry?.source?.provenance || (entry?.github?.pushedAt ? 'github-repository' : 'unknown'),
    },
    assurance: {
      discovery: evidence(assurance.discovery, 'verified'), installability: evidence(assurance.installability),
      runtime: evidence(assurance.runtime), securityReview: evidence(assurance.securityReview),
    },
  }
}

function searchValues(entry) {
  const permissions = entry.details.permissions
  return [
    entry.name, entry.packageName, entry.description, entry.repositoryUrl, entry.version, ...entry.searchTerms,
    ...entry.categories.map(categoryLabel), detailLabel('pluginType', entry.details.pluginType),
    detailLabel('level', permissions.level), detailLabel('files', permissions.files),
    detailLabel('network', permissions.network), detailLabel('commands', permissions.commands),
    ...permissions.credentials.map(value => detailLabel('credentials', value)),
    detailLabel('reviewStatus', entry.details.reviewStatus), ...entry.details.externalDependencies,
    ...entry.compatibility.systems, ...entry.compatibility.profiles, entry.compatibility.dsh,
    ...Object.entries(entry.compatibility.dshReleases || {}).flat(),
    entry.source?.updatedAt, ...Object.values(entry.assurance || {}).flatMap(record => [record.status, record.method, record.summary]),
  ].map(value => String(value || '').toLowerCase())
}

function visibleCandidates() {
  const query = state.query.trim().toLowerCase()
  return state.candidates
    .filter(entry => entry.status !== 'rejected')
    .filter(entry => !query || [entry.id, entry.name, entry.description, entry.repositoryUrl, entry.route, ...(entry.discoverySources || []), ...(entry.topics || [])]
      .some(value => String(value || '').toLowerCase().includes(query)))
    .sort((a, b) => (Date.parse(b.sourceUpdatedAt || b.discoveredAt) || 0) - (Date.parse(a.sourceUpdatedAt || a.discoveredAt) || 0)
      || String(a.name).localeCompare(String(b.name), state.locale === 'en' ? 'en' : 'zh-CN'))
}

function visibleEntries() {
  const query = state.query.trim().toLowerCase()
  const entries = state.entries
    .filter(entry => entry.status !== 'unlisted')
    .filter(entry => !state.category || entry.categories.includes(state.category))
    .filter(entry => !query || searchValues(entry).some(value => value.includes(query)))

  return entries.sort((a, b) => {
    const locale = state.locale === 'en' ? 'en' : 'zh-CN'
    const compatibilityRank = entry => {
      const view = entry.compatibility.dshReleaseViews.find(item => item.latest) || entry.compatibility.dshReleaseViews.at(-1)
      if (view?.basis === 'catalog' && view.status === 'compatible') return 0
      if (view?.basis === 'range' && view.rangeStatus === 'compatible') return 1
      if (!view || view.status === 'unknown') return 2
      return 3
    }
    const freshness = entry => Date.parse(entry.source?.updatedAt || entry.github?.pushedAt || entry.github?.updatedAt || '') || 0
    if (state.sort === 'name') return a.name.localeCompare(b.name, locale)
    if (state.sort === 'risk') return (riskOrder[a.details.permissions.level] ?? 3) - (riskOrder[b.details.permissions.level] ?? 3) || a.name.localeCompare(b.name, locale)
    if (state.sort === 'recent') return compatibilityRank(a) - compatibilityRank(b) || freshness(b) - freshness(a) || a.name.localeCompare(b.name, locale)
    return compatibilityRank(a) - compatibilityRank(b) || freshness(b) - freshness(a) || Number(b.featured === true) - Number(a.featured === true) || (b.installCount ?? -1) - (a.installCount ?? -1) || String(b.version).localeCompare(String(a.version), undefined, { numeric: true }) || a.name.localeCompare(b.name, locale)
  })
}

function renderStats() {
  const entries = state.entries.filter(entry => entry.status !== 'unlisted')
  const categoryCount = new Set(entries.flatMap(entry => entry.categories)).size
  const setText = (selector, value) => {
    const element = document.querySelector(selector)
    if (element) element.textContent = value
  }
  setText('#stat-total', String(entries.length).padStart(2, '0'))
  setText('#stat-approved', String(entries.filter(entry => entry.status === 'approved').length).padStart(2, '0'))
  setText('#stat-categories', String(categoryCount).padStart(2, '0'))
  if (state.candidatesLoaded) setText('#stat-candidates', String(state.candidates.length).padStart(2, '0'))
  setText('#float-count', String(entries.length))
  const updatedAt = state.catalog?.registry?.updatedAt
  setText('#catalog-date', updatedAt
    ? `catalog.json · ${new Intl.DateTimeFormat(state.locale === 'en' ? 'en' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(updatedAt))}`
    : 'GitHub catalog.json')
}

function renderManagerMetadata() {
  const manager = state.entries.find(entry => entry.id === 'dsh-safe-plugin-manager')
  if (!manager) return
  const installCommand = `dsh plugin --profile web add 'git+${manager.repositoryUrl}.git#${manager.commit}'`
  const values = {
    '#install-version': `v${manager.version} · SHA PINNED`,
    '#install-command': installCommand,
    '#manager-protocol': `STANDARD BUNDLE / v${manager.version}`,
    '#manager-commit-short': manager.commit.slice(0, 7),
  }
  Object.entries(values).forEach(([selector, value]) => {
    const element = document.querySelector(selector)
    if (element) element.textContent = value
  })
}

function renderHeroPreview() {
  if (!els.preview) return
  const featured = state.entries.filter(entry => entry.featured === true && entry.status === 'approved').slice(0, 3)
  els.preview.innerHTML = featured.map((entry, index) => `
    <article class="preview-plugin" style="--plugin-color:${pluginColor(entry.id)}">
      <span class="preview-icon">${escape(initials(entry.name))}</span>
      <span><b>${escape(entry.name)}</b><small>${escape(categoryLabel(entry.categories[0] || 'tools'))} · v${escape(entry.version)}</small></span>
      <em>${index === 0 ? 'FEATURED' : 'FIXED'}</em>
    </article>`).join('')
}

function renderFeatured() {
  if (!els.featured) return
  const featured = state.entries.filter(entry => entry.featured === true && entry.status === 'approved').slice(0, 4)
  els.featured.innerHTML = featured.map((entry, index) => `
    <article class="featured-card reveal" style="--plugin-color:${pluginColor(entry.id)}">
      <div class="featured-top"><span class="feature-number">PICK / 0${index + 1}</span><span class="dialog-badge">${escape(categoryLabel(entry.categories[0] || 'tools'))}</span></div>
      <span class="featured-icon" aria-hidden="true"><span>${escape(initials(entry.name))}</span></span>
      <h3>${escape(entry.name)}</h3>
      <p>${escape(entry.description)}</p>
      <button class="featured-link details-button" type="button" data-details-id="${escape(entry.id)}"><span>${escape(t('action.details'))}</span><i aria-hidden="true">↗</i></button>
    </article>`).join('')
  observeReveals()
}

function renderCategories() {
  if (!els.categories) return
  const counts = new Map()
  state.entries.filter(entry => entry.status !== 'unlisted').forEach(entry => entry.categories.forEach(id => counts.set(id, (counts.get(id) || 0) + 1)))
  const ids = [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  els.categories.innerHTML = [
    `<button class="category-pill${state.category ? '' : ' active'}" type="button" data-category="" aria-pressed="${state.category ? 'false' : 'true'}">${escape(t('filter.all'))} <span>${state.entries.filter(entry => entry.status !== 'unlisted').length}</span></button>`,
    ...ids.map(id => `<button class="category-pill${state.category === id ? ' active' : ''}" type="button" data-category="${escape(id)}" aria-pressed="${state.category === id ? 'true' : 'false'}">${escape(categoryLabel(id))} <span>${counts.get(id)}</span></button>`),
  ].join('')
  if (els.clear) els.clear.hidden = !state.category && !state.query
}

function cardTemplate(entry) {
  const permissions = entry.details.permissions
  const topCategories = entry.categories.slice(0, 2)
  return `<article class="plugin-card" style="--plugin-color:${pluginColor(entry.id)}">
    <div class="plugin-card-top">
      <span class="plugin-card-icon" aria-hidden="true">${escape(initials(entry.name))}</span>
      <span class="status-tag${entry.status === 'approved' ? '' : ' blocked'}">${statusLabel(entry)}</span>
    </div>
    <h3>${escape(entry.name)}</h3>
    <span class="package-line">${escape(entry.packageName)} · v${escape(entry.version)}</span>
    <p class="plugin-description">${escape(entry.description)}</p>
    <div class="plugin-badges">
      ${topCategories.map(id => `<span class="plugin-badge">${escape(categoryLabel(id))}</span>`).join('')}
      <span class="plugin-badge risk-${escape(permissions.level)}">${escape(detailLabel('level', permissions.level))}${state.locale === 'en' ? ' permission' : '权限'}</span>
    </div>
    ${compatibilityMatrix(entry)}
    ${assuranceRail(entry)}
    <footer class="plugin-card-footer">
      <button class="details-button" type="button" data-details-id="${escape(entry.id)}">${escape(t('action.details'))} →</button>
      <a class="repo-link" href="${escape(entry.repositoryUrl)}" target="_blank" rel="noreferrer" aria-label="${escape(t('action.repo'))}: ${escape(entry.name)}" data-repo-id="${escape(entry.id)}">↗</a>
    </footer>
  </article>`
}

function candidateCardTemplate(entry) {
  const updated = entry.sourceUpdatedAt || entry.discoveredAt
  const date = updated ? new Intl.DateTimeFormat(state.locale === 'en' ? 'en' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(updated)) : t('value.unknown')
  return `<article class="plugin-card candidate-card" style="--plugin-color:${pluginColor(entry.id)}">
    <div class="plugin-card-top"><span class="plugin-card-icon" aria-hidden="true">${escape(initials(entry.name))}</span><span class="status-tag blocked">${escape(t('assurance.discovered'))}</span></div>
    <h3>${escape(entry.name)}</h3><span class="package-line">${escape(entry.route)} · ${escape(date)}</span>
    <p class="plugin-description">${escape(entry.description)}</p>
    <div class="assurance-rail"><span class="assurance-item assurance-verified"><b>${escape(t('assurance.discovered'))}</b><em>${escape(evidenceStatusLabel('verified'))}</em></span><span class="assurance-item assurance-unknown"><b>${escape(t('assurance.installable'))}</b><em>${escape(evidenceStatusLabel('unknown'))}</em></span><span class="assurance-item assurance-unknown"><b>${escape(t('assurance.runtime'))}</b><em>${escape(evidenceStatusLabel('unknown'))}</em></span><span class="assurance-item assurance-unknown"><b>${escape(t('assurance.security'))}</b><em>${escape(evidenceStatusLabel('unknown'))}</em></span></div>
    <footer class="plugin-card-footer"><span class="candidate-no-install">${escape(state.locale === 'en' ? 'No install action' : '无安装操作')}</span><a class="repo-link" href="${escape(entry.repositoryUrl)}" target="_blank" rel="noreferrer" data-repo-id="${escape(entry.id)}">↗</a></footer>
  </article>`
}

function renderCatalog() {
  if (!state.catalog || !els.grid || !els.meta || !els.empty) return
  const candidateView = state.catalogView === 'candidates'
  if (candidateView && state.candidatesLoading) {
    els.grid.hidden = true
    els.empty.hidden = true
    els.meta.textContent = t('catalog.loading')
    if (els.pagination) els.pagination.hidden = true
    return
  }
  const matchingEntries = candidateView ? visibleCandidates() : visibleEntries()
  const total = matchingEntries.length
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize))
  state.page = Math.min(state.page, pageCount)
  const start = (state.page - 1) * state.pageSize
  const entries = matchingEntries.slice(start, start + state.pageSize)
  els.grid.innerHTML = entries.map(candidateView ? candidateCardTemplate : cardTemplate).join('')
  els.grid.hidden = entries.length === 0
  els.empty.hidden = entries.length !== 0
  els.meta.innerHTML = candidateView
    ? `<b>${entries.length}</b> / ${matchingEntries.length} · ${escape(t('candidate.notice'))}`
    : `${escape(t('catalog.meta', { shown: entries.length, total }))}${state.category ? ` · ${escape(categoryLabel(state.category))}` : ''}`.replace(String(entries.length), `<b>${entries.length}</b>`)
  if (els.pagination) els.pagination.hidden = total <= state.pageSize
  if (els.previousPage) {
    els.previousPage.disabled = state.page <= 1
    els.previousPage.querySelector('span').textContent = t('action.previous')
  }
  if (els.nextPage) {
    els.nextPage.disabled = state.page >= pageCount
    els.nextPage.querySelector('span').textContent = t('action.next')
  }
  if (els.pageStatus) els.pageStatus.textContent = state.locale === 'en'
    ? `Page ${state.page} of ${pageCount}`
    : `第 ${state.page} / ${pageCount} 页`
  if (els.pageButtons) {
    const first = Math.max(1, Math.min(state.page - 2, pageCount - 4))
    const last = Math.min(pageCount, first + 4)
    const pages = []
    for (let page = first; page <= last; page += 1) pages.push(page)
    els.pageButtons.innerHTML = pages.map(page => `<button type="button" data-page="${page}"${page === state.page ? ' class="active" aria-current="page"' : ''}>${page}</button>`).join('')
  }
  if (els.categories?.parentElement) els.categories.parentElement.hidden = candidateView
  if (els.sort?.parentElement) els.sort.parentElement.hidden = candidateView
  if (els.legend) els.legend.hidden = candidateView
  if (els.search) els.search.setAttribute('placeholder', t(candidateView ? 'candidate.search' : 'catalog.search'))
  if (els.emptyTitle) els.emptyTitle.textContent = t(candidateView ? 'candidate.emptyTitle' : 'empty.title')
  if (els.emptyBody) els.emptyBody.textContent = t(candidateView ? 'candidate.emptyBody' : 'empty.body')
  if (els.emptyClear) els.emptyClear.hidden = candidateView ? !state.query : false
  if (!candidateView) renderCategories()
}

function detailItem(name, value, code = false) {
  return `<div class="detail-item"><dt>${escape(name)}</dt><dd${code ? ' class="package-line"' : ''}>${escape(value)}</dd></div>`
}

function showDetails(entry) {
  const permissions = entry.details.permissions
  const compatibility = entry.compatibility
  const github = entry.github && typeof entry.github === 'object' ? entry.github : {}
  const color = pluginColor(entry.id)
  state.selectedEntry = entry
  els.dialogTitle.textContent = entry.name
  els.dialogKicker.textContent = `${entry.status === 'approved' ? 'AVAILABLE' : 'VIEW ONLY'} / ${entry.packageName}`
  els.dialogBody.innerHTML = `
    <div class="dialog-intro" style="--plugin-color:${color}">
      <span class="dialog-icon" aria-hidden="true">${escape(initials(entry.name))}</span>
      <div><p>${escape(entry.description)}</p><div class="dialog-badges">
        <span class="dialog-badge">${statusLabel(entry)}</span>${entry.featured ? `<span class="dialog-badge">${escape(t('tab.featured'))}</span>` : ''}
        ${entry.categories.map(id => `<span class="dialog-badge">${escape(categoryLabel(id))}</span>`).join('')}
      </div></div>
    </div>
    <section class="dialog-section"><h3>${escape(t('dialog.basic'))}</h3><dl class="dialog-grid">
      ${detailItem(state.locale === 'en' ? 'Package' : '包名', entry.packageName, true)}${detailItem(state.locale === 'en' ? 'Version' : '版本', entry.version)}
      ${detailItem('Git Commit', entry.commit || t('value.undeclared'), true)}${detailItem(state.locale === 'en' ? 'License' : '许可证', licenseLabel(entry.details.license))}
      ${detailItem(state.locale === 'en' ? 'Plugin type' : '插件类型', detailLabel('pluginType', entry.details.pluginType))}${detailItem(state.locale === 'en' ? 'Install source' : '安装来源', detailLabel('installSource', entry.details.installSource))}
    </dl></section>
    <section class="dialog-section"><h3>${escape(t('dialog.permissions'))}</h3><div class="permission-grid">
      <div class="permission"><span>${state.locale === 'en' ? 'Level' : '权限等级'}</span><b>${escape(detailLabel('level', permissions.level))}</b></div>
      <div class="permission"><span>${state.locale === 'en' ? 'Files' : '文件'}</span><b>${escape(detailLabel('files', permissions.files))}</b></div>
      <div class="permission"><span>${state.locale === 'en' ? 'Network' : '网络'}</span><b>${escape(detailLabel('network', permissions.network))}</b></div>
      <div class="permission"><span>${state.locale === 'en' ? 'Commands' : '命令'}</span><b>${escape(detailLabel('commands', permissions.commands))}</b></div>
    </div></section>
    <section class="dialog-section"><h3>${escape(t('dialog.review'))}</h3><dl class="dialog-grid">
      ${detailItem(state.locale === 'en' ? 'Credential access' : '凭据访问', listLabel(permissions.credentials.map(value => detailLabel('credentials', value)), t('value.unknown')))}
      ${detailItem(state.locale === 'en' ? 'Review status' : '审核状态', detailLabel('reviewStatus', entry.details.reviewStatus))}
      ${detailItem('DSH', compatibility.dsh === 'unknown' ? t('value.undeclared') : compatibility.dsh)}${detailItem('Node.js', compatibility.node === 'unknown' ? t('value.undeclared') : compatibility.node)}
      ${detailItem(state.locale === 'en' ? 'DSH version compatibility' : 'DSH 版本兼容性', compatibility.dshReleaseViews.map(view => `${view.version}${view.latest ? (state.locale === 'en' ? ' (latest)' : '（最新）') : ''}: ${compatibilityViewLabel(view)}`).join(' · '))}
      ${detailItem(state.locale === 'en' ? 'Lifecycle evidence' : '安装/启动/卸载/回滚证据', operationEvidenceText(entry))}
      ${detailItem(t('assurance.installable'), evidenceStatusLabel(entry.assurance.installability.status))}${detailItem(t('assurance.runtime'), evidenceStatusLabel(entry.assurance.runtime.status))}
      ${detailItem(t('assurance.security'), evidenceStatusLabel(entry.assurance.securityReview.status))}${detailItem(state.locale === 'en' ? 'Source updated' : '来源最近更新', entry.source.updatedAt ? new Intl.DateTimeFormat(state.locale === 'en' ? 'en' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(entry.source.updatedAt)) : t('value.unknown'))}
      ${detailItem(state.locale === 'en' ? 'Systems' : '系统', listLabel(compatibility.systems))}${detailItem('Profile', listLabel(compatibility.profiles))}
      ${detailItem(state.locale === 'en' ? 'External dependencies' : '外部依赖', listLabel(entry.details.externalDependencies, t('value.none')))}${detailItem(state.locale === 'en' ? 'Installs' : '累计安装', Number.isInteger(entry.installCount) ? String(entry.installCount) : t('value.noStats'))}
      ${Number.isInteger(github.stars) ? detailItem('GitHub Stars', String(github.stars)) : ''}${github.pushedAt ? detailItem(state.locale === 'en' ? 'Last GitHub push' : 'GitHub 最近更新', new Intl.DateTimeFormat(state.locale === 'en' ? 'en' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(github.pushedAt))) : ''}
    </dl></section>
    ${entry.statusReason ? `<p class="dialog-note danger"><b>${escape(t('dialog.policy'))}</b>${escape(entry.statusReason)}</p>` : ''}
    <p class="dialog-note">${escape(t('dialog.note'))}</p>
    <div class="dialog-actions">
      <button class="copy-button" type="button" data-copy-commit="${escape(entry.commit || '')}">${escape(t('action.copyCommit'))}</button>
      <a class="dialog-repo" href="${escape(entry.repositoryUrl)}" target="_blank" rel="noreferrer" data-repo-id="${escape(entry.id)}">${escape(entry.status === 'blocked' ? t('action.manual') : t('action.repo'))} <span aria-hidden="true">↗</span></a>
    </div>`
  els.dialog.showModal()
}

function clearFilters() {
  state.query = ''
  state.category = ''
  state.page = 1
  if (els.search) els.search.value = ''
  renderCatalog()
}

let toastTimer
function showToast(message) {
  els.toast.textContent = message
  els.toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800)
}

function applyLocale() {
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN'
  document.title = t(IS_DIRECTORY ? 'directory.meta.title' : 'meta.title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', t(IS_DIRECTORY ? 'directory.meta.description' : 'meta.description'))
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n)
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder))
  })
  document.querySelectorAll('[data-locale]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.locale === state.locale))
  })
  els.search?.setAttribute('aria-label', t('catalog.search'))
  els.categories?.setAttribute('aria-label', state.locale === 'en' ? 'Filter by category' : '按分类筛选')
  document.querySelector('#dialog-close')?.setAttribute('aria-label', state.locale === 'en' ? 'Close plugin details' : '关闭插件详情')
  if (document.querySelector('[data-automation-overall]')) renderAutomationStatus()

  if (state.catalog) {
    renderStats()
    renderManagerMetadata()
    renderHeroPreview()
    renderFeatured()
    renderCatalog()
    if (els.dialog?.open && state.selectedEntry) {
      els.dialog.close()
      showDetails(state.selectedEntry)
    }
  }
}

function setLocale(locale) {
  if (!['zh', 'en'].includes(locale) || locale === state.locale) return
  state.locale = locale
  localStorage.setItem('dsh-marketplace-locale', locale)
  applyLocale()
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {}
  }
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('clipboard unavailable')
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
  const observer = new IntersectionObserver((entries, instance) => entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible')
      instance.unobserve(entry.target)
    }
  }), { threshold: 0.08 })
  document.querySelectorAll('.reveal:not(.visible)').forEach(element => observer.observe(element))
}

async function loadInstallCounts() {
  const url = state.catalog?.registry?.installCountsUrl
  if (!url) return
  try {
    const response = await fetch(url, { cache: 'no-store' })
    const text = await response.text()
    if (text.length > 64 * 1024) throw new Error('Official DSH package metadata is too large')
    const payload = JSON.parse(text)
    if (!response.ok || payload.schemaVersion !== 1 || !payload.counts) return
    state.entries.forEach(entry => {
      if (Number.isInteger(payload.counts[entry.id])) entry.installCount = payload.counts[entry.id]
    })
    renderCatalog()
  } catch {}
}

function catalogCandidates() {
  return [...new Set([
    new URL(CATALOG_URL, window.location.href).href,
    new URL('/registry/catalog.json', window.location.origin).href,
  ])]
}

function candidateRegistryUrls() {
  return [...new Set([
    new URL(CANDIDATES_URL, window.location.href).href,
    new URL('/registry/candidates.json', window.location.origin).href,
  ])]
}

async function fetchCatalog() {
  const failures = []
  for (const url of catalogCandidates()) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (!payload || !Array.isArray(payload.entries)) throw new Error('Invalid catalog payload')
      return payload
    } catch (error) {
      failures.push(`${url}: ${error.message}`)
    }
  }
  throw new Error(failures.join(' | '))
}

async function fetchLatestDshVersion() {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 2_500)
  try {
    const response = await fetch(DSH_VERSION_URL, {
      cache: 'no-store', credentials: 'omit', headers: { accept: 'application/json' }, signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    if (payload?.name !== '@deepseek-ai/dsh' || !DSH_VERSION.test(payload?.version || '')) throw new Error('Invalid official DSH package metadata')
    return { version: payload.version, checkedAt: new Date().toISOString(), errorCode: null }
  } catch (error) {
    return { version: null, checkedAt: null, errorCode: error?.name === 'AbortError' ? 'DSH_VERSION_TIMEOUT' : 'DSH_VERSION_UNAVAILABLE' }
  } finally {
    window.clearTimeout(timer)
  }
}

async function fetchCandidateRegistry(catalog) {
  if (catalog?.discovery && Array.isArray(catalog.discovery.entries)) return catalog.discovery
  for (const url of candidateRegistryUrls()) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) continue
      const payload = await response.json()
      if (payload?.registry?.trustBoundary?.installActionsDisabled !== true || !Array.isArray(payload.entries)) continue
      return payload
    } catch {}
  }
  return {
    registry: { trustBoundary: { installActionsDisabled: true, catalogPromotionRequired: true, unknownIsNotVerified: true } },
    entries: [],
  }
}

async function loadCatalog() {
  if (els.meta) els.meta.textContent = t('catalog.loading')
  if (els.error) els.error.hidden = true
  if (els.empty) els.empty.hidden = true
  if (els.pagination) els.pagination.hidden = true
  if (els.retry) els.retry.disabled = true
  const requestId = ++state.catalogRequestId
  const latestPromise = fetchLatestDshVersion()
  try {
    state.catalog = await fetchCatalog()
    state.dshReleaseContext = createDshReleaseContext(state.catalog.entries, null)
    state.entries = state.catalog.entries.map(entry => normalizeEntry(entry, state.dshReleaseContext))
    state.candidates = []
    state.candidatesLoaded = false
    state.page = 1
    renderStats()
    renderManagerMetadata()
    renderHeroPreview()
    renderFeatured()
    renderCatalog()
    loadInstallCounts()
    if (state.catalogView === 'candidates') void loadCandidates()
    void latestPromise.then(latestResult => {
      if (!state.catalog || requestId !== state.catalogRequestId) return
      state.dshReleaseContext = createDshReleaseContext(state.catalog.entries, latestResult)
      state.entries = state.catalog.entries.map(entry => normalizeEntry(entry, state.dshReleaseContext))
      renderStats()
      renderHeroPreview()
      renderFeatured()
      renderCatalog()
      loadInstallCounts()
    })
  } catch (error) {
    if (els.meta) els.meta.textContent = t('catalog.failed')
    const hasStaticCards = Boolean(els.grid?.querySelector('[data-static-plugin-id]'))
    if (els.grid) els.grid.hidden = !hasStaticCards
    if (els.empty) els.empty.hidden = true
    if (els.pagination) els.pagination.hidden = true
    if (els.error) els.error.hidden = hasStaticCards
    const catalogDate = document.querySelector('#catalog-date')
    if (catalogDate) catalogDate.textContent = t('catalog.offline')
    console.error('Failed to load marketplace catalog:', error)
  } finally {
    if (els.retry) els.retry.disabled = false
  }
}

const automationRunLabel = run => {
  if (!run) return state.locale === 'en' ? 'No evidence' : '暂无证据'
  if (run.status !== 'completed') return state.locale === 'en' ? 'Running' : '执行中'
  if (run.conclusion === 'success') return state.locale === 'en' ? 'Succeeded' : '执行成功'
  return state.locale === 'en' ? 'Failed' : '执行失败'
}

function renderAutomationStatus() {
  const status = state.automationStatus
  const overall = status?.overall?.status ?? 'unknown'
  const overallLabel = state.locale === 'en'
    ? ({ passed: 'Healthy', failed: 'Attention needed', running: 'Running', unknown: 'No evidence' }[overall] || 'No evidence')
    : ({ passed: '运行正常', failed: '执行异常', running: '正在执行', unknown: '暂无证据' }[overall] || '暂无证据')
  document.querySelectorAll('[data-automation-overall]').forEach(node => { node.textContent = overallLabel })
  document.querySelectorAll('[data-automation-card="overall"]').forEach(node => { node.dataset.state = overall })
  document.querySelectorAll('[data-automation-scan]').forEach(node => { node.textContent = automationRunLabel(status?.scanner) })
  document.querySelectorAll('[data-automation-watchdog]').forEach(node => { node.textContent = automationRunLabel(status?.watchdog) })
  document.querySelectorAll('[data-automation-added-count]').forEach(node => { node.textContent = String(status?.latestChanges?.added?.length ?? '—') })
  document.querySelectorAll('[data-automation-updated-count]').forEach(node => { node.textContent = String(status?.latestChanges?.updated?.length ?? '—') })
  document.querySelectorAll('[data-automation-source-checked]').forEach(node => { node.textContent = String(status?.latestChanges?.sourceVersionChecks?.checkedEntries ?? '—') })
  document.querySelectorAll('[data-automation-source-newer]').forEach(node => { node.textContent = String(status?.latestChanges?.sourceVersionChecks?.newerVersionCandidates ?? '—') })
  document.querySelectorAll('[data-automation-source-applied]').forEach(node => { node.textContent = String(status?.latestChanges?.sourceVersionChecks?.catalogUpdates ?? '—') })
  const timeValue = status?.scanner?.updatedAt || status?.scanner?.createdAt || status?.generatedAt
  const timeLabel = timeValue
    ? `${state.locale === 'en' ? 'Latest evidence' : '最近证据'} · ${new Intl.DateTimeFormat(state.locale === 'en' ? 'en' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timeValue))}`
    : (state.locale === 'en' ? 'Public evidence is temporarily unavailable' : '公开运行证据暂时不可用')
  document.querySelectorAll('[data-automation-time]').forEach(node => { node.textContent = timeLabel })
  const additions = Array.isArray(status?.recentAdditions) ? status.recentAdditions : []
  document.querySelectorAll('[data-automation-additions]').forEach(list => {
    list.innerHTML = additions.length
      ? additions.slice(0, 12).map(entry => `<li><a href="${escape(entry.repositoryUrl)}" target="_blank" rel="noreferrer">${escape(entry.name)}</a><span> · v${escape(entry.version)} · ${escape(entry.packageName)}</span></li>`).join('')
      : `<li>${escape(state.locale === 'en' ? 'No new qualifying plugins were added in the available recent runs.' : '最近可读取的运行中没有新增合格插件。')}</li>`
  })
  const updates = Array.isArray(status?.recentUpdates) ? status.recentUpdates : []
  const policyLabel = policy => state.locale === 'en'
    ? ({ 'source-verified': 'automatic low-risk review', 'user-reviewed': 'local risk review required', 'external-only': 'external-only metadata' }[policy] || 'fixed-source review')
    : ({ 'source-verified': '低风险自动审查', 'user-reviewed': '安装时仍需本机风险审查', 'external-only': '仅更新外部项目元数据' }[policy] || '固定源审查')
  document.querySelectorAll('[data-automation-updates]').forEach(list => {
    list.innerHTML = updates.length
      ? updates.slice(0, 12).map(entry => `<li><a href="${escape(entry.repositoryUrl)}" target="_blank" rel="noreferrer">${escape(entry.name)}</a><span> · v${escape(entry.fromVersion || '—')} → v${escape(entry.toVersion || '—')} · ${escape(policyLabel(entry.policy))}</span></li>`).join('')
      : `<li>${escape(t('automation.noUpdates'))}</li>`
  })
  document.querySelectorAll('[data-automation-run-link]').forEach(link => {
    if (status?.scanner?.url) link.href = status.scanner.url
  })
}

async function loadAutomationStatus() {
  if (!AUTOMATION_STATUS_URL || !document.querySelector('[data-automation-overall]')) return
  try {
    const response = await fetch(AUTOMATION_STATUS_URL, { cache: 'no-store', signal: AbortSignal.timeout(12_000) })
    if (!response.ok) throw new Error(`Automation status returned HTTP ${response.status}`)
    const source = await response.text()
    if (source.length > 1_000_000) throw new Error('Automation status exceeds the byte bound')
    const status = JSON.parse(source)
    if (status?.schemaVersion !== 1 || !status.overall || !status.catalog) throw new Error('Unsupported automation status')
    state.automationStatus = status
  } catch (error) {
    state.automationStatus = null
    console.error('Failed to load automation status:', error)
  }
  renderAutomationStatus()
}

async function loadCandidates() {
  if (state.candidatesLoaded || state.candidatesLoading || !state.catalog) return
  state.candidatesLoading = true
  renderCatalog()
  try {
    const candidateRegistry = await fetchCandidateRegistry(state.catalog)
    state.candidates = candidateRegistry.entries.map(entry => ({ ...entry, installable: false, allowedActions: [] }))
    state.candidatesLoaded = true
    renderStats()
  } catch (error) {
    console.error('Failed to load marketplace candidates:', error)
    state.candidates = []
    state.candidatesLoaded = true
  } finally {
    state.candidatesLoading = false
    renderCatalog()
  }
}

async function init() {
  applyLocale()
  observeReveals()
  await Promise.all([loadCatalog(), loadAutomationStatus()])
}

els.search?.addEventListener('input', event => {
  state.query = event.currentTarget.value
  state.page = 1
  renderCatalog()
  clearTimeout(state.searchEventTimer)
  if (state.query.trim()) {
    state.searchEventTimer = setTimeout(() => {
      sendDshEvent('catalog_search', {
        item: `results_${visibleEntries().length}`,
        value: `chars_${Math.min(state.query.trim().length, 20)}`,
      })
    }, 700)
  }
})
els.sort?.addEventListener('change', event => {
  state.sort = event.currentTarget.value
  state.page = 1
  renderCatalog()
  sendDshEvent('catalog_sort', { item: state.sort })
})
els.viewTabs?.addEventListener('click', event => {
  const button = event.target.closest('[data-catalog-view]')
  if (!button || !['trusted', 'candidates'].includes(button.dataset.catalogView)) return
  state.catalogView = button.dataset.catalogView
  state.category = ''
  state.page = 1
  els.viewTabs.querySelectorAll('[data-catalog-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)))
  renderCatalog()
  if (state.catalogView === 'candidates') void loadCandidates()
  sendDshEvent('catalog_view', { item: state.catalogView })
})
els.categories?.addEventListener('click', event => {
  const button = event.target.closest('[data-category]')
  if (!button) return
  state.category = button.dataset.category
  state.page = 1
  renderCatalog()
  sendDshEvent('catalog_category', { item: state.category || 'all' })
})
els.clear?.addEventListener('click', clearFilters)
els.emptyClear?.addEventListener('click', clearFilters)
els.retry?.addEventListener('click', loadCatalog)
function changePage(page) {
  if (!Number.isInteger(page) || page < 1 || page === state.page) return
  state.page = page
  renderCatalog()
  els.grid?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  sendDshEvent('catalog_page', { value: String(state.page) })
}
els.previousPage?.addEventListener('click', () => changePage(state.page - 1))
els.nextPage?.addEventListener('click', () => changePage(state.page + 1))
els.pageButtons?.addEventListener('click', event => {
  const button = event.target.closest('[data-page]')
  if (button) changePage(Number(button.dataset.page))
})
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy-target]')
  if (!button) return
  const target = document.getElementById(button.dataset.copyTarget)
  const text = target?.textContent?.trim()
  if (!text) return
  const label = button.querySelector('span')
  const previousLabel = label?.textContent
  try {
    await copyText(text)
    if (label) label.textContent = state.locale === 'en' ? 'Copied' : '已复制'
    showToast(t('toast.commandCopied'))
    sendDshEvent('install_command_copy', { item: 'dsh_safe_plugin_manager' })
  } catch {
    showToast(t('toast.copyDenied'))
  } finally {
    if (label && previousLabel) setTimeout(() => { label.textContent = previousLabel }, 1600)
  }
})
document.addEventListener('click', event => {
  const detailsButton = event.target.closest('[data-details-id]')
  if (!detailsButton) return
  const entry = state.entries.find(item => item.id === detailsButton.dataset.detailsId)
  if (entry) {
    showDetails(entry)
    sendDshEvent('plugin_detail', { item: entry.id })
  }
})
document.querySelector('.locale-switch')?.addEventListener('click', event => {
  const button = event.target.closest('[data-locale]')
  if (button && button.dataset.locale !== state.locale) {
    setLocale(button.dataset.locale)
    sendDshEvent('locale_switch', { item: state.locale })
  }
})
document.addEventListener('click', event => {
  const repoLink = event.target.closest('[data-repo-id]')
  if (repoLink) sendDshEvent('plugin_repository_open', { item: repoLink.dataset.repoId })
  const trackedLink = event.target.closest('[data-analytics-event]')
  if (trackedLink) sendDshEvent(trackedLink.dataset.analyticsEvent, { item: trackedLink.dataset.analyticsItem })
})
document.addEventListener('keydown', event => {
  if (els.search && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !els.dialog?.open) {
    event.preventDefault()
    els.search.focus()
  }
})
document.querySelector('#dialog-close')?.addEventListener('click', () => els.dialog?.close())
els.dialog?.addEventListener('click', event => {
  if (event.target === els.dialog) els.dialog.close()
})
els.dialogBody?.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy-commit]')
  if (!button || !button.dataset.copyCommit) return
  try {
    await copyText(button.dataset.copyCommit)
    showToast(t('toast.commitCopied'))
    sendDshEvent('plugin_commit_copy', { item: state.selectedEntry?.id })
  } catch {
    showToast(t('toast.copyDenied'))
  }
})

const reachedDepths = new Set()
window.addEventListener('scroll', () => {
  const available = document.documentElement.scrollHeight - innerHeight
  if (available <= 0) return
  const depth = Math.round(scrollY / available * 100)
  for (const threshold of [50, 90]) {
    if (depth >= threshold && !reachedDepths.has(threshold)) {
      reachedDepths.add(threshold)
      sendDshEvent('scroll_depth', { value: String(threshold) })
    }
  }
}, { passive: true })

init()
