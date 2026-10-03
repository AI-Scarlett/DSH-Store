// Shared by the static builder and browser. Rankings never change Catalog approval.
export const PAGE_SIZE = 20
export const RANKING_TYPES = ['popular', 'recommended', 'essential']
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const validStars = value => Number.isSafeInteger(value) && value >= 0
const validRepository = value => typeof value === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
const compareId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const compareStars = (a, b) => b.stars - a.stars || compareId(a, b)
const categoryNamesEn = { marketplace: 'Marketplace', management: 'Management', sessions: 'Sessions', import: 'Import', models: 'Models', routing: 'Routing', ui: 'Interface', themes: 'Themes', memory: 'Memory', tools: 'Tools', workflow: 'Workflow', notifications: 'Notifications', development: 'Development', fun: 'Fun', files: 'Files', visualization: 'Visualization', design: 'Design', search: 'Search', suites: 'Suites', clients: 'Clients', security: 'Security', experimental: 'Experimental' }

export function createRankingSnapshot(catalog, index, { sourceCommit, starsObservedAt = null } = {}) {
  const indexed = new Map(index.entries.map(entry => [entry.id, entry]))
  const categories = Object.entries(catalog.registry.categories || {}).map(([id, zh]) => ({ id, zh, en: categoryNamesEn[id] || id }))
  const knownCategories = new Set(categories.map(category => category.id))
  const entries = catalog.entries.filter(entry => entry.status === 'approved' && /^[a-f0-9]{40}$/.test(entry.commit || '')).map(entry => {
    const light = indexed.get(entry.id)
    if (!light || light.status !== 'approved' || light.version !== entry.version || light.repositoryUrl !== entry.repositoryUrl) throw new Error(`Ranking index identity mismatch: ${entry.id}`)
    if (!validRepository(entry.repositoryUrl)) throw new Error('Ranking repository must be canonical GitHub')
    return {
      id: entry.id, nameZh: light.nameZh || entry.name, nameEn: light.nameEn || entry.name,
      version: entry.version, repositoryUrl: entry.repositoryUrl, description: entry.description || '',
      categories: (entry.categories || []).filter(id => knownCategories.has(id)),
      featured: entry.featured === true, order: Number.isSafeInteger(light.order) ? light.order : Number.MAX_SAFE_INTEGER,
      stars: starsObservedAt && validStars(entry.github?.stars) ? entry.github.stars : null,
    }
  })
  return { schemaVersion: 1, sourceCommit, catalogUpdatedAt: catalog.registry.updatedAt, starsObservedAt, categories, entries }
}

export function validateRankingSnapshot(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.entries) || data.entries.length > 10000 || !Array.isArray(data.categories)) throw new Error('Invalid rankings snapshot')
  if (typeof data.catalogUpdatedAt !== 'string' || !Number.isFinite(Date.parse(data.catalogUpdatedAt))) throw new Error('Invalid Catalog date')
  if (data.starsObservedAt !== null && (typeof data.starsObservedAt !== 'string' || !Number.isFinite(Date.parse(data.starsObservedAt)))) throw new Error('Invalid stars date')
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
      || (entry.stars !== null && (!data.starsObservedAt || !validStars(entry.stars)))
      || !Array.isArray(entry.categories) || entry.categories.some(id => !categories.has(id))) throw new Error('Invalid ranking entry')
    ids.add(entry.id)
  }
  return data
}

export function rankingEntries(data, type) {
  const known = data.entries.filter(entry => validStars(entry.stars)).slice().sort(compareStars)
  if (type === 'popular') return known
  if (type === 'recommended') return data.entries.filter(entry => entry.featured).slice().sort((a, b) => a.order - b.order || compareId(a, b))
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
  return [...winners.values()].sort(compareStars)
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
    const reason = type === 'essential' ? `<div class="ranking-wins">${entry.wins.map(win => `<span>${escapeHtml(en ? win.en : win.zh)}${win.tied ? (en ? ' · tied lead' : ' · 并列最高') : (en ? ' · #1' : ' · 星标第一')}</span>`).join('')}</div>` : type === 'recommended' ? `<span class="ranking-pick">${en ? 'Store pick' : '商城推荐'}</span>` : ''
    const query = encodeURIComponent(entry.id)
    return `<li class="ranking-row${rank <= 3 ? ' ranking-podium' : ''}" data-ranking-id="${escapeHtml(entry.id)}">
      <span class="ranking-position">${String(rank).padStart(2, '0')}</span>
      <span class="ranking-icon" aria-hidden="true">${escapeHtml(name.replace(/^DSH[\s-]*/i, '').slice(0, 2).toUpperCase())}</span>
      <div class="ranking-copy"><div class="ranking-name"><a href="../plugins/?q=${query}">${escapeHtml(name)}</a><small>v${escapeHtml(entry.version)}</small></div>
      ${alternate !== name ? `<div class="ranking-alternate">${escapeHtml(alternate)}</div>` : ''}${reason}
      <p class="ranking-description">${escapeHtml(en ? sourceName : entry.description)}</p></div>
      <div class="ranking-metric"><strong><span aria-hidden="true">☆</span> ${validStars(entry.stars) ? entry.stars.toLocaleString(en ? 'en-US' : 'zh-CN') : '—'}</strong><span>${validStars(entry.stars) ? 'GitHub Stars' : (en ? 'Stars unavailable' : '星标未获取')}</span></div>
      <a class="ranking-source" href="${escapeHtml(entry.repositoryUrl)}" target="_blank" rel="noopener noreferrer" aria-label="GitHub: ${escapeHtml(name)}">GitHub <span aria-hidden="true">↗</span></a>
    </li>`
  }).join('\n')
}
