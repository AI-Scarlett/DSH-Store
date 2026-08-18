const CATALOG_URL = '../registry/catalog.json'

const translations = {
  zh: {
    'meta.title': 'DSH-Store｜DeepSeek Harness 插件商城',
    'meta.description': 'DSH-Store 第三方插件商城：浏览固定到 Git Commit 的 DeepSeek Harness 插件，并在安装前了解权限、兼容性与审核状态。',
    'a11y.skip': '跳到插件目录',
    'nav.discover': '发现插件', 'nav.safety': '安全机制', 'nav.manager': '管理器插件',
    'hero.eyebrow': 'DEEPSEEK HARNESS 扩展网络', 'hero.title1': '下一块能力，', 'hero.title2': '已准备接入 DSH。',
    'hero.lead': '浏览固定来源、明确权限与兼容性的第三方插件。先看证据，再决定是否安装。',
    'install.title': '安装商城管理器', 'install.pinned': '固定 Commit', 'install.step1': '打开终端', 'install.step2': '粘贴命令并按回车', 'install.step3': '重启 DSH，进入插件商城',
    'install.warning': '命令会修改 web Profile；请先备份，失败后不要连续重试。',
    'action.copyCommand': '复制命令', 'action.fullGuide': '完整步骤 ↗', 'action.explore': '浏览全部插件', 'action.manager': '了解管理器插件',
    'action.source': '查看源码与说明', 'action.backCommand': '回到首屏复制命令 ↑', 'action.clear': '清除筛选', 'action.viewAll': '查看全部插件', 'action.top': '回到顶部 ↑',
    'action.details': '查看插件详情', 'action.copyCommit': '复制 Commit', 'action.repo': '查看 GitHub 仓库', 'action.manual': '前往 GitHub 手动安装', 'publisher': 'GitHub 发布者',
    'trust.commit': '固定 Git Commit', 'trust.permissions': '权限信息先展示', 'trust.readonly': '浏览不改 Profile',
    'console.online': '目录在线', 'console.network': 'EXTENSION NETWORK', 'console.heading': '找到新能力',
    'tab.featured': '推荐', 'tab.workflow': '工作流', 'tab.visual': '视觉', 'float.pinned': '来源已固定', 'float.commit': '40 位 Commit',
    'stats.plugins': '在架插件', 'stats.plannable': '可生成安装计划', 'stats.categories': '能力分类', 'stats.source': 'GitHub 目录源', 'stats.connecting': '正在连接 catalog.json…',
    'manager.title': '商城本身，也是一个标准 DSH 插件。', 'manager.lead': '通过官方 Bundle、Host Plugin 与 Client Slot 接入，不修改 DSH 核心，也不遮蔽官方插件清单。',
    'manager.body': '把第三方插件发现、权限核对与受控生命周期放进“设置 → 插件”的独立页面。', 'manager.version': '当前版本', 'manager.risk': '生命周期风险', 'manager.identity': '位固定身份',
    'guide.order': '按顺序操作', 'guide.title1': '备份目标 Profile', 'guide.body1': '备份 package.json、锁文件、工作区文件和 cordis.patch.yml。',
    'guide.title2': '执行固定来源命令', 'guide.body2': '使用 DSH 官方 CLI；不要把 40 位 Commit 改成 main。', 'guide.title3': '检查结果并重启', 'guide.body3': '命令成功后重启 DSH Web，再进入设置里的插件商城。',
    'featured.title': '本周信号最强的插件', 'featured.lead': '从固定来源的目录中挑出值得优先了解的扩展能力。',
    'catalog.title': '接入你的下一块能力', 'catalog.lead': '搜索名称、分类、权限、兼容性或仓库。无法确认的信息继续保持未知。', 'catalog.search': '搜索插件、能力或 GitHub 仓库', 'catalog.sort': '排序', 'catalog.loading': '正在读取目录…',
    'sort.recommended': '推荐优先', 'sort.name': '名称 A–Z', 'sort.recent': '版本更新', 'sort.risk': '权限由低到高',
    'status.available': '可安装', 'status.viewOnly': '仅展示', 'status.unlisted': '已下架',
    'empty.title': '没有找到匹配插件', 'empty.body': '换个关键词，或清除当前分类筛选。', 'error.title': '目录暂时没有加载成功', 'error.body': '请从仓库根目录启动本地服务器。',
    'safety.title': '把“放心”做成可见电路', 'safety.lead': '收录不是安全审计。来源、权限、变更计划与恢复路径必须分别展示。',
    'safety.card1.title': '不可变来源', 'safety.card1.body': '可安装条目指向完整 40 位 Git Commit，浮动分支不进入受保护流程。',
    'safety.card2.title': '权限雷达', 'safety.card2.body': '文件、网络、命令、凭据与兼容性集中展示，未知字段不猜测。',
    'safety.card3.title': '先计划，再改变', 'safety.card3.body': '真实 Profile 操作需要单次计划、精确确认、备份、健康检查与失败回滚。',
    'workflow.title': '三步，把新能力接入 DSH', 'workflow.step1.title': '发现与核对', 'workflow.step1.body': '搜索能力，确认来源、兼容性和权限边界。',
    'workflow.step2.title': '生成一次性计划', 'workflow.step2.body': '在 DSH 内创建新计划并核对文件范围、备份与回滚路径。', 'workflow.step3.title': '确认并验证', 'workflow.step3.body': '执行后检查配置与运行状态；测试通过不等于真实 Profile 已生效。',
    'faq.title': '安装之前，你可能还想知道', 'faq.q1': '官网会直接安装插件吗？', 'faq.a1': '不会。官网只负责浏览与详情展示；生命周期操作必须在 DSH 内生成计划并确认。',
    'faq.q2': '“可安装”等于完成安全审计吗？', 'faq.a2': '不等于。它只表示条目满足固定来源、标准 Bundle 与当前策略检查。', 'faq.q3': '目录离线时会怎样？', 'faq.a3': '可使用随包快照只读浏览，但安装与更新失败关闭，直到重新核验在线来源。',
    'footer.lead': '一个明亮、清楚、可追溯的 DeepSeek Harness 第三方插件入口。', 'footer.note': '收录不代表安全审计 · 浏览不会改写 Profile', 'dialog.title': '插件详情',
    'value.unknown': '未知', 'value.undeclared': '未声明', 'value.none': '无', 'value.noStats': '未启用统计', 'filter.all': '全部',
    'catalog.failed': '目录加载失败', 'catalog.offline': '本地目录未连接', 'catalog.meta': '显示 {shown} / {total} 个插件',
    'toast.commandCopied': '安装命令已复制', 'toast.copyDenied': '浏览器未允许复制，请手动选择命令', 'toast.commitCopied': 'Commit 已复制',
    'dialog.basic': '基本信息', 'dialog.permissions': '权限画像', 'dialog.review': '审核与兼容性', 'dialog.policy': '商城策略说明：',
    'dialog.note': '详情来自 GitHub catalog.json 的目录声明与固定 Commit 核验。收录、扫描或审核均不等于完成安全审计；官网不会直接修改你的 DSH Profile。',
  },
  en: {
    'meta.title': 'DSH-Store | DeepSeek Harness Plugin Market',
    'meta.description': 'DSH-Store is a third-party plugin market for exploring fixed-commit DeepSeek Harness extensions with visible permissions, compatibility, and review status.',
    'a11y.skip': 'Skip to plugin directory',
    'nav.discover': 'Discover', 'nav.safety': 'Trust circuit', 'nav.manager': 'Manager plugin',
    'hero.eyebrow': 'DEEPSEEK HARNESS EXTENSION NETWORK', 'hero.title1': 'Your next capability', 'hero.title2': 'is ready for DSH.',
    'hero.lead': 'Explore third-party plugins with fixed sources, visible permissions, and explicit compatibility. Check the evidence before installing.',
    'install.title': 'Install the market manager', 'install.pinned': 'Pinned commit', 'install.step1': 'Open Terminal', 'install.step2': 'Paste and press Enter', 'install.step3': 'Restart DSH and open the market',
    'install.warning': 'This command changes the web Profile. Back it up first, and do not retry repeatedly after an error.',
    'action.copyCommand': 'Copy command', 'action.fullGuide': 'Full guide ↗', 'action.explore': 'Explore plugins', 'action.manager': 'Meet the manager',
    'action.source': 'View source and docs', 'action.backCommand': 'Back to the command ↑', 'action.clear': 'Clear filters', 'action.viewAll': 'View all plugins', 'action.top': 'Back to top ↑',
    'action.details': 'View plugin details', 'action.copyCommit': 'Copy commit', 'action.repo': 'View GitHub repository', 'action.manual': 'Install manually on GitHub', 'publisher': 'GitHub publisher',
    'trust.commit': 'Pinned Git commit', 'trust.permissions': 'Permissions first', 'trust.readonly': 'Browsing is read-only',
    'console.online': 'Catalog online', 'console.network': 'EXTENSION NETWORK', 'console.heading': 'Find a new capability',
    'tab.featured': 'Featured', 'tab.workflow': 'Workflow', 'tab.visual': 'Visual', 'float.pinned': 'Source pinned', 'float.commit': '40-char commit',
    'stats.plugins': 'active plugins', 'stats.plannable': 'plan-ready', 'stats.categories': 'capability groups', 'stats.source': 'GitHub catalog source', 'stats.connecting': 'Connecting to catalog.json…',
    'manager.title': 'The market itself is a standard DSH plugin.', 'manager.lead': 'It connects through the official Bundle, Host Plugin, and Client Slot without changing DSH core or hiding the official inventory.',
    'manager.body': 'It brings third-party discovery, permission review, and guarded lifecycle controls into a dedicated Settings → Plugins view.', 'manager.version': 'current version', 'manager.risk': 'lifecycle risk', 'manager.identity': 'char identity',
    'guide.order': 'Follow in order', 'guide.title1': 'Back up the target Profile', 'guide.body1': 'Back up package.json, lockfiles, workspace files, and cordis.patch.yml.',
    'guide.title2': 'Run the pinned-source command', 'guide.body2': 'Use the official DSH CLI. Never replace the 40-character commit with main.', 'guide.title3': 'Check and restart', 'guide.body3': 'After a clean command, restart DSH Web and open the plugin market in Settings.',
    'featured.title': 'This week’s strongest signals', 'featured.lead': 'A focused selection of extensions worth inspecting first.',
    'catalog.title': 'Connect your next capability', 'catalog.lead': 'Search by name, category, permission, compatibility, or repository. Unknown facts stay unknown.', 'catalog.search': 'Search plugins, capabilities, or GitHub repositories', 'catalog.sort': 'Sort', 'catalog.loading': 'Reading catalog…',
    'sort.recommended': 'Recommended', 'sort.name': 'Name A–Z', 'sort.recent': 'Latest version', 'sort.risk': 'Lowest permission first',
    'status.available': 'Available', 'status.viewOnly': 'View only', 'status.unlisted': 'Unlisted',
    'empty.title': 'No matching plugins', 'empty.body': 'Try another query or clear the active category.', 'error.title': 'The catalog could not be loaded', 'error.body': 'Start the local server from the repository root.',
    'safety.title': 'Turn trust into a visible circuit', 'safety.lead': 'Listing is not a security audit. Source, permissions, change plans, and recovery paths remain distinct.',
    'safety.card1.title': 'Immutable source', 'safety.card1.body': 'Installable entries point to a full 40-character Git commit. Floating branches do not enter the guarded flow.',
    'safety.card2.title': 'Permission radar', 'safety.card2.body': 'Files, network, commands, credentials, and compatibility are shown together. Unknown fields are never guessed.',
    'safety.card3.title': 'Plan before change', 'safety.card3.body': 'Real Profile operations require a single-use plan, exact confirmation, backup, health checks, and rollback.',
    'workflow.title': 'Three steps to extend DSH', 'workflow.step1.title': 'Discover and inspect', 'workflow.step1.body': 'Find the capability and verify its source, compatibility, and permission boundary.',
    'workflow.step2.title': 'Create a single-use plan', 'workflow.step2.body': 'Inside DSH, review exact file scope, backup, and rollback before changing anything.', 'workflow.step3.title': 'Confirm and verify', 'workflow.step3.body': 'Check configuration and runtime state afterward. Passing tests do not prove a real Profile is active.',
    'faq.title': 'Before you install', 'faq.q1': 'Does the website install plugins directly?', 'faq.a1': 'No. The site is for discovery and details only. Lifecycle actions require a confirmed plan inside DSH.',
    'faq.q2': 'Does “Available” mean security-audited?', 'faq.a2': 'No. It means the entry passes the current fixed-source, standard-bundle, and policy checks.', 'faq.q3': 'What happens when the catalog is offline?', 'faq.a3': 'The bundled snapshot remains available for read-only browsing, while install and update fail closed until the live source is verified.',
    'footer.lead': 'A bright, legible, and traceable gateway to third-party DeepSeek Harness plugins.', 'footer.note': 'Listing is not a security audit · Browsing never writes to your Profile', 'dialog.title': 'Plugin details',
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
  entries: [],
  query: '',
  category: '',
  sort: 'recommended',
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
  featured: document.querySelector('#featured-grid'),
  preview: document.querySelector('#hero-preview'),
  dialog: document.querySelector('#plugin-dialog'),
  dialogTitle: document.querySelector('#dialog-title'),
  dialogKicker: document.querySelector('#dialog-kicker'),
  dialogBody: document.querySelector('#dialog-body'),
  toast: document.querySelector('#toast'),
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
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const detailLabel = (group, value) => labels[state.locale]?.[group]?.[value] || String(value || t('value.unknown'))
const categoryLabel = id => state.locale === 'en' ? englishCategories[id] || id : state.catalog?.registry?.categories?.[id] || id
const initials = name => String(name || 'DSH').replace(/^DSH\s*/i, '').split(/[\s_-]+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'D'
const pluginColor = id => palette[[...String(id)].reduce((total, character) => total + character.charCodeAt(0), 0) % palette.length]
const statusLabel = entry => entry.status === 'approved' ? t('status.available') : entry.status === 'blocked' ? t('status.viewOnly') : t('status.unlisted')
const listLabel = (items, fallback = t('value.undeclared')) => Array.isArray(items) && items.length ? items.join(' / ') : fallback
const licenseLabel = value => {
  if (!value || value === 'UNKNOWN') return t('value.unknown')
  if (value === 'UNLICENSED') return state.locale === 'en' ? 'License not published' : '未公开许可证'
  if (value === 'CC-BY-NC-SA-4.0') return state.locale === 'en' ? 'Non-commercial (CC BY-NC-SA 4.0)' : '非商业（CC BY-NC-SA 4.0）'
  return value
}
const githubPublisher = repositoryUrl => {
  try {
    const url = new URL(repositoryUrl)
    const owner = url.hostname.toLowerCase() === 'github.com' ? decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] || '') : ''
    return owner ? `@${owner}` : t('value.unknown')
  } catch { return t('value.unknown') }
}

function normalizeEntry(entry) {
  const details = entry?.details && typeof entry.details === 'object' ? entry.details : {}
  const permissions = details.permissions && typeof details.permissions === 'object' ? details.permissions : {}
  const compatibility = entry?.compatibility && typeof entry.compatibility === 'object' ? entry.compatibility : {}
  return {
    ...entry,
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
      node: compatibility.node || 'unknown',
      systems: Array.isArray(compatibility.systems) ? compatibility.systems : [],
      profiles: Array.isArray(compatibility.profiles) ? compatibility.profiles : [],
    },
  }
}

