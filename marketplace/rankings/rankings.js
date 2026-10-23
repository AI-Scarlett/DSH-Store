import { MAX_RANKING_SNAPSHOT_BYTES, PAGE_SIZE, RANKING_TYPES, validateRankingSnapshot, rankingEntries, rankingPage, renderRankingRows } from './model.js?v=20261023-ranking-bound-2m'

const translations = {
  zh: {
    'a11y.skip': '跳到主要内容', 'nav.home': '首页', 'nav.plugins': '插件目录', 'nav.articles': 'DSH 实战与观察', 'nav.community': '社区与开发者', 'nav.standards': '收录标准', 'nav.build': '开发插件', 'nav.faq': '常见问题', 'nav.about': '关于我们', 'nav.guide': '使用说明', 'nav.submit': '提交插件',
    'hero.title': '值得发现的插件，在这里。', 'hero.lead': '已收录与未收录，一起看热度；是否收录及未收录原因，每项清楚标记。', 'hero.catalog': '浏览全部插件 ↗',
    'tabs.label': '插件榜单', 'tab.popular': '热门榜单', 'tab.popularHint': '每日更新 · 前 100 项', 'tab.listed': '收录榜单', 'tab.listedHint': '每日更新 · 收录前 30 项', 'tab.recommended': '推荐榜单', 'tab.recommendedHint': '作者互动 + 每周星标推荐', 'tab.essential': '必装榜单', 'tab.essentialHint': '每周更新 · 分类高星 + 官方工具',
    'rule.popular': '每日采集 GitHub 星标并从高到低排列，最多展示前 100 项；未获取到星标的插件不参与排名。未收录项目会标注具体审核原因。', 'rule.listed': '仅展示已通过收录且绑定完整固定 Commit 的插件，按每日采集的 GitHub 星标从高到低排列，最多 30 项；星标未知的项目不参与排名。', 'rule.recommended': '推荐榜包含与我们公开交流或主动提交的插件项目，按最近互动排序并完整分页，不受星标数量或审核通过状态限制；每项提供公开交流依据。明确退出或不属于插件的项目不参加。其后保留每周星标推荐与标注的官方工具展示位。推荐展示不改变收录、权限、兼容性或安装资格，未收录项目仅链接 GitHub。', 'rule.essential': '每周更新一次，保留各分类星标第一及分类高星补充，并把 DSH Store 与 DSH 插件开发两个官方工具放入前十随机位置；补充项注明快照名次，不冒充分类冠军。官方工具位不是安全评测，也不表示人人都必须安装。未收录项目会标注具体审核原因。',
    'loading': '正在读取榜单…', 'error': '榜单数据暂时无法加载，请重试。未使用旧数据替代当前排名。', 'retry': '重新加载', 'previous': '← 上一页', 'next': '下一页 →', 'pagination.label': '榜单分页',
    'empty.recommended': '暂时没有可展示的推荐项目。', 'empty.popular': '暂时没有可用的 GitHub 星标数据，热门榜待更新。', 'empty.listed': '暂时没有已收录且星标可核验的插件。', 'empty.essential': '暂时没有可用的分类星标数据。',
    'method.title': '榜单怎么算？', 'method.body': '榜单同时展示已收录和未收录项目，每项标记状态与未收录原因。热门榜每天按 GitHub 星标取前 100 项；收录榜按日更星标取已批准且绑定完整 Commit 的前 30 项。推荐榜展示全部有公开交流依据的互动插件，按最近互动排序，每页 30 项；互动推荐不受零星、未知星标或待审核状态限制。另保留每周星标推荐，并把 DSH Store 与 DSH 插件开发放入前十随机位置，明确标注为官方工具展示位。必装榜每周保留分类星标第一与分类高星补充。明确退出、停止展示或不是插件的项目不进入互动推荐。未收录项目仅链接 GitHub，不提供商城安装入口。旧的重点展示标记不作为推荐依据。推荐、星标和作者声明都不是安全评测、兼容性或运行验证，展示不会改变安装资格。常规网站构建不会刷新榜单分数；互动名单随审阅后的发布更新。', 'method.standards': '查看收录标准 ↗',
    'footer.lead': '发现适合自己的插件，先了解，再安装。', 'footer.explore': '快速导航', 'footer.friends': '友情链接', 'footer.note': '社区热度不是安全评分 · 按需选择插件', 'action.top': '回到顶部 ↑',
  },
  en: {
    'a11y.skip': 'Skip to content', 'nav.home': 'Home', 'nav.plugins': 'Plugins', 'nav.articles': 'DSH Field Notes', 'nav.community': 'Community', 'nav.standards': 'Standards', 'nav.build': 'Build', 'nav.faq': 'FAQ', 'nav.about': 'About', 'nav.guide': 'Guide', 'nav.submit': 'Submit',
    'hero.title': 'Find your next great plugin.', 'hero.lead': 'Explore listed and unlisted projects together. Every entry shows its Store status and, when unlisted, the reason.', 'hero.catalog': 'Browse all plugins ↗',
    'tabs.label': 'Plugin charts', 'tab.popular': 'Popular', 'tab.popularHint': 'Daily · Top 100', 'tab.listed': 'Listed', 'tab.listedHint': 'Daily · Top 30', 'tab.recommended': 'Recommended', 'tab.recommendedHint': 'Author interactions + weekly star picks', 'tab.essential': 'Must-haves', 'tab.essentialHint': 'Weekly · category picks + official tools',
    'rule.popular': 'GitHub stars are collected daily and sorted highest first; at most 100 entries are shown. Projects without verified star data are not ranked. Unlisted entries show the review reason.', 'rule.listed': 'Only Catalog-approved plugins pinned to a full fixed Commit are included, sorted by the daily GitHub star snapshot; at most 30 entries with verified star counts are shown.', 'rule.recommended': 'Includes plugin projects whose authors publicly replied or submitted to us, ordered by recent interaction with complete pagination, regardless of star counts or admission status. Each includes its public discussion evidence. Withdrawn and non-plugin projects are excluded. Weekly star picks and labelled official-tool placements are also retained. Placement does not change listing, permissions, compatibility, or installation eligibility; unlisted projects link only to GitHub.', 'rule.essential': 'Updated weekly; preserves category leaders and category-star supplements, and places DSH Store and Build DSH Plugin in randomized positions within the top ten. Official-tool slots are not safety reviews or a claim that everyone must install them. Supplements show snapshot ranks, not category-champion claims. Unlisted entries show the review reason.',
    'loading': 'Loading the charts…', 'error': 'Charts could not be loaded. Please retry; old data is not used as the current ranking.', 'retry': 'Try again', 'previous': '← Previous', 'next': 'Next →', 'pagination.label': 'Chart pagination',
    'empty.recommended': 'No recommendations are available yet.', 'empty.popular': 'GitHub star data is not available yet. The popular chart is awaiting an update.', 'empty.listed': 'No listed plugins with verified star counts are available yet.', 'empty.essential': 'No usable category star data yet.',
    'method.title': 'How the charts work', 'method.body': 'Every project shows its Store status and unlisted reason. Popular uses daily GitHub stars for up to 100 projects; Listed selects up to 30 approved full-Commit records from that daily snapshot. Recommended includes all plugin projects with public author-interaction evidence, ordered by recent interaction in pages of 30, including projects with zero or unknown stars and pending review. Weekly star picks and labelled official-tool placements are retained. These clearly labelled official-tool slots are display placements, not star ranks or Store reviews. Must-haves uses weekly category leaders and supplements. Withdrawn, display-opted-out, and non-plugin projects are excluded from interaction picks. Unlisted projects link only to GitHub and have no Store installation action. Placement, stars, and author statements are not security, compatibility, or runtime verification and do not change installation eligibility. Routine builds preserve star snapshots; reviewed releases update the interaction list.', 'method.standards': 'Read listing standards ↗',
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
    ? `Popular snapshot: ${format(state.data.starsObservedAt)} · Weekly star snapshot: ${format(state.data.weeklyStarsObservedAt)} · Star coverage: ${coverage} · Listed: ${listed} · Not listed: ${state.data.entries.length - listed} · Weekly category leaders: ${covered}/${categories}. Catalog: ${format(state.data.catalogUpdatedAt)}. Routine site builds do not refresh stars.`
    : `热门榜日更快照：${format(state.data.starsObservedAt)} · 星标周更快照：${format(state.data.weeklyStarsObservedAt)} · 星标覆盖 ${coverage} · 已收录 ${listed} / 未收录 ${state.data.entries.length - listed} · 周榜分类覆盖 ${covered}/${categories}。目录更新：${format(state.data.catalogUpdatedAt)}。常规网站构建不会刷新星标。`
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
    if (bytes.byteLength > MAX_RANKING_SNAPSHOT_BYTES) throw new Error('Rankings exceed bound')
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
