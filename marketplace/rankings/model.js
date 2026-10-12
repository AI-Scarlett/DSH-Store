// Shared by the static builder and browser. Rankings never change Catalog approval.
export const PAGE_SIZE = 30
export const RANKING_TYPES = ['popular', 'recommended', 'essential']
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const validStars = value => Number.isSafeInteger(value) && value >= 0
const validRepository = value => typeof value === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
const compareId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const compareStars = (a, b) => b.stars - a.stars || compareId(a, b)
const categoryNamesEn = { marketplace: 'Marketplace', management: 'Management', sessions: 'Sessions', import: 'Import', models: 'Models', routing: 'Routing', ui: 'Interface', themes: 'Themes', memory: 'Memory', tools: 'Tools', workflow: 'Workflow', notifications: 'Notifications', development: 'Development', fun: 'Fun', files: 'Files', visualization: 'Visualization', design: 'Design', search: 'Search', suites: 'Suites', clients: 'Clients', security: 'Security', experimental: 'Experimental' }

export function isDshDiscoveryCandidate(entry) {
  return (entry.topics || []).some(topic => ['dsh', 'dsh-plugin', 'deepseek-harness', 'deepseek-harness-plugin'].includes(topic.toLowerCase()))
    || /(?:\bdsh(?:\b|插件)|deepseek[- ]harness)/i.test(`${entry.name || ''} ${entry.description || ''}`)
}

// Display eligibility is independent of Catalog admission. No install fields are exported.
export function createRankingSnapshot(catalog, index, { sourceCommit, candidates = { entries: [] }, starsObservedAt = null } = {}) {
  const indexed = new Map(index.entries.map(entry => [entry.id, entry]))
  const categories = Object.entries(catalog.registry.categories || {}).map(([id, zh]) => ({ id, zh, en: categoryNamesEn[id] || id }))
  const knownCategories = new Set(categories.map(category => category.id))
  const repositories = new Set()
  const entries = catalog.entries.map(entry => {
    const light = indexed.get(entry.id)
    if (!light || light.status !== entry.status || light.version !== entry.version || light.repositoryUrl !== entry.repositoryUrl) throw new Error(`Ranking index identity mismatch: ${entry.id}`)
    if (!validRepository(entry.repositoryUrl)) throw new Error('Ranking repository must be canonical GitHub')
    repositories.add(entry.repositoryUrl.toLowerCase())
    return {
      id: entry.id, nameZh: light.nameZh || entry.name, nameEn: light.nameEn || entry.name,
      version: entry.version, repositoryUrl: entry.repositoryUrl, description: (entry.description || '').slice(0, 280),
      categories: [...new Set((entry.categories || []).filter(id => knownCategories.has(id)))],
      featured: entry.featured === true, order: Number.isSafeInteger(light.order) ? light.order : Number.MAX_SAFE_INTEGER,
      listingStatus: entry.status === 'approved' && /^[a-f0-9]{40}$/.test(entry.commit || '') ? 'listed' : 'not-listed',
      source: 'catalog', reviewStatus: entry.status,
      stars: starsObservedAt && validStars(entry.github?.stars) ? entry.github.stars : null,
    }
  })
  // A candidate must never shadow a Catalog identity or create a second repository entry.
  // Distinct Catalog packages in a monorepo retain their individual identities.
  for (const entry of candidates.entries) {
    if (!isDshDiscoveryCandidate(entry)) continue
    if (!validRepository(entry.repositoryUrl)) throw new Error('Ranking repository must be canonical GitHub')
    const key = entry.repositoryUrl.toLowerCase()
    if (repositories.has(key)) continue
    repositories.add(key)
    entries.push({
      id: `candidate:${entry.id}`, nameZh: entry.name, nameEn: entry.name, version: '',
      repositoryUrl: entry.repositoryUrl, description: (entry.description || '').slice(0, 280),
      // Only explicit category IDs are usable evidence. Do not guess from descriptions.
      categories: [...new Set((entry.topics || []).filter(id => knownCategories.has(id)))],
      featured: false, order: Number.MAX_SAFE_INTEGER,
      listingStatus: 'not-listed', source: 'candidate', reviewStatus: entry.status, stars: null,
    })
  }
  return { schemaVersion: 2, sourceCommit, catalogUpdatedAt: catalog.registry.updatedAt,
    candidatesUpdatedAt: candidates.registry?.updatedAt || null, starsObservedAt, categories, entries }
}

