// Shared by the static builder and browser. Rankings never change Catalog approval.
export const PAGE_SIZE = 30
export const POPULAR_LIMIT = 100
export const RANKING_TYPES = ['popular', 'listed', 'recommended', 'essential']
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const validStars = value => Number.isSafeInteger(value) && value >= 0
const validRepository = value => typeof value === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
const compareId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const compareStars = (a, b) => b.stars - a.stars || compareId(a, b)
const OFFICIAL_DSH_TOOL_REPOSITORIES = [
  'https://github.com/AI-Scarlett/DSH-Store',
  'https://github.com/AI-Scarlett/build-dsh-plugin',
]
const categoryNamesEn = { marketplace: 'Marketplace', management: 'Management', sessions: 'Sessions', import: 'Import', models: 'Models', routing: 'Routing', ui: 'Interface', themes: 'Themes', memory: 'Memory', tools: 'Tools', workflow: 'Workflow', notifications: 'Notifications', development: 'Development', fun: 'Fun', files: 'Files', visualization: 'Visualization', design: 'Design', search: 'Search', suites: 'Suites', clients: 'Clients', security: 'Security', experimental: 'Experimental' }

function createPlacementRandom(seed) {
  let state = 2166136261
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619)
  if (state === 0) state = 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function withOfficialDshToolSlots(rows, snapshot, type) {
  const isOfficial = entry => OFFICIAL_DSH_TOOL_REPOSITORIES.includes(entry.repositoryUrl.toLowerCase())
  const seen = new Set()
  const official = []
  for (const repositoryUrl of OFFICIAL_DSH_TOOL_REPOSITORIES) {
    const repositoryKey = repositoryUrl.toLowerCase()
    const existing = rows.find(entry => entry.repositoryUrl.toLowerCase() === repositoryKey)
    const source = existing || snapshot.entries.find(entry => entry.repositoryUrl.toLowerCase() === repositoryKey)
    if (!source || ['blocked', 'rejected'].includes(source.reviewStatus)) continue
    if (seen.has(source.id)) continue
    seen.add(source.id)
    const entry = { ...source, officialToolPick: true }
    if (type === 'recommended') {
      entry.recommendationKind = 'official-tool'
      entry.stars = validStars(source.weeklyStars) ? source.weeklyStars : null
    } else {
      entry.stars = validStars(source.weeklyStars) ? source.weeklyStars : null
      entry.wins = Array.isArray(source.wins) ? source.wins : []
    }
    official.push(entry)
  }
  if (!official.length) return rows.slice(0, PAGE_SIZE)

  // The seed changes only when the weekly score snapshot changes. Repeated
  // three-hour storefront rebuilds therefore keep the same two top-ten slots.
  const seedDate = snapshot.weeklyStarsObservedAt || 'weekly-snapshot-unavailable'
  const random = createPlacementRandom(`${seedDate}:${type}:official-dsh-tools`)
  const ordinary = rows.filter(entry => !isOfficial(entry)).slice(0, PAGE_SIZE - official.length)
  const total = ordinary.length + official.length
  const windowSize = Math.min(10, total)
  const slots = Array.from({ length: windowSize }, (_, index) => index)
  for (let index = slots.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1))
    ;[slots[index], slots[other]] = [slots[other], slots[index]]
  }
  const output = new Array(windowSize)
  official.forEach((entry, index) => { output[slots[index]] = entry })
  let nextOrdinary = 0
  for (let index = 0; index < output.length; index++) {
    if (!output[index]) output[index] = ordinary[nextOrdinary++]
  }
  return [...output, ...ordinary.slice(nextOrdinary)]
}

function getListingReason(entry, source, listingStatus) {
  if (listingStatus === 'listed') return null
  const reason = typeof entry.statusReason === 'string' ? entry.statusReason.trim() : ''
  if (reason) return reason
  if (source === 'candidate') {
    if (entry.status === 'rejected') return 'Fixed-Commit review rejected this candidate; no detailed reason is available in the public record.'
    if (entry.status === 'reviewing') return 'This discovery candidate is still under review and has not been approved for Catalog listing.'
    return 'This discovery candidate has not completed fixed-Commit review.'
  }
  if (entry.status === 'blocked') return 'Blocked by Catalog admission policy; no detailed reason is available in the public record.'
  if (entry.status === 'unlisted') return 'Not approved for Store listing; no detailed reason is available in the public record.'
  return 'A full fixed Git Commit is not pinned, so Store listing cannot be verified.'
}

