const VALID_CATALOG_STATUSES = new Set(['approved', 'blocked', 'unlisted'])
const UNCATEGORIZED = 'uncategorized'
const PUBLIC_DISCOVERY_CDN_URL = 'https://ai-scarlett.github.io/DSH-Store/registry/discovery-index.json'

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function appendVersion(url, sha256) {
  const versioned = new URL(url)
  if (/^[0-9a-f]{64}$/.test(sha256 || '')) versioned.searchParams.set('v', sha256.slice(0, 12))
  return versioned.href
}

function gzipUrl(url) {
  const compressed = new URL(url)
  compressed.pathname += '.gz'
  return compressed.href
}

function validateDiscoveryPayload(payload, integrity) {
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload.entries) || !payload.source
    || payload.source.url !== 'https://www.dsh.so/plugins-index.json'
    || payload.source.license?.spdx !== 'CC-BY-4.0'
    || payload.source.license?.attribution !== 'dsh.so — DSH Developer Hub (https://www.dsh.so)'
    || !Number.isInteger(payload.source.recordCount) || payload.source.recordCount !== payload.entries.length
    || payload.entries.length > 50_000 || !Number.isFinite(Date.parse(payload.source.generatedAt))) {
    throw new Error('discovery index schema, attribution, timestamp, or row count is invalid')
  }
  if (integrity && payload.entries.length !== integrity.count) throw new Error('discovery index row count does not match the build')
  return payload
}

export async function fetchPublicDiscoveryIndex({ url, integrity = null, fetchImpl = globalThis.fetch } = {}) {
  if (typeof url !== 'string' || typeof fetchImpl !== 'function') throw new Error('discovery index URL or fetch implementation is unavailable')
  const version = integrity?.sha256 || ''
  const primaryUrl = appendVersion(url, version)
  const fallbackUrl = appendVersion(PUBLIC_DISCOVERY_CDN_URL, version)
  const targets = [
    { url: gzipUrl(primaryUrl), timeoutMs: 15_000 },
    { url: gzipUrl(fallbackUrl), timeoutMs: 120_000 },
    { url: primaryUrl, timeoutMs: 20_000 },
  ]
  const failures = []
  for (const target of targets) {
    try {
      const response = await fetchImpl(target.url, { cache: 'default', signal: AbortSignal.timeout(target.timeoutMs) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const contentLength = Number(response.headers.get('content-length'))
      const contentEncoding = response.headers.get('content-encoding')?.toLowerCase() || ''
      const gzipTransport = new URL(target.url).pathname.endsWith('.gz')
      const needsGzipDecompression = gzipTransport && !contentEncoding
      const maximum = needsGzipDecompression ? 4 * 1024 * 1024 : 12 * 1024 * 1024
      if (Number.isFinite(contentLength) && contentLength > maximum) throw new Error('discovery index response exceeds the byte bound')
      let bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > maximum) throw new Error('discovery index response exceeds the byte bound')
      if (needsGzipDecompression) {
        if (typeof DecompressionStream !== 'function') throw new Error('gzip decompression is unavailable')
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
        bytes = new Uint8Array(await new Response(stream).arrayBuffer())
      }
      if (bytes.byteLength > 12 * 1024 * 1024) throw new Error('expanded discovery index exceeds the byte bound')
      if (integrity) {
        if (bytes.byteLength !== integrity.bytes) throw new Error('discovery index byte length does not match the build')
        if (!globalThis.crypto?.subtle) throw new Error('discovery index integrity verification is unavailable')
        const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
          .map(value => value.toString(16).padStart(2, '0')).join('')
        if (digest !== integrity.sha256) throw new Error('discovery index SHA-256 does not match the build')
      }
      return validateDiscoveryPayload(JSON.parse(new TextDecoder().decode(bytes)), integrity)
    } catch (error) {
      failures.push(`${target.url}: ${error.message}`)
    }
  }
  throw new Error(failures.join(' | ') || 'Public discovery index is unavailable')
}

function cleanText(value, fallback = '', limit = 2_000) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback
}

function repositoryUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com'
      || url.username || url.password || url.search || url.hash) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 2) return null
    const repo = parts[1].replace(/\.git$/i, '')
    if (!/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null
    return `https://github.com/${parts[0]}/${repo}`
  } catch {
    return null
  }
}

function publicDetailUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'www.dsh.so'
      && url.pathname.startsWith('/artifact/') && !url.username && !url.password
      ? url.href : null
  } catch {
    return null
  }
}

function categoriesFor(values, allowedCategories = null) {
  const categories = [...new Set((Array.isArray(values) ? values : [])
    .map(value => typeof value === 'string'
      ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
      : '')
    .filter(value => value && (!allowedCategories || allowedCategories.has(value))))]
  return categories.length ? categories : [UNCATEGORIZED]
}

function collectionMatch(row, indexes) {
  const keys = [
    row.sourceId && indexes.byId.get(row.sourceId.toLowerCase()),
    row.alias && indexes.byPackage.get(row.alias.toLowerCase()),
    row.packageName && indexes.byPackage.get(row.packageName.toLowerCase()),
    row.repositoryUrl && indexes.byRepository.get(row.repositoryUrl.toLowerCase()),
  ]
  return keys.find(Boolean) || null
}

function createCatalogIndexes(entries, allowedCategories) {
  const catalog = (Array.isArray(entries) ? entries : []).filter(isRecord)
    .map((entry, index) => ({
      id: cleanText(entry.id, `catalog-record-${index + 1}`, 240),
      nameZh: cleanText(entry.nameZh || entry.name, entry.packageName || entry.id || `插件记录 ${index + 1}`, 240),
      nameEn: cleanText(entry.nameEn || entry.name, entry.packageName || entry.id || `Plugin record ${index + 1}`, 240),
      packageName: cleanText(entry.packageName, '', 500),
      version: cleanText(entry.version, '', 120),
      repositoryUrl: repositoryUrl(entry.repositoryUrl),
      categories: categoriesFor(entry.categories, allowedCategories),
      searchTerms: Array.isArray(entry.searchTerms) ? entry.searchTerms.filter(value => typeof value === 'string') : [],
      description: cleanText(entry.description, '', 2_000),
      detailPath: cleanText(entry.detailPath, '', 500),
      status: VALID_CATALOG_STATUSES.has(entry.status) ? entry.status : 'unlisted',
      source: 'catalog',
      sourceId: cleanText(entry.id, `catalog-record-${index + 1}`, 240),
      alias: '',
      stars: Number.isSafeInteger(entry.stars) && entry.stars >= 0 ? entry.stars : null,
      kind: 'store-catalog',
      detailUrl: null,
    }))

  const indexes = { byId: new Map(), byPackage: new Map(), byRepository: new Map() }
  for (const entry of catalog) {
    indexes.byId.set(entry.id.toLowerCase(), entry)
    if (entry.packageName) indexes.byPackage.set(entry.packageName.toLowerCase(), entry)
    if (entry.repositoryUrl) {
      if (!indexes.byRepository.has(entry.repositoryUrl.toLowerCase())) {
        indexes.byRepository.set(entry.repositoryUrl.toLowerCase(), entry)
      }
    }
  }
  return { catalog, indexes }
}