function searchValues(entry) {
  const permissions = entry.details.permissions
  return [
    entry.name, entry.packageName, entry.description, entry.repositoryUrl, githubPublisher(entry.repositoryUrl), entry.version,
    ...entry.categories.map(categoryLabel), detailLabel('pluginType', entry.details.pluginType),
    detailLabel('level', permissions.level), detailLabel('files', permissions.files),
    detailLabel('network', permissions.network), detailLabel('commands', permissions.commands),
    ...permissions.credentials.map(value => detailLabel('credentials', value)),
    detailLabel('reviewStatus', entry.details.reviewStatus), ...entry.details.externalDependencies,
    ...entry.compatibility.systems, ...entry.compatibility.profiles,
  ].map(value => String(value || '').toLowerCase())
}

function visibleEntries() {
  const query = state.query.trim().toLowerCase()
  const entries = state.entries
    .filter(entry => entry.status !== 'unlisted')
    .filter(entry => !state.category || entry.categories.includes(state.category))
    .filter(entry => !query || searchValues(entry).some(value => value.includes(query)))

  return entries.sort((a, b) => {
    const locale = state.locale === 'en' ? 'en' : 'zh-CN'
    if (state.sort === 'name') return a.name.localeCompare(b.name, locale)
    if (state.sort === 'risk') return (riskOrder[a.details.permissions.level] ?? 3) - (riskOrder[b.details.permissions.level] ?? 3) || a.name.localeCompare(b.name, locale)
    if (state.sort === 'recent') return String(b.version).localeCompare(String(a.version), undefined, { numeric: true }) || a.name.localeCompare(b.name, locale)
    return Number(b.featured === true) - Number(a.featured === true) || (b.installCount ?? -1) - (a.installCount ?? -1) || a.name.localeCompare(b.name, locale)
  })
}