function legacyListingReason(entry) {
  if (entry.listingStatus === 'listed') return null
  if (entry.source === 'candidate') {
    if (entry.reviewStatus === 'rejected') return 'Rejected after fixed-Commit review; the older ranking snapshot does not contain the detailed reason.'
    if (entry.reviewStatus === 'reviewing') return 'Discovery candidate is under review; the older ranking snapshot does not contain the detailed reason.'
    return 'Discovery candidate has not completed fixed-Commit review.'
  }
  if (entry.reviewStatus === 'blocked') return 'Blocked by Catalog admission policy; the older ranking snapshot does not contain the detailed reason.'
  if (entry.reviewStatus === 'unlisted') return 'Not approved for Store listing; the older ranking snapshot does not contain the detailed reason.'
  return 'A full fixed Git Commit is not pinned, so Store listing cannot be verified.'
}

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
    const listingStatus = entry.status === 'approved' && /^[a-f0-9]{40}$/.test(entry.commit || '') ? 'listed' : 'not-listed'
    return {
      id: entry.id, nameZh: light.nameZh || entry.name, nameEn: light.nameEn || entry.name,
      version: entry.version, repositoryUrl: entry.repositoryUrl, description: (entry.description || '').slice(0, 280),
      categories: [...new Set((entry.categories || []).filter(id => knownCategories.has(id)))],
      featured: entry.featured === true, order: Number.isSafeInteger(light.order) ? light.order : Number.MAX_SAFE_INTEGER,
      listingStatus, listingReason: getListingReason(entry, 'catalog', listingStatus),
      source: 'catalog', reviewStatus: entry.status,
      stars: starsObservedAt && validStars(entry.github?.stars) ? entry.github.stars : null,
      weeklyStars: starsObservedAt && validStars(entry.github?.stars) ? entry.github.stars : null,
      weeklySnapshotMember: Boolean(starsObservedAt),
      weeklyCategories: starsObservedAt ? [...new Set((entry.categories || []).filter(id => knownCategories.has(id)))] : [],
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
      listingStatus: 'not-listed', source: 'candidate', reviewStatus: entry.status, stars: null, weeklyStars: null,
      listingReason: getListingReason(entry, 'candidate', 'not-listed'),
      weeklySnapshotMember: false, weeklyCategories: [],
    })
  }
  return { schemaVersion: 4, sourceCommit, catalogUpdatedAt: catalog.registry.updatedAt,
    candidatesUpdatedAt: candidates.registry?.updatedAt || null, starsObservedAt,
    weeklyStarsObservedAt: starsObservedAt, categories, entries }
}

export function validateRankingSnapshot(data) {
  // One-time migration from the public v2 snapshot: its single observed score
  // is the safest available baseline for both the daily and weekly charts.
  if (data?.schemaVersion === 2 && Array.isArray(data.entries)) {
    data = {
      ...data,
      schemaVersion: 3,
      weeklyStarsObservedAt: data.starsObservedAt ?? null,
      entries: data.entries.map(entry => ({ ...entry, weeklyStars: entry.stars,
        weeklySnapshotMember: true, weeklyCategories: [...(entry.categories || [])] })),
    }
  }
  if (data?.schemaVersion === 3 && Array.isArray(data.entries)) {
    data = {
      ...data,
      schemaVersion: 4,
      entries: data.entries.map(entry => ({ ...entry, listingReason: entry.listingReason ?? legacyListingReason(entry) })),
    }
  }
  if (data?.schemaVersion !== 4 || !Array.isArray(data.entries) || data.entries.length > 10000 || !Array.isArray(data.categories)) throw new Error('Invalid rankings snapshot')
  if (typeof data.catalogUpdatedAt !== 'string' || !Number.isFinite(Date.parse(data.catalogUpdatedAt))) throw new Error('Invalid Catalog date')
  for (const key of ['starsObservedAt', 'weeklyStarsObservedAt', 'candidatesUpdatedAt']) {
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
      || (entry.listingStatus === 'listed' ? entry.listingReason !== null : typeof entry.listingReason !== 'string' || !entry.listingReason.trim() || entry.listingReason.length > 600)
      || !(entry.source === 'catalog' ? ['approved', 'blocked', 'unlisted'] : ['discovered', 'reviewing', 'rejected']).includes(entry.reviewStatus)
      || (entry.listingStatus === 'listed' && (entry.source !== 'catalog' || entry.reviewStatus !== 'approved'))
      || (entry.source === 'candidate' && entry.featured)
      || (entry.stars !== null && (!data.starsObservedAt || !validStars(entry.stars)))
      || (entry.weeklyStars !== null && (!data.weeklyStarsObservedAt || !validStars(entry.weeklyStars)))
      || typeof entry.weeklySnapshotMember !== 'boolean'
      || !Array.isArray(entry.weeklyCategories)
      || entry.weeklyCategories.some(id => !categories.has(id))
      || (!entry.weeklySnapshotMember && (entry.weeklyStars !== null || entry.weeklyCategories.length > 0))
      || !Array.isArray(entry.categories) || entry.categories.some(id => !categories.has(id))) throw new Error('Invalid ranking entry')
    ids.add(entry.id)
  }
  return data
}

