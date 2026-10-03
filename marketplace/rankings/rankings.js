import { PAGE_SIZE, RANKING_TYPES, validateRankingSnapshot, rankingEntries, rankingPage, renderRankingRows } from './model.js'

const translations = {
  zh: {
    'a11y.skip': '跳到主要内容', 'nav.home': '首页', 'nav.plugins': '插件目录', 'nav.community': '社区与开发者', 'nav.standards': '收录标准', 'nav.build': '开发插件', 'nav.faq': '常见问题', 'nav.about': '关于我们', 'nav.guide': '使用说明', 'nav.submit': '提交插件',
    'hero.title': '值得发现的插件，在这里。', 'hero.lead': '看社区热度，找商城推荐，选每个分类的高星插件。', 'hero.catalog': '浏览全部插件 ↗',
    'tabs.label': '插件榜单', 'tab.popular': '热门榜单', 'tab.popularHint': '按 GitHub 星标排序', 'tab.recommended': '推荐榜单', 'tab.recommendedHint': '商城精选推荐', 'tab.essential': '必装榜单', 'tab.essentialHint': '每个分类的星标第一',
    'rule.popular': 'GitHub 星标从高到低排列；未获取到星标的插件不参与排名。', 'rule.recommended': '只展示已有推荐标记的在架插件，按照商城目录顺序排列。', 'rule.essential': '每个分类选最高星标插件；多分类夺冠合并展示，同星标按插件编号择一。',
    'loading': '正在读取榜单…', 'error': '榜单数据暂时无法加载，请重试。未使用旧数据替代当前排名。', 'retry': '重新加载', 'previous': '← 上一页', 'next': '下一页 →', 'pagination.label': '榜单分页',
    'empty.recommended': '暂时没有符合条件的推荐插件。不会把未获推荐的项目冒充精选。', 'empty.popular': '暂时没有可用的 GitHub 星标数据，热门榜待更新。', 'empty.essential': '暂时无法确定分类第一：没有可用的 GitHub 星标数据。',
    'method.title': '榜单怎么算？', 'method.body': '仅统计当前已获准上架的插件。热门榜按仓库星标降序；推荐榜按已有推荐标记及目录顺序；必装榜选每个分类的最高星标插件，同插件多分类夺冠合并展示，同星标按插件编号排序择一，分类内星标缺失时暂不选冠军。星标是仓库热度，不是安装量或安全评分；必装不代表人人都需要安装。', 'method.standards': '查看收录标准 ↗',
    'footer.lead': '发现适合自己的插件，先了解，再安装。', 'footer.explore': '快速导航', 'footer.friends': '友情链接', 'footer.note': '社区热度不是安全评分 · 按需选择插件', 'action.top': '回到顶部 ↑',
  },
  en: {
    'a11y.skip': 'Skip to content', 'nav.home': 'Home', 'nav.plugins': 'Plugins', 'nav.community': 'Community', 'nav.standards': 'Standards', 'nav.build': 'Build', 'nav.faq': 'FAQ', 'nav.about': 'About', 'nav.guide': 'Guide', 'nav.submit': 'Submit',
    'hero.title': 'Find your next great plugin.', 'hero.lead': 'Explore community favorites, Store picks, and the most-starred plugin in each category.', 'hero.catalog': 'Browse all plugins ↗',
    'tabs.label': 'Plugin charts', 'tab.popular': 'Popular', 'tab.popularHint': 'Ranked by GitHub stars', 'tab.recommended': 'Recommended', 'tab.recommendedHint': 'Picks from the Store', 'tab.essential': 'Must-haves', 'tab.essentialHint': 'Star leader in each category',
    'rule.popular': 'GitHub stars, highest first. Plugins without star data are not ranked.', 'rule.recommended': 'Approved plugins with an existing featured flag, in Catalog order.', 'rule.essential': 'The star leader of each category. Multi-category winners appear once; tied leaders are selected by plugin ID.',
    'loading': 'Loading the charts…', 'error': 'Charts could not be loaded. Please retry; old data is not used as the current ranking.', 'retry': 'Try again', 'previous': '← Previous', 'next': 'Next →', 'pagination.label': 'Chart pagination',
    'empty.recommended': 'No eligible Store picks yet. Unfeatured plugins are not presented as recommendations.', 'empty.popular': 'GitHub star data is not available yet. The popular chart is awaiting an update.', 'empty.essential': 'Category leaders cannot be determined without GitHub star data.',
    'method.title': 'How the charts work', 'method.body': 'Only currently approved Catalog entries qualify. Popular ranks repository stars. Recommended uses existing featured flags and Catalog order. Must-haves picks each category’s star leader, combines multiple wins, and breaks ties by plugin ID. Categories with missing star counts have no declared winner. Stars are not installs or security scores. Must-have does not mean mandatory for everyone.', 'method.standards': 'Read listing standards ↗',
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
  $('#ranking-total').textContent = state.locale === 'en' ? `${result.total} plugins` : `${result.total} 个插件`
  $('#ranking-empty').hidden = result.total > 0
  $('#ranking-empty').textContent = t(`empty.${state.type}`)
  $('.ranking-pagination').hidden = result.pageCount <= 1
  $('#ranking-prev').disabled = result.page <= 1
  $('#ranking-next').disabled = result.page >= result.pageCount
  $('#ranking-page').textContent = `${result.page} / ${result.pageCount}`
  const known = state.data.entries.filter(entry => entry.stars !== null).length
  const categories = new Set(state.data.entries.flatMap(entry => entry.categories)).size
  const covered = rankingEntries(state.data, 'essential').reduce((sum, entry) => sum + entry.wins.length, 0)
  const format = value => value ? new Intl.DateTimeFormat(state.locale === 'en' ? 'en-GB' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : (state.locale === 'en' ? 'Unavailable' : '暂未获取')
  const coverage = `${known}/${state.data.entries.length}`
  $('#ranking-freshness').textContent = state.locale === 'en'
    ? `Stars observed: ${format(state.data.starsObservedAt)} · Coverage: ${coverage} approved plugins · Category leaders: ${covered}/${categories}. Catalog: ${format(state.data.catalogUpdatedAt)}. Refreshed with site builds, not live counters.`
    : `星标采集：${format(state.data.starsObservedAt)} · 已获取 ${coverage} 个在架插件的星标 · 分类覆盖 ${covered}/${categories}。目录更新：${format(state.data.catalogUpdatedAt)}。星标随网站构建刷新，非实时计数。`
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