function renderStats() {
  const entries = state.entries.filter(entry => entry.status !== 'unlisted')
  const categoryCount = new Set(entries.flatMap(entry => entry.categories)).size
  document.querySelector('#stat-total').textContent = String(entries.length).padStart(2, '0')
  document.querySelector('#stat-approved').textContent = String(entries.filter(entry => entry.status === 'approved').length).padStart(2, '0')
  document.querySelector('#stat-categories').textContent = String(categoryCount).padStart(2, '0')
  document.querySelector('#float-count').textContent = String(entries.length)
  const updatedAt = state.catalog?.registry?.updatedAt
  document.querySelector('#catalog-date').textContent = updatedAt
    ? `catalog.json · ${new Intl.DateTimeFormat(state.locale === 'en' ? 'en' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(updatedAt))}`
    : 'GitHub catalog.json'
}

function renderHeroPreview() {
  const featured = state.entries.filter(entry => entry.featured === true && entry.status === 'approved').slice(0, 3)
  els.preview.innerHTML = featured.map((entry, index) => `
    <article class="preview-plugin" style="--plugin-color:${pluginColor(entry.id)}">
      <span class="preview-icon">${escape(initials(entry.name))}</span>
      <span><b>${escape(entry.name)}</b><small>${escape(categoryLabel(entry.categories[0] || 'tools'))} · v${escape(entry.version)}</small></span>
      <em>${index === 0 ? 'FEATURED' : 'FIXED'}</em>
    </article>`).join('')
}