function matchingPreviousEntry(entry, previousById) {
  const previous = previousById.get(entry.id)
  return previous && previous.repositoryUrl.toLowerCase() === entry.repositoryUrl.toLowerCase() ? previous : null
}

// Rebuild metadata on every site build without silently refreshing chart scores.
// Repository identity must still match before any historical score is carried.
export function applyRankingRefreshState(input, previousInput, mode = 'reuse') {
  if (!['reuse', 'daily', 'weekly', 'baseline'].includes(mode)) throw new Error('Unknown ranking refresh mode')
  const output = structuredClone(input)
  const previous = previousInput ? validateRankingSnapshot(previousInput) : null
  const previousById = new Map((previous?.entries || []).map(entry => [entry.id, entry]))
  if (mode === 'reuse') {
    output.starsObservedAt = previous?.starsObservedAt ?? null
    output.weeklyStarsObservedAt = previous?.weeklyStarsObservedAt ?? null
    for (const entry of output.entries) {
      const old = matchingPreviousEntry(entry, previousById)
      entry.stars = old?.stars ?? null
      entry.weeklySnapshotMember = old?.weeklySnapshotMember === true
      entry.weeklyStars = entry.weeklySnapshotMember ? (old.weeklyStars ?? old.stars ?? null) : null
      entry.weeklyCategories = old?.weeklySnapshotMember === true ? [...old.weeklyCategories] : []
    }
    return validateRankingSnapshot(output)
  }

  if (!output.starsObservedAt || !output.entries.some(entry => validStars(entry.stars))) {
    throw new Error('Ranking refresh did not produce any verified GitHub star observations')
  }
  if (mode === 'weekly' || mode === 'baseline') {
    output.weeklyStarsObservedAt = output.starsObservedAt
    for (const entry of output.entries) {
      entry.weeklyStars = entry.stars
      entry.weeklySnapshotMember = true
      entry.weeklyCategories = [...entry.categories]
    }
    return validateRankingSnapshot(output)
  }

  // Daily refresh changes only Popular. If there is no weekly baseline yet,
  // seed one once; new entries after that stay out of weekly charts until Sunday.
  const hasWeeklyBaseline = Boolean(previous?.weeklyStarsObservedAt || previous?.starsObservedAt)
  output.weeklyStarsObservedAt = previous?.weeklyStarsObservedAt ?? previous?.starsObservedAt ?? output.starsObservedAt
  for (const entry of output.entries) {
    const old = matchingPreviousEntry(entry, previousById)
    entry.weeklyStars = hasWeeklyBaseline
      ? (old ? old.weeklyStars : null)
      : (old?.weeklyStars ?? old?.stars ?? entry.stars)
    entry.weeklySnapshotMember = hasWeeklyBaseline ? old?.weeklySnapshotMember === true : true
    entry.weeklyCategories = entry.weeklySnapshotMember ? [...(old?.weeklyCategories || entry.categories)] : []
  }
  return validateRankingSnapshot(output)
}