export function validateRankingSnapshot(data) {
  if (data?.schemaVersion !== 2 || !Array.isArray(data.entries) || data.entries.length > 10000 || !Array.isArray(data.categories)) throw new Error('Invalid rankings snapshot')
  if (typeof data.catalogUpdatedAt !== 'string' || !Number.isFinite(Date.parse(data.catalogUpdatedAt))) throw new Error('Invalid Catalog date')
  for (const key of ['starsObservedAt', 'candidatesUpdatedAt']) {
    if (data[key] !== null && (typeof data[key] !== 'string' || !Number.isFinite(Date.parse(data[key])))) throw new Error('Invalid rankings date')
  }
  const categories = new Set()
  for (const category of data.categories) {
    if (!category || !/^[a-z0-9-]+$/.test(category.id) || categories.has(category.id) || typeof category.zh !== 'string' || typeof category.en !== 'string') throw new Error('Invalid ranking category')
    categories.add(category.id)
  }
  const ids = new Set()
  for (const entry of data.entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || !validRepository(entry.repositoryUrl)
      || !['nameZh', 'nameEn', 'description', 'version'].every(key => typeof entry[key] === 'string')
      || typeof entry.featured !== 'boolean' || !Number.isSafeInteger(entry.order) || entry.order < 0
      || !['listed', 'not-listed'].includes(entry.listingStatus) || !['catalog', 'candidate'].includes(entry.source)
      || !(entry.source === 'catalog' ? ['approved', 'blocked', 'unlisted'] : ['discovered', 'reviewing', 'rejected']).includes(entry.reviewStatus)
      || (entry.listingStatus === 'listed' && (entry.source !== 'catalog' || entry.reviewStatus !== 'approved'))
      || (entry.source === 'candidate' && entry.featured)
      || (entry.stars !== null && (!data.starsObservedAt || !validStars(entry.stars)))
      || !Array.isArray(entry.categories) || entry.categories.some(id => !categories.has(id))) throw new Error('Invalid ranking entry')
    ids.add(entry.id)
  }
  return data
}

export function rankingEntries(data, type) {
  const known = data.entries.filter(entry => validStars(entry.stars)).slice().sort(compareStars)
  if (type === 'popular') return known
  if (type === 'recommended') {
    // `featured` is a legacy display flag, not evidence of a recommendation or
    // review. Until explicit editorial evidence exists, use only observed stars.
    return known.filter(entry => entry.stars > 0 && !['rejected', 'blocked'].includes(entry.reviewStatus))
      .slice(0, PAGE_SIZE).map(entry => ({ ...entry, recommendationKind: 'community-stars' }))
  }
  if (type !== 'essential') throw new Error('Unknown ranking type')
  const winners = new Map()
  for (const category of data.categories) {
    const members = data.entries.filter(entry => entry.categories.includes(category.id))
    // A missing counter could belong to the true leader. Do not invent a winner.
    if (!members.length || members.some(entry => !validStars(entry.stars))) continue
    const eligible = known.filter(entry => entry.categories.includes(category.id))
    const winner = eligible[0]
    if (!winners.has(winner.id)) winners.set(winner.id, { ...winner, wins: [] })
    winners.get(winner.id).wins.push({ ...category, tied: eligible.filter(entry => entry.stars === winner.stars).length > 1 })
  }
  const result = [...winners.values()].sort(compareStars)
  const selected = new Set(result.map(entry => entry.id))
  const categories = data.categories.map(category => ({
    category, members: known.filter(entry => entry.categories.includes(category.id)),
  }))
  // Leaders retain their original rule. Fill the rest with round-robin
  // category picks, explicitly labelled observed ranks rather than champions.
  for (let rank = 0; rank < known.length && result.length < PAGE_SIZE; rank++) {
    let any = false
    for (const { category, members } of categories) {
      const entry = members[rank]
      if (!entry) continue
      any = true
      if (result.length >= PAGE_SIZE) break
      if (selected.has(entry.id) || entry.stars === 0 || ['rejected', 'blocked'].includes(entry.reviewStatus)) continue
      selected.add(entry.id)
      result.push({ ...entry, wins: [], categoryPick: { ...category, observedRank: rank + 1 } })
    }
    if (!any) break
  }
  return result
}