function renderFeatured() {
  const featured = state.entries.filter(entry => entry.featured === true && entry.status === 'approved').slice(0, 3)
  els.featured.innerHTML = featured.map((entry, index) => `
    <article class="featured-card reveal" style="--plugin-color:${pluginColor(entry.id)}">
      <div class="featured-top"><span class="feature-number">PICK / 0${index + 1}</span><span class="dialog-badge">${escape(categoryLabel(entry.categories[0] || 'tools'))}</span></div>
      <span class="featured-icon" aria-hidden="true"><span>${escape(initials(entry.name))}</span></span>
      <h3>${escape(entry.name)}</h3>
      <span class="package-line">${escape(t('publisher'))} ${escape(githubPublisher(entry.repositoryUrl))}</span>
      <p>${escape(entry.description)}</p>
      <button class="featured-link details-button" type="button" data-details-id="${escape(entry.id)}"><span>${escape(t('action.details'))}</span><i aria-hidden="true">↗</i></button>
    </article>`).join('')
  observeReveals()
}

function renderCategories() {
  const counts = new Map()
  state.entries.filter(entry => entry.status !== 'unlisted').forEach(entry => entry.categories.forEach(id => counts.set(id, (counts.get(id) || 0) + 1)))
  const ids = [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  els.categories.innerHTML = [
    `<button class="category-pill${state.category ? '' : ' active'}" type="button" data-category="" aria-pressed="${state.category ? 'false' : 'true'}">${escape(t('filter.all'))} <span>${state.entries.filter(entry => entry.status !== 'unlisted').length}</span></button>`,
    ...ids.map(id => `<button class="category-pill${state.category === id ? ' active' : ''}" type="button" data-category="${escape(id)}" aria-pressed="${state.category === id ? 'true' : 'false'}">${escape(categoryLabel(id))} <span>${counts.get(id)}</span></button>`),
  ].join('')
  els.clear.hidden = !state.category && !state.query
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
    <span class="package-line">${escape(t('publisher'))} ${escape(githubPublisher(entry.repositoryUrl))}</span>
    <p class="plugin-description">${escape(entry.description)}</p>
    <div class="plugin-badges">
      ${topCategories.map(id => `<span class="plugin-badge">${escape(categoryLabel(id))}</span>`).join('')}
      <span class="plugin-badge risk-${escape(permissions.level)}">${escape(detailLabel('level', permissions.level))}${state.locale === 'en' ? ' permission' : '权限'}</span>
    </div>
    <footer class="plugin-card-footer">
      <button class="details-button" type="button" data-details-id="${escape(entry.id)}">${escape(t('action.details'))} →</button>
      <a class="repo-link" href="${escape(entry.repositoryUrl)}" target="_blank" rel="noreferrer" aria-label="${escape(t('action.repo'))}: ${escape(entry.name)}">↗</a>
    </footer>
  </article>`
}

function renderCatalog() {
  if (!state.catalog) return
  const entries = visibleEntries()
  const total = state.entries.filter(entry => entry.status !== 'unlisted').length
  els.grid.innerHTML = entries.map(cardTemplate).join('')
  els.grid.hidden = entries.length === 0
  els.empty.hidden = entries.length !== 0
  els.meta.innerHTML = `${escape(t('catalog.meta', { shown: entries.length, total }))}${state.category ? ` · ${escape(categoryLabel(state.category))}` : ''}`.replace(String(entries.length), `<b>${entries.length}</b>`)
  renderCategories()
}

function detailItem(name, value, code = false) {
  return `<div class="detail-item"><dt>${escape(name)}</dt><dd${code ? ' class="package-line"' : ''}>${escape(value)}</dd></div>`
}

function showDetails(entry) {
  const permissions = entry.details.permissions
  const compatibility = entry.compatibility
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
      ${detailItem(t('publisher'), githubPublisher(entry.repositoryUrl))}
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
      ${detailItem(state.locale === 'en' ? 'Systems' : '系统', listLabel(compatibility.systems))}${detailItem('Profile', listLabel(compatibility.profiles))}
      ${detailItem(state.locale === 'en' ? 'External dependencies' : '外部依赖', listLabel(entry.details.externalDependencies, t('value.none')))}${detailItem(state.locale === 'en' ? 'Installs' : '累计安装', Number.isInteger(entry.installCount) ? String(entry.installCount) : t('value.noStats'))}
    </dl></section>
    ${entry.statusReason ? `<p class="dialog-note danger"><b>${escape(t('dialog.policy'))}</b>${escape(entry.statusReason)}</p>` : ''}
    <p class="dialog-note">${escape(t('dialog.note'))}</p>
    <div class="dialog-actions">
      <button class="copy-button" type="button" data-copy-commit="${escape(entry.commit || '')}">${escape(t('action.copyCommit'))}</button>
      <a class="dialog-repo" href="${escape(entry.repositoryUrl)}" target="_blank" rel="noreferrer">${escape(entry.status === 'blocked' ? t('action.manual') : t('action.repo'))} <span aria-hidden="true">↗</span></a>
    </div>`
  els.dialog.showModal()
}

function clearFilters() {
  state.query = ''
  state.category = ''
  els.search.value = ''
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
  document.title = t('meta.title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'))
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n)
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder))
  })
  document.querySelectorAll('[data-locale]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.locale === state.locale))
  })
  els.search.setAttribute('aria-label', t('catalog.search'))
  els.categories.setAttribute('aria-label', state.locale === 'en' ? 'Filter by category' : '按分类筛选')
  document.querySelector('#dialog-close')?.setAttribute('aria-label', state.locale === 'en' ? 'Close plugin details' : '关闭插件详情')

  if (state.catalog) {
    renderStats()
    renderHeroPreview()
    renderFeatured()
    renderCatalog()
    if (els.dialog.open && state.selectedEntry) {
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
    const payload = await response.json()
    if (!response.ok || payload.schemaVersion !== 1 || !payload.counts) return
    state.entries.forEach(entry => {
      if (Number.isInteger(payload.counts[entry.id])) entry.installCount = payload.counts[entry.id]
    })
    renderCatalog()
  } catch {}
}

