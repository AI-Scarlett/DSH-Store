import { PAGE_SIZE, RANKING_TYPES, validateRankingSnapshot, rankingEntries, rankingPage, renderRankingRows } from './model.js?v=20261012-listed-reasons'

const translations = {
  zh: {
    'a11y.skip': '跳到主要内容', 'nav.home': '首页', 'nav.plugins': '插件目录', 'nav.community': '社区与开发者', 'nav.standards': '收录标准', 'nav.build': '开发插件', 'nav.faq': '常见问题', 'nav.about': '关于我们', 'nav.guide': '使用说明', 'nav.submit': '提交插件',
    'hero.title': '值得发现的插件，在这里。', 'hero.lead': '已收录与未收录，一起看热度；是否收录及未收录原因，每项清楚标记。', 'hero.catalog': '浏览全部插件 ↗',
    'tabs.label': '插件榜单', 'tab.popular': '热门榜单', 'tab.popularHint': '每日更新 · 前 100 项', 'tab.listed': '收录榜单', 'tab.listedHint': '每日更新 · 收录前 30 项', 'tab.recommended': '推荐榜单', 'tab.recommendedHint': '每周更新 · 非商城评测', 'tab.essential': '必装榜单', 'tab.essentialHint': '每周更新 · 分类第一 + 高星补充',
    'rule.popular': '每日采集 GitHub 星标并从高到低排列，最多展示前 100 项；未获取到星标的插件不参与排名。未收录项目会标注具体审核原因。', 'rule.listed': '仅展示已通过收录且绑定完整固定 Commit 的插件，按每日采集的 GitHub 星标从高到低排列，最多 30 项；星标未知的项目不参与排名。', 'rule.recommended': '每周更新一次，按该周采集的 GitHub 星标降序取前 30 项，排除零星、星标未知及被阻止或拒绝收录的项目。每项显示该周实际星数；这是自动筛选，不是商城评测推荐，入榜不等于已收录。未收录项目会标注具体审核原因。', 'rule.essential': '每周更新一次，优先各分类星标第一，去重后按分类轮选高星项目补充至 30 条；补充项注明该周快照名次，不冒充冠军。未收录项目会标注具体审核原因。',
    'loading': '正在读取榜单…', 'error': '榜单数据暂时无法加载，请重试。未使用旧数据替代当前排名。', 'retry': '重新加载', 'previous': '← 上一页', 'next': '下一页 →', 'pagination.label': '榜单分页',
    'empty.recommended': '暂时没有符合筛选条件且星标可核验的项目。', 'empty.popular': '暂时没有可用的 GitHub 星标数据，热门榜待更新。', 'empty.listed': '暂时没有已收录且星标可核验的插件。', 'empty.essential': '暂时没有可用的分类星标数据。',
    'method.title': '榜单怎么算？', 'method.body': '统计插件目录与有 DSH 关联的发现候选记录，包括未收录项目；每项标记已收录或未收录，并展示未收录审核原因。候选项目不代表已经核验为标准 DSH 插件，未收录项目仅链接 GitHub，不提供商城安装入口。热门榜每天刷新一次，按仓库星标降序最多展示 100 项；收录榜从已批准且绑定完整固定 Commit 的项目中，按同一日更星标快照取前 30 项。推荐榜和必装榜每周刷新一次，统一采用该周采集的星标快照。推荐榜按星标取前 30 项，排除零星、星标未知及被阻止或拒绝收录的项目；旧的重点展示标记不作为推荐依据，不宣称人工精选或商城评测。必装榜保留各分类第一，去重后轮选分类高星项目补充至 30 条，并注明该周快照名次。没有可靠分类的项目不参加必装榜；分类星标缺失时不声明冠军。每页最多 30 条，数据不足如实展示，不复制或编造记录。星标是仓库热度，不是安装量或安全评分；必装不代表人人都需要安装。常规网站构建不会刷新榜单分数。', 'method.standards': '查看收录标准 ↗',
    'footer.lead': '发现适合自己的插件，先了解，再安装。', 'footer.explore': '快速导航', 'footer.friends': '友情链接', 'footer.note': '社区热度不是安全评分 · 按需选择插件', 'action.top': '回到顶部 ↑',
  },
  en: {
    'a11y.skip': 'Skip to content', 'nav.home': 'Home', 'nav.plugins': 'Plugins', 'nav.community': 'Community', 'nav.standards': 'Standards', 'nav.build': 'Build', 'nav.faq': 'FAQ', 'nav.about': 'About', 'nav.guide': 'Guide', 'nav.submit': 'Submit',
    'hero.title': 'Find your next great plugin.', 'hero.lead': 'Explore listed and unlisted projects together. Every entry shows its Store status and, when unlisted, the reason.', 'hero.catalog': 'Browse all plugins ↗',
    'tabs.label': 'Plugin charts', 'tab.popular': 'Popular', 'tab.popularHint': 'Daily · Top 100', 'tab.listed': 'Listed', 'tab.listedHint': 'Daily · Top 30', 'tab.recommended': 'Recommended', 'tab.recommendedHint': 'Weekly · not Store reviews', 'tab.essential': 'Must-haves', 'tab.essentialHint': 'Weekly · category leaders + star picks',
    'rule.popular': 'GitHub stars are collected daily and sorted highest first; at most 100 entries are shown. Projects without verified star data are not ranked. Unlisted entries show the review reason.', 'rule.listed': 'Only Catalog-approved plugins pinned to a full fixed Commit are included, sorted by the daily GitHub star snapshot; at most 30 entries with verified star counts are shown.', 'rule.recommended': 'Updated weekly; selects up to 30 by that week’s observed GitHub stars, excluding zero or unknown counts and blocked or rejected records. Each entry shows the weekly snapshot count. This is automated selection, not a Store review or admission. Unlisted entries show the review reason.', 'rule.essential': 'Updated weekly; category leaders first, followed by round-robin category star picks to reach 30. Supplements show ranks from that week’s snapshot, not champion claims. Unlisted entries show the review reason.',
    'loading': 'Loading the charts…', 'error': 'Charts could not be loaded. Please retry; old data is not used as the current ranking.', 'retry': 'Try again', 'previous': '← Previous', 'next': 'Next →', 'pagination.label': 'Chart pagination',
    'empty.recommended': 'No eligible projects with verified star counts are available yet.', 'empty.popular': 'GitHub star data is not available yet. The popular chart is awaiting an update.', 'empty.listed': 'No listed plugins with verified star counts are available yet.', 'empty.essential': 'No usable category star data yet.',
    'method.title': 'How the charts work', 'method.body': 'Charts include Catalog and DSH-related discovery records, whether listed or not. Every entry shows its listing status and unlisted review reason. Discovery candidates are not verified DSH plugins; unlisted entries link only to GitHub, with no Store installation action. Popular refreshes daily and shows at most 100 repositories by GitHub stars. Listed shows up to 30 approved, full-Commit-pinned Catalog entries using the same daily star snapshot. Recommended and Must-haves refresh weekly and use the same weekly star snapshot. Recommended selects up to 30, excluding zero or unknown counts and blocked or rejected records. Legacy featured flags are not recommendation evidence; no editorial selection or Store review is claimed. Must-haves keeps category leaders and adds deduplicated round-robin category picks to 30, showing their weekly snapshot rank. Uncategorized projects cannot enter Must-haves; categories with missing counters have no declared winner. Pages show at most 30 rows; missing data is never fabricated. Routine site builds do not refresh chart scores. Stars are not installs or security scores. Must-have does not mean mandatory for everyone.', 'method.standards': 'Read listing standards ↗',
    'footer.lead': 'Discover the right plugins. Understand them before installing.', 'footer.explore': 'Explore', 'footer.friends': 'Friends', 'footer.note': 'Popularity is not a security score · Choose what you need', 'action.top': 'Back to top ↑',
  },
}
const $ = selector => document.querySelector(selector)
let storedLocale
try { storedLocale = localStorage.getItem('dsh-marketplace-locale') } catch {}
const state = { locale: ['zh', 'en'].includes(storedLocale) ? storedLocale : document.documentElement.dataset.defaultLocale === 'en' ? 'en' : 'zh', data: null, type: 'popular', page: 1, loading: true, error: false }
const t = key => translations[state.locale][key] || translations.zh[key] || key
function readLocation() {
  const params = new URLSearchParams(location.search)
  state.type = RANKING_TYPES.includes(params.get('list')) ? params.get('list') : 'popular'
  const page = Number(params.get('page'))
  state.page = Number.isSafeInteger(page) && page > 0 ? page : 1
}
function updateLocation() {
  const url = new URL(location.href)
  url.searchParams.set('list', state.type)
  if (state.page > 1) url.searchParams.set('page', String(state.page))
  else url.searchParams.delete('page')
  if (url.href !== location.href) history.pushState(null, '', url)
}
function render() {
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN'
  document.title = state.locale === 'en' ? 'Plugin Charts | DSH STORE' : '插件榜单 | DSH STORE'
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n) })
  document.querySelectorAll('[data-i18n-aria]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nAria)) })
  document.querySelectorAll('[data-locale]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.locale === state.locale)))
  document.querySelectorAll('[data-ranking-tab]').forEach(node => {
    const active = node.dataset.rankingTab === state.type
    node.setAttribute('aria-selected', String(active)); node.tabIndex = active ? 0 : -1
  })
  $('#ranking-panel').setAttribute('aria-labelledby', `tab-${state.type}`)
  $('#ranking-panel').setAttribute('aria-busy', String(state.loading))
  $('#ranking-title').textContent = t(`tab.${state.type}`)
  $('#ranking-rule').textContent = t(`rule.${state.type}`)
  $('#ranking-loading').hidden = !state.loading
  $('#ranking-error').hidden = !state.error
  if (!state.data) return
  const result = rankingPage(state.data, state.type, state.page)
  state.page = result.page
  document.querySelectorAll('[data-count]').forEach(node => { node.textContent = String(rankingEntries(state.data, node.dataset.count).length) })
  $('#ranking-list').innerHTML = renderRankingRows(result.entries, { type: state.type, locale: state.locale, offset: (state.page - 1) * PAGE_SIZE })
  $('#ranking-list').start = (state.page - 1) * PAGE_SIZE + 1
  $('#ranking-total').textContent = state.locale === 'en' ? `${result.total} projects` : `${result.total} 个项目`
  $('#ranking-empty').hidden = result.total > 0
  $('#ranking-empty').textContent = t(`empty.${state.type}`)
  $('.ranking-pagination').hidden = result.pageCount <= 1
  $('#ranking-prev').disabled = result.page <= 1
  $('#ranking-next').disabled = result.page >= result.pageCount
  $('#ranking-page').textContent = `${result.page} / ${result.pageCount}`
  const known = state.data.entries.filter(entry => entry.stars !== null).length
  const categories = new Set(state.data.entries.flatMap(entry => entry.categories)).size
  const listed = state.data.entries.filter(entry => entry.listingStatus === 'listed').length
  const covered = rankingEntries(state.data, 'essential').reduce((sum, entry) => sum + entry.wins.length, 0)
  const format = value => value ? new Intl.DateTimeFormat(state.locale === 'en' ? 'en-GB' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : (state.locale === 'en' ? 'Unavailable' : '暂未获取')
  const coverage = `${known}/${state.data.entries.length}`
  $('#ranking-freshness').textContent = state.locale === 'en'
    ? `Popular snapshot: ${format(state.data.starsObservedAt)} · Weekly charts: ${format(state.data.weeklyStarsObservedAt)} · Star coverage: ${coverage} · Listed: ${listed} · Not listed: ${state.data.entries.length - listed} · Weekly category leaders: ${covered}/${categories}. Catalog: ${format(state.data.catalogUpdatedAt)}. Routine site builds do not refresh stars.`
    : `热门榜日更快照：${format(state.data.starsObservedAt)} · 推荐/必装周更快照：${format(state.data.weeklyStarsObservedAt)} · 星标覆盖 ${coverage} · 已收录 ${listed} / 未收录 ${state.data.entries.length - listed} · 周榜分类覆盖 ${covered}/${categories}。目录更新：${format(state.data.catalogUpdatedAt)}。常规网站构建不会刷新星标。`
}
function select(type, page = 1) {
  state.type = type; state.page = page; render(); updateLocation()
}
async function load() {
  state.loading = true; state.error = false; render()
  try {
    const response = await fetch('./data.json', { cache: 'no-cache', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Rankings unavailable')
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > 1024 * 1024) throw new Error('Rankings exceed bound')
    const expected = document.querySelector('meta[name="dsh-rankings-sha256"]')?.content
    if (!expected) throw new Error('Ranking release identity missing')
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
    if (digest !== expected) throw new Error('Ranking release identity mismatch')
    state.data = validateRankingSnapshot(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    state.data = null; state.error = true
    $('#ranking-list').replaceChildren(); $('#ranking-total').textContent = ''; $('#ranking-freshness').textContent = ''
    $('#ranking-empty').hidden = true; $('.ranking-pagination').hidden = true
    document.querySelectorAll('[data-count]').forEach(node => { node.textContent = '—' })
  } finally { state.loading = false; render() }
}
document.querySelectorAll('[data-ranking-tab]').forEach((button, index, tabs) => {
  button.addEventListener('click', () => select(button.dataset.rankingTab))
  button.addEventListener('keydown', event => {
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault(); tabs[next].focus(); select(tabs[next].dataset.rankingTab)
  })
})
for (const [id, delta] of [['ranking-prev', -1], ['ranking-next', 1]]) $(`#${id}`).addEventListener('click', () => {
  select(state.type, state.page + delta)
  $('#ranking-panel').focus({ preventScroll: true })
  $('#ranking-title').scrollIntoView({ block: 'center' })
})
document.querySelectorAll('[data-locale]').forEach(button => button.addEventListener('click', () => {
  state.locale = button.dataset.locale === 'en' ? 'en' : 'zh'
  try { localStorage.setItem('dsh-marketplace-locale', state.locale) } catch {}
  render()
}))
window.addEventListener('popstate', () => { readLocation(); render() })
window.addEventListener('storage', event => {
  if (event.key === 'dsh-marketplace-locale' && ['en', 'zh'].includes(event.newValue)) { state.locale = event.newValue; render() }
})
// Reload the HTML too: an atomic release may have changed the pinned snapshot digest.
$('#ranking-retry').addEventListener('click', () => window.location.reload())
readLocation(); render(); load()