export function createKnownPluginDirectory(catalogEntries, candidateEntries, { discoveryIndex = null, locale = 'zh' } = {}) {
  const discoveryRows = Array.isArray(discoveryIndex?.entries) ? discoveryIndex.entries : []
  const allowedCategories = discoveryRows.length
    ? new Set(discoveryRows.flatMap(entry => isRecord(entry) && Array.isArray(entry.categories) ? entry.categories : []))
    : null
  const { catalog, indexes } = createCatalogIndexes(catalogEntries, allowedCategories)
  const entries = []
  const bySourceId = new Map()
  const byAlias = new Map()
  const byPackage = new Map()
  const byRepository = new Map()
  const add = (row, mapSource = true) => {
    const categories = categoriesFor(row.categories)
    const item = {
      ...row,
      categories,
      listingStatus: row.collected ? 'listed' : 'unlisted',
      listingReason: row.collected ? null : (locale === 'en'
        ? 'No matching DSH STORE Catalog record was found. This is only a listing state.'
        : '尚未匹配到 DSH STORE Catalog 条目；此状态只表示目录是否收录。'),
      searchTerms: Array.isArray(row.searchTerms) ? row.searchTerms.filter(value => typeof value === 'string') : [],
    }
    entries.push(item)
    if (mapSource) {
      if (item.sourceId) bySourceId.set(item.sourceId.toLowerCase(), item)
      if (item.alias) byAlias.set(item.alias.toLowerCase(), item)
      if (item.packageName) byPackage.set(item.packageName.toLowerCase(), item)
      if (item.repositoryUrl) {
        const matches = byRepository.get(item.repositoryUrl.toLowerCase()) || []
        matches.push(item)
        byRepository.set(item.repositoryUrl.toLowerCase(), matches)
      }
    }
    return item
  }

  const findExisting = row => bySourceId.get(row.sourceId?.toLowerCase())
    || byAlias.get(row.alias?.toLowerCase())
    || byPackage.get(row.packageName?.toLowerCase())
    || (row.repositoryUrl ? byRepository.get(row.repositoryUrl.toLowerCase())?.[0] : null)
    || null

  discoveryRows.forEach((raw, index) => {
    const entry = isRecord(raw) ? raw : {}
    const sourceId = cleanText(entry.sourceId || entry.id, `source-record-${index + 1}`, 240)
    const alias = cleanText(entry.alias, '', 500)
    const name = cleanText(entry.name, alias || sourceId, 240)
    const repository = repositoryUrl(entry.repositoryUrl || entry.sourceUrl)
    const lookup = { sourceId, alias, packageName: alias, repositoryUrl: repository }
    const matchedCatalog = collectionMatch(lookup, indexes)
    const sourceIndex = Number.isSafeInteger(entry.sourceIndex) && entry.sourceIndex >= 0 ? entry.sourceIndex : index
    add({
      id: `dshso:${sourceIndex}:${sourceId}`,
      source: 'discovery',
      sourceId,
      sourceIndex,
      nameZh: name,
      nameEn: name,
      alias,
      packageName: alias,
      version: '',
      repositoryUrl: repository,
      categories: categoriesFor(entry.categories, allowedCategories),
      searchTerms: [sourceId, alias, ...(Array.isArray(entry.categories) ? entry.categories : [])],
      description: cleanText(entry.description, '', 2_000),
      detailUrl: publicDetailUrl(entry.detailUrl || entry.url),
      sourceUrl: repository,
      stars: Number.isSafeInteger(entry.stars) && entry.stars >= 0 ? entry.stars : 0,
      kind: cleanText(entry.kind, 'dsh-plugin', 80),
      collected: Boolean(matchedCatalog),
      collectedBy: matchedCatalog?.id || null,
      order: sourceIndex,
    })
  })

  for (const entry of catalog) {
    const lookup = { sourceId: entry.id, alias: '', packageName: entry.packageName, repositoryUrl: entry.repositoryUrl }
    const existing = findExisting(lookup)
    if (existing) {
      existing.collected = true
      existing.collectedBy = entry.id
      existing.listingStatus = 'listed'
      existing.listingReason = null
      continue
    }
    const item = add({
      ...entry,
      id: `catalog:${entry.id}`,
      collected: true,
      collectedBy: entry.id,
      order: Number.MAX_SAFE_INTEGER,
    })
    item.listingStatus = 'listed'
    item.listingReason = null
  }

  const candidateRows = Array.isArray(candidateEntries) ? candidateEntries : []
  candidateRows.forEach((raw, index) => {
    if (!isRecord(raw)) return
    const sourceId = cleanText(raw.id, `candidate-record-${index + 1}`, 240)
    const alias = cleanText(raw.packageName || raw.name, sourceId, 500)
    const repository = repositoryUrl(raw.repositoryUrl)
    const lookup = { sourceId, alias, packageName: alias, repositoryUrl: repository }
    const existing = findExisting(lookup)
    const matchedCatalog = collectionMatch(lookup, indexes)
    if (existing) {
      if (matchedCatalog) {
        existing.collected = true
        existing.collectedBy = matchedCatalog.id
        existing.listingStatus = 'listed'
        existing.listingReason = null
      }
      return
    }
    const item = add({
      id: `candidate:${sourceId}`,
      source: 'candidate',
      sourceId,
      sourceIndex: null,
      nameZh: cleanText(raw.name, sourceId, 240),
      nameEn: cleanText(raw.name, sourceId, 240),
      alias,
      packageName: alias,
      version: '',
      repositoryUrl: repository,
      categories: categoriesFor(raw.topics, allowedCategories),
      searchTerms: [sourceId, alias, ...(Array.isArray(raw.topics) ? raw.topics : [])],
      description: cleanText(raw.description, '', 2_000),
      detailUrl: null,
      sourceUrl: repository,
      stars: null,
      kind: 'store-discovery',
      collected: Boolean(matchedCatalog),
      collectedBy: matchedCatalog?.id || null,
      order: Number.MAX_SAFE_INTEGER,
    })
    if (item.collected) {
      item.listingStatus = 'listed'
      item.listingReason = null
    }
  })

  const categoryCounts = new Map()
  for (const entry of entries) {
    for (const category of entry.categories) categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1)
  }
  for (const entry of entries) {
    entry.categories.sort((a, b) => (categoryCounts.get(b) || 0) - (categoryCounts.get(a) || 0) || a.localeCompare(b))
    entry.primaryCategory = entry.categories[0] || UNCATEGORIZED
  }

  return entries
}