async function init() {
  applyLocale()
  observeReveals()
  try {
    const response = await fetch(CATALOG_URL, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    state.catalog = await response.json()
    state.entries = state.catalog.entries.map(normalizeEntry)
    renderStats()
    renderHeroPreview()
    renderFeatured()
    renderCategories()
    renderCatalog()
    loadInstallCounts()
  } catch (error) {
    els.meta.textContent = t('catalog.failed')
    els.grid.hidden = true
    els.empty.hidden = true
    els.error.hidden = false
    document.querySelector('#catalog-date').textContent = t('catalog.offline')
    console.error('Failed to load marketplace catalog:', error)
  }
}

els.search.addEventListener('input', event => {
  state.query = event.currentTarget.value
  renderCatalog()
})
els.sort.addEventListener('change', event => {
  state.sort = event.currentTarget.value
  renderCatalog()
})
els.categories.addEventListener('click', event => {
  const button = event.target.closest('[data-category]')
  if (!button) return
  state.category = button.dataset.category
  renderCatalog()
})
els.clear.addEventListener('click', clearFilters)
els.emptyClear.addEventListener('click', clearFilters)
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
  if (entry) showDetails(entry)
})
document.querySelector('.locale-switch').addEventListener('click', event => {
  const button = event.target.closest('[data-locale]')
  if (button) setLocale(button.dataset.locale)
})
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !els.dialog.open) {
    event.preventDefault()
    els.search.focus()
  }
})
document.querySelector('#dialog-close').addEventListener('click', () => els.dialog.close())
els.dialog.addEventListener('click', event => {
  if (event.target === els.dialog) els.dialog.close()
})
els.dialogBody.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy-commit]')
  if (!button || !button.dataset.copyCommit) return
  try {
    await copyText(button.dataset.copyCommit)
    showToast(t('toast.commitCopied'))
  } catch {
    showToast(t('toast.copyDenied'))
  }
})

init()