export function rankingPage(data, type, requestedPage = 1) {
  const entries = rankingEntries(data, type)
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const page = Math.min(pageCount, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1))
  return { entries: entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: entries.length, page, pageCount }
}

export function renderRankingRows(entries, { type = 'popular', locale = 'zh', offset = 0 } = {}) {
  const en = locale === 'en'
  return entries.map((entry, index) => {
    const name = en ? entry.nameEn : entry.nameZh
    const alternate = en ? entry.nameZh : entry.nameEn
    const rank = offset + index + 1
    const sourceName = entry.repositoryUrl.replace('https://github.com/', '')
    const reason = type === 'essential' ? `<div class="ranking-wins">${entry.categoryPick
      ? `<span>${escapeHtml(en ? entry.categoryPick.en : entry.categoryPick.zh)} · ${en ? 'Category supplement · observed #' : '分类高星补充 · 当前数据第 '}${entry.categoryPick.observedRank}${en ? '' : ' 名'}</span>`
      : entry.wins.map(win => `<span>${escapeHtml(en ? win.en : win.zh)}${win.tied ? (en ? ' · tied lead' : ' · 并列最高') : (en ? ' · #1' : ' · 星标第一')}</span>`).join('')}</div>`
      : type === 'recommended' ? `<span class="ranking-pick">${entry.recommendationKind === 'community-stars' && validStars(entry.stars) && entry.stars > 0 && !['rejected', 'blocked'].includes(entry.reviewStatus)
        ? (en ? `Basis: ${entry.stars.toLocaleString('en-US')} GitHub stars · selected by star count, not a Store review` : `入榜依据：GitHub ${entry.stars.toLocaleString('zh-CN')} 星 · 按星标排序，非商城评测推荐`)
        : (en ? 'Recommendation basis unavailable' : '暂无可核验的推荐依据')}</span>` : ''
    const listed = entry.listingStatus === 'listed'
    const href = listed ? `../plugins/?q=${encodeURIComponent(entry.id)}` : entry.repositoryUrl
    const external = listed ? '' : ' target="_blank" rel="noopener noreferrer"'
    const badge = `<span class="ranking-listing ${listed ? 'is-listed' : 'is-not-listed'}">${en ? (listed ? 'Listed' : 'Not listed') : (listed ? '已收录' : '未收录')}</span>`
    const boundary = listed ? '' : `<p class="ranking-boundary">${en ? (entry.source === 'candidate' ? 'Discovery candidate · DSH plugin compatibility unverified · GitHub only' : 'Not available through the Store · View source on GitHub') : (entry.source === 'candidate' ? '发现候选 · 尚未核验为标准 DSH 插件 · 仅查看 GitHub' : '暂未获准商城安装 · 前往 GitHub 了解项目')}</p>`
    return `<li class="ranking-row${rank <= 3 ? ' ranking-podium' : ''}" data-ranking-id="${escapeHtml(entry.id)}" data-listing-status="${listed ? 'listed' : 'not-listed'}">
      <span class="ranking-position">${String(rank).padStart(2, '0')}</span>
      <span class="ranking-icon" aria-hidden="true">${escapeHtml(name.replace(/^DSH[\s-]*/i, '').slice(0, 2).toUpperCase())}</span>
      <div class="ranking-copy"><div class="ranking-name"><a href="${escapeHtml(href)}"${external}>${escapeHtml(name)}</a>${entry.version ? `<small>v${escapeHtml(entry.version)}</small>` : ''}${badge}</div>
      ${alternate !== name ? `<div class="ranking-alternate">${escapeHtml(alternate)}</div>` : ''}${reason}
      <p class="ranking-description">${escapeHtml(en ? sourceName : entry.description)}</p>${boundary}</div>
      <div class="ranking-metric"><strong><span aria-hidden="true">☆</span> ${validStars(entry.stars) ? entry.stars.toLocaleString(en ? 'en-US' : 'zh-CN') : '—'}</strong><span>${validStars(entry.stars) ? 'GitHub Stars' : (en ? 'Stars unavailable' : '星标未获取')}</span></div>
      <a class="ranking-source" href="${escapeHtml(entry.repositoryUrl)}" target="_blank" rel="noopener noreferrer" aria-label="GitHub: ${escapeHtml(name)}">GitHub <span aria-hidden="true">↗</span></a>
    </li>`
  }).join('\n')
}
