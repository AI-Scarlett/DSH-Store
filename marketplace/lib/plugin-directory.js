const VALID_CATALOG_STATUSES = new Set(['approved', 'blocked', 'unlisted'])
const VALID_CANDIDATE_STATUSES = new Set(['discovered', 'reviewing', 'rejected'])
const validRepository = value => typeof value === 'string'
  && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.replace(/\/$/, ''))

export function isDshDiscoveryCandidate(entry) {
  const topics = Array.isArray(entry?.topics) ? entry.topics : []
  return topics.some(topic => typeof topic === 'string'
      && ['dsh', 'dsh-plugin', 'dsh-plugins', 'dsh-plugin-candidate', 'dsh-compatibility-review', 'deepseek-harness', 'deepseek-harness-plugin'].includes(topic.toLowerCase()))
    || /(?:\bdsh(?:\b|插件)|deepseek[- ]harness)/i.test(`${entry?.name || ''} ${entry?.description || ''}`)
}

function listingReason(entry, source, locale) {
  if (typeof entry.statusReason === 'string' && entry.statusReason.trim()) return entry.statusReason.trim()
  const en = locale === 'en'
  if (source === 'candidate') {
    if (entry.status === 'rejected') return en
      ? 'Fixed-Commit review did not pass; the public record has no more specific reason.'
      : '固定 Commit 审查未通过；公开记录没有提供更具体的原因。'
    if (entry.status === 'reviewing') return en
      ? 'This discovery candidate is still under review and is not approved for the Store Catalog.'
      : '该发现候选仍在审核中，尚未获准进入商城目录。'
    return en ? 'This discovery candidate has not completed fixed-Commit review.' : '该发现候选尚未完成固定 Commit 审查。'
  }
  if (entry.status === 'blocked') return en
    ? 'This plugin did not pass the current Store listing policy; the public record has no more specific reason.'
    : '该插件未通过当前商城收录策略；公开记录没有提供更具体的原因。'
  return en ? 'This plugin is not currently listed in the Store Catalog.' : '该插件当前未在商城目录中上架。'
}

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

export function createKnownPluginDirectory(catalogEntries, candidateEntries, { locale = 'zh' } = {}) {
  const catalog = (Array.isArray(catalogEntries) ? catalogEntries : [])
    .filter(entry => isRecord(entry)
      && typeof entry.id === 'string' && entry.id.trim()
      && validRepository(entry.repositoryUrl)
      && VALID_CATALOG_STATUSES.has(entry.status))
    .map(entry => ({
      source: 'catalog',
      id: entry.id,
      nameZh: entry.nameZh || entry.name || entry.packageName || entry.id,
      nameEn: entry.nameEn || entry.name || entry.packageName || entry.id,
      packageName: entry.packageName || '',
      version: entry.version || '',
      repositoryUrl: entry.repositoryUrl.replace(/\/$/, ''),
      categories: Array.isArray(entry.categories) ? entry.categories.filter(value => typeof value === 'string') : [],
      searchTerms: Array.isArray(entry.searchTerms) ? entry.searchTerms.filter(value => typeof value === 'string') : [],
      detailPath: entry.detailPath || '',
      catalogStatus: entry.status,
      status: entry.status,
      statusReason: typeof entry.statusReason === 'string' ? entry.statusReason : null,
      listingStatus: entry.status === 'approved' ? 'listed' : 'unlisted',
      listingReason: entry.status === 'approved' ? null : listingReason(entry, 'catalog', locale),
      featured: entry.featured === true,
      order: Number.isSafeInteger(entry.order) ? entry.order : Number.MAX_SAFE_INTEGER,
      description: typeof entry.description === 'string' ? entry.description : '',
    }))

  // A Catalog record is authoritative for its repository. Preserve distinct
  // Catalog IDs in monorepos, but do not show a second candidate card for them.
  const catalogRepositories = new Set(catalog.map(entry => entry.repositoryUrl.toLowerCase()))
  const candidates = (Array.isArray(candidateEntries) ? candidateEntries : [])
    .filter(entry => isRecord(entry)
      && typeof entry.id === 'string' && entry.id.trim()
      && typeof entry.name === 'string' && entry.name.trim()
      && validRepository(entry.repositoryUrl)
      && VALID_CANDIDATE_STATUSES.has(entry.status)
      && isDshDiscoveryCandidate(entry)
      && !catalogRepositories.has(entry.repositoryUrl.replace(/\/$/, '').toLowerCase()))
    .map(entry => ({
      source: 'candidate',
      id: `candidate:${entry.id}`,
      nameZh: entry.name,
      nameEn: entry.name,
      packageName: '',
      version: '',
      repositoryUrl: entry.repositoryUrl.replace(/\/$/, ''),
      categories: [],
      searchTerms: [],
      detailPath: '',
      catalogStatus: entry.status,
      status: entry.status,
      statusReason: typeof entry.statusReason === 'string' ? entry.statusReason : null,
      listingStatus: 'unlisted',
      listingReason: listingReason(entry, 'candidate', locale),
      featured: false,
      order: Number.MAX_SAFE_INTEGER,
      description: typeof entry.description === 'string' ? entry.description : '',
      route: typeof entry.route === 'string' ? entry.route : '',
      topics: Array.isArray(entry.topics) ? entry.topics.filter(value => typeof value === 'string') : [],
      sourceUpdatedAt: entry.sourceUpdatedAt || null,
      discoveredAt: entry.discoveredAt || null,
    }))

  return [...catalog, ...candidates]
}

export function filterPluginDirectory(entries, {
  listingFilter = 'all', query = '', category = '', sort = 'recommended', locale = 'zh',
} = {}) {
  const needle = String(query).trim().toLowerCase()
  const filtered = (Array.isArray(entries) ? entries : [])
    .filter(entry => listingFilter === 'all' || entry.listingStatus === listingFilter)
    .filter(entry => !category || entry.categories.includes(category))
    .filter(entry => !needle || [entry.id, entry.nameZh, entry.nameEn, entry.packageName,
      entry.version, entry.repositoryUrl, entry.description, entry.route, entry.statusReason, entry.listingReason,
      ...(entry.searchTerms || []), ...(entry.topics || []),
    ].some(value => String(value || '').toLowerCase().includes(needle)))

  return filtered.sort((a, b) => {
    if (sort === 'name') {
      const first = locale === 'en' ? a.nameEn : a.nameZh
      const second = locale === 'en' ? b.nameEn : b.nameZh
      return String(first).localeCompare(String(second), locale === 'en' ? 'en' : 'zh-CN')
    }
    if (sort === 'recent') {
      const aDate = Date.parse(a.sourceUpdatedAt || a.version) || 0
      const bDate = Date.parse(b.sourceUpdatedAt || b.version) || 0
      return bDate - aDate || a.order - b.order
    }
    if (sort === 'risk') return a.order - b.order
    return Number(b.listingStatus === 'listed') - Number(a.listingStatus === 'listed')
      || a.order - b.order
      || String(a.nameZh).localeCompare(String(b.nameZh), 'zh-CN')
  })
}
