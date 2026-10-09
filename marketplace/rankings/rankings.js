import { PAGE_SIZE, RANKING_TYPES, validateRankingSnapshot, rankingEntries, rankingPage, renderRankingRows } from './model.js?v=20261004-30'

const translations = {
  zh: {
    'a11y.skip': '跳到主要内容', 'nav.home': '首页', 'nav.plugins': '插件目录', 'nav.community': '社区与开发者', 'nav.standards': '收录标准', 'nav.build': '开发插件', 'nav.faq': '常见问题', 'nav.about': '关于我们', 'nav.guide': '使用说明', 'nav.submit': '提交插件',
    'hero.title': '值得发现的插件，在这里。', 'hero.lead': '已收录与未收录，一起看热度；是否收录，每项清楚标记。', 'hero.catalog': '浏览全部插件 ↗',
    'tabs.label': '插件榜单', 'tab.popular': '热门榜单', 'tab.popularHint': '按 GitHub 星标排序', 'tab.recommended': '推荐榜单', 'tab.recommendedHint': '精选 + 社区高星推荐', 'tab.essential': '必装榜单', 'tab.essentialHint': '分类第一 + 高星补充',
    'rule.popular': 'GitHub 星标从高到低排列；未获取到星标的插件不参与排名。', 'rule.recommended': '精选优先，不足 30 条时补充社区高星项目；每项注明推荐依据，推荐不等于已收录。', 'rule.essential': '优先各分类星标第一，去重后按分类轮选高星项目补充至 30 条；补充项注明当前数据名次，不冒充冠军。',
    'loading': '正在读取榜单…', 'error': '榜单数据暂时无法加载，请重试。未使用旧数据替代当前排名。', 'retry': '重新加载', 'previous': '← 上一页', 'next': '下一页 →', 'pagination.label': '榜单分页',
    'empty.recommended': '暂时没有精选或可用于社区推荐的星标数据。', 'empty.popular': '暂时没有可用的 GitHub 星标数据，热门榜待更新。', 'empty.essential': '暂时没有可用的分类星标数据。',
    'method.title': '榜单怎么算？', 'method.body': '统计插件目录与有 DSH 关联的发现候选记录，包括未收录项目；每项标记已收录或未收录。候选项目不代表已经核验为标准 DSH 插件，未收录项目仅链接 GitHub，不提供商城安装入口。热门榜按仓库星标降序；推荐榜保留人工精选，并补充明确标注的社区高星推荐至 30 条；必装榜保留各分类第一，去重后轮选分类高星项目补充至 30 条，并注明当前已获取星标中的名次。没有可靠分类的项目不参加必装榜；分类星标缺失时不声明冠军。每页 30 条，数据不足如实展示，不复制或编造记录。星标是仓库热度，不是安装量或安全评分；必装不代表人人都需要安装。', 'method.standards': '查看收录标准 ↗',
    'footer.lead': '发现适合自己的插件，先了解，再安装。', 'footer.explore': '快速导航', 'footer.friends': '友情链接', 'footer.note': '社区热度不是安全评分 · 按需选择插件', 'action.top': '回到顶部 ↑',
  },
  en: {
    'a11y.skip': 'Skip to content', 'nav.home': 'Home', 'nav.plugins': 'Plugins', 'nav.community': 'Community', 'nav.standards': 'Standards', 'nav.build': 'Build', 'nav.faq': 'FAQ', 'nav.about': 'About', 'nav.guide': 'Guide', 'nav.submit': 'Submit',
    'hero.title': 'Find your next great plugin.', 'hero.lead': 'Explore listed and unlisted projects together. Every entry clearly shows its Store status.', 'hero.catalog': 'Browse all plugins ↗',
    'tabs.label': 'Plugin charts', 'tab.popular': 'Popular', 'tab.popularHint': 'Ranked by GitHub stars', 'tab.recommended': 'Recommended', 'tab.recommendedHint': 'Editorial + community picks', 'tab.essential': 'Must-haves', 'tab.essentialHint': 'Category leaders + star picks',
    'rule.popular': 'GitHub stars, highest first. Plugins without star data are not ranked.', 'rule.recommended': 'Editorial picks first, then clearly labelled community star picks to reach 30. Recommendation does not imply listing.', 'rule.essential': 'Category leaders first, followed by round-robin category star picks to reach 30. Supplements show observed ranks, not champion claims.',
    'loading': 'Loading the charts…', 'error': 'Charts could not be loaded. Please retry; old data is not used as the current ranking.', 'retry': 'Try again', 'previous': '← Previous', 'next': 'Next →', 'pagination.label': 'Chart pagination',
    'empty.recommended': 'No editorial picks or usable community star data yet.', 'empty.popular': 'GitHub star data is not available yet. The popular chart is awaiting an update.', 'empty.essential': 'No usable category star data yet.',
    'method.title': 'How the charts work', 'method.body': 'Charts include Catalog and DSH-related discovery records, whether listed or not. Every entry shows its listing status. Discovery candidates are not verified DSH plugins; unlisted entries link only to GitHub, with no Store installation action. Popular ranks repository stars. Recommended preserves editorial picks, supplementing to 30 with labelled community star picks. Must-haves keeps category leaders and adds deduplicated round-robin category picks to 30, showing their observed star rank. Uncategorized projects cannot enter Must-haves; categories with missing counters have no declared winner. Pages show 30 rows; missing data is never fabricated. Stars are not installs or security scores. Must-have does not mean mandatory for everyone.', 'method.standards': 'Read listing standards ↗',
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
    ? `Stars observed: ${format(state.data.starsObservedAt)} · Coverage: ${coverage} projects · Listed: ${listed} · Not listed: ${state.data.entries.length - listed} · Category leaders: ${covered}/${categories}. Catalog: ${format(state.data.catalogUpdatedAt)}. Refreshed with site builds, not live counters.`
    : `星标采集：${format(state.data.starsObservedAt)} · 已获取 ${coverage} 个项目的星标 · 已收录 ${listed} / 未收录 ${state.data.entries.length - listed} · 分类覆盖 ${covered}/${categories}。目录更新：${format(state.data.catalogUpdatedAt)}。星标随网站构建刷新，非实时计数。`
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