export function filterPluginDirectory(entries, {
  listingFilter = 'all', query = '', category = '', sort = 'recommended', locale = 'zh',
} = {}) {
  const needle = String(query).trim().toLowerCase()
  const filtered = (Array.isArray(entries) ? entries : [])
    .filter(entry => listingFilter === 'all' || entry.listingStatus === listingFilter)
    .filter(entry => !category || entry.categories.includes(category))
    .filter(entry => !needle || [entry.id, entry.sourceId, entry.nameZh, entry.nameEn, entry.alias,
      entry.packageName, entry.version, entry.repositoryUrl, entry.description, entry.listingReason,
      ...(entry.searchTerms || []), ...(entry.categories || []),
    ].some(value => String(value || '').toLowerCase().includes(needle)))

  return filtered.sort((a, b) => {
    if (sort === 'name') {
      const first = locale === 'en' ? a.nameEn : a.nameZh
      const second = locale === 'en' ? b.nameEn : b.nameZh
      return String(first).localeCompare(String(second), locale === 'en' ? 'en' : 'zh-CN')
    }
    if (sort === 'stars') return (b.stars || 0) - (a.stars || 0) || a.order - b.order
    if (sort === 'recent') return a.order - b.order
    if (sort === 'risk') return a.order - b.order
    return String(a.primaryCategory || UNCATEGORIZED).localeCompare(String(b.primaryCategory || UNCATEGORIZED), 'en')
      || Number(b.listingStatus === 'listed') - Number(a.listingStatus === 'listed')
      || (b.stars || 0) - (a.stars || 0)
      || String(a.nameZh).localeCompare(String(b.nameZh), 'zh-CN')
      || a.order - b.order
  })
}