export function rankingEntries(data, type) {
  if (!RANKING_TYPES.includes(type)) throw new Error('Unknown ranking type')
  const scoreField = type === 'popular' || type === 'listed' ? 'stars' : 'weeklyStars'
  const known = data.entries.filter(entry => validStars(entry[scoreField]))
    .map(entry => ({ ...entry, stars: entry[scoreField] })).sort(compareStars)
  if (type === 'popular') return known.slice(0, POPULAR_LIMIT)
  if (type === 'listed') return known.filter(entry => entry.listingStatus === 'listed').slice(0, PAGE_SIZE)
  if (type === 'recommended') {
    // `featured` is a legacy display flag, not evidence of a recommendation or
    // review. Until explicit editorial evidence exists, use only observed stars.
    const communityPicks = known.filter(entry => entry.stars > 0 && !['rejected', 'blocked'].includes(entry.reviewStatus))
      .map(entry => ({ ...entry, recommendationKind: 'community-stars' }))
    return withOfficialDshToolSlots(communityPicks, data, type)
  }
  if (type !== 'essential') throw new Error('Unknown ranking type')
  const winners = new Map()
  for (const category of data.categories) {
    const members = data.entries.filter(entry => entry.weeklySnapshotMember
      && entry.weeklyCategories.includes(category.id) && !['rejected', 'blocked'].includes(entry.reviewStatus))
    // A missing counter could belong to the true leader. Do not invent a winner.
    if (!members.length || members.some(entry => !validStars(entry.weeklyStars))) continue
    const eligible = known.filter(entry => entry.weeklySnapshotMember && entry.weeklyCategories.includes(category.id)
      && !['rejected', 'blocked'].includes(entry.reviewStatus))
    const winner = eligible[0]
    if (!winners.has(winner.id)) winners.set(winner.id, { ...winner, wins: [] })
    winners.get(winner.id).wins.push({ ...category, tied: eligible.filter(entry => entry.stars === winner.stars).length > 1 })
  }
  const result = [...winners.values()].sort(compareStars)
  const selected = new Set(result.map(entry => entry.id))
  const categories = data.categories.map(category => ({
    category, members: known.filter(entry => entry.weeklySnapshotMember && entry.weeklyCategories.includes(category.id)
      && !['rejected', 'blocked'].includes(entry.reviewStatus)),
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
  return withOfficialDshToolSlots(result, data, type)
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
    const officialToolNote = entry.officialToolPick
      ? `<span class="ranking-pick">${en ? 'Official DSH tool · randomized weekly top-10 placement; not a star rank or Store review' : 'DSH 官方工具展示位 · 周榜随机置入前十，非星标排名或商城评测'}</span>` : ''
    const reason = type === 'essential' ? `<div class="ranking-wins">${officialToolNote}${entry.categoryPick
      ? `<span>${escapeHtml(en ? entry.categoryPick.en : entry.categoryPick.zh)} · ${en ? 'Category supplement · observed #' : '分类高星补充 · 当前数据第 '}${entry.categoryPick.observedRank}${en ? '' : ' 名'}</span>`
      : entry.wins.map(win => `<span>${escapeHtml(en ? win.en : win.zh)}${win.tied ? (en ? ' · tied lead' : ' · 并列最高') : (en ? ' · #1' : ' · 星标第一')}</span>`).join('')}</div>`
      : type === 'recommended' ? (entry.officialToolPick ? officialToolNote : `<span class="ranking-pick">${entry.recommendationKind === 'community-stars' && validStars(entry.stars) && entry.stars > 0 && !['rejected', 'blocked'].includes(entry.reviewStatus)
        ? (en ? `Basis: ${entry.stars.toLocaleString('en-US')} GitHub stars · selected by star count, not a Store review` : `入榜依据：GitHub ${entry.stars.toLocaleString('zh-CN')} 星 · 按星标排序，非商城评测推荐`)
        : (en ? 'Recommendation basis unavailable' : '暂无可核验的推荐依据')}</span>`) : ''
    const listed = entry.listingStatus === 'listed'
    const href = listed ? `../plugins/?q=${encodeURIComponent(entry.id)}` : entry.repositoryUrl
    const external = listed ? '' : ' target="_blank" rel="noopener noreferrer"'
    const badge = `<span class="ranking-listing ${listed ? 'is-listed' : 'is-not-listed'}">${en ? (listed ? 'Listed' : 'Not listed') : (listed ? '已收录' : '未收录')}</span>`
    const listingReason = listed ? null : (entry.listingReason || legacyListingReason(entry))
    const reasonCharacters = listingReason ? Array.from(listingReason) : []
    const reasonPreview = reasonCharacters.length > 200 ? `${reasonCharacters.slice(0, 200).join('')}…` : (listingReason || '')
    const fullReason = listingReason && listingReason !== reasonPreview ? `<details class="ranking-reason-details"><summary>${en ? 'Full review reason' : '查看完整审核原因'}</summary><p>${escapeHtml(listingReason)}</p></details>` : ''
    const boundary = listed ? '' : `<div class="ranking-boundary"><p><strong>${en ? 'Not listed because: ' : '未收录原因：'}</strong>${escapeHtml(reasonPreview)}</p>${fullReason}<p class="ranking-boundary-note">${en ? (entry.source === 'candidate' ? 'Discovery candidate · DSH plugin compatibility unverified · GitHub only' : 'Not available through the Store · View source on GitHub') : (entry.source === 'candidate' ? '发现候选 · 尚未核验为标准 DSH 插件 · 仅查看 GitHub' : '暂未获准商城安装 · 仅查看 GitHub')}</p></div>`
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
