// Public recommendation evidence only. This is not a contact or admission ledger.
export function validateCommunityRecommendations(document) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document.entries) || document.entries.length > 2000
    || !Number.isFinite(Date.parse(document.updatedAt))) throw new Error('Invalid community recommendation registry')
  const ids = new Set()
  const identities = new Set()
  for (const entry of document.entries) {
    const identity = `${entry?.repositoryUrl?.toLowerCase()}#${entry?.manifestPath}`
    if (!entry || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(entry.id) || ids.has(entry.id) || identities.has(identity)
      || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry.repositoryUrl)
      || !/^[A-Za-z0-9_./@-]+$/.test(entry.manifestPath) || entry.manifestPath.startsWith('/') || entry.manifestPath.includes('..')
      || (entry.catalogId !== null && (typeof entry.catalogId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(entry.catalogId)))
      || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 160
      || /^(?:作者修复请求|author\s+(?:fix|remediation)\s+request)\s*[:：]/i.test(entry.name.trim())
      || !Array.isArray(entry.categories) || entry.categories.some(value => !/^[a-z0-9-]+$/.test(value))
      || entry.basis !== 'author-interaction' || !Number.isSafeInteger(entry.userId) || entry.userId < 1
      || !/^https:\/\/github\.com\/AI-Scarlett\/DSH-Store\/(?:issues|pull)\/\d+(?:#issuecomment-\d+)?$/.test(entry.evidenceUrl)
      || !Number.isFinite(Date.parse(entry.occurredAt))) throw new Error('Invalid community recommendation evidence')
    ids.add(entry.id)
    identities.add(identity)
  }
  return document
}

export function communityRecommendationEntries(document, catalogEntries, excludedRepositories = []) {
  validateCommunityRecommendations(document)
  const excluded = new Set(excludedRepositories.map(entry => String(entry.repositoryUrl).toLowerCase()))
  const byId = new Map(catalogEntries.map(entry => [entry.id, entry]))
  return document.entries.filter(entry => !excluded.has(entry.repositoryUrl.toLowerCase())).map(record => {
    const catalog = record.catalogId ? byId.get(record.catalogId) : null
    if (!record.catalogId && catalogEntries.some(entry => entry.repositoryUrl.toLowerCase() === record.repositoryUrl.toLowerCase())) {
      throw new Error(`Community recommendation must bind Catalog identity: ${record.id}`)
    }
    // A stale ID must never borrow another repository's approval or install action.
    if (record.catalogId && (!catalog || catalog.repositoryUrl.toLowerCase() !== record.repositoryUrl.toLowerCase())) {
      throw new Error(`Community recommendation Catalog identity mismatch: ${record.id}`)
    }
    return {
      ...record,
      categories: catalog?.categories ?? record.categories,
      recommendation: { basis: record.basis, evidenceUrl: record.evidenceUrl, occurredAt: record.occurredAt },
    }
  }).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id))
}

export function communityRecommendationPage(entries, options = {}) {
  const pageSize = options.pageSize ?? 20
  const requestedPage = options.page ?? 1
  const query = String(options.query ?? '').trim().toLowerCase()
  const category = String(options.category ?? '').trim().toLowerCase()
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 40
    || !Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 10000
    || query.length > 200 || category.length > 96) throw new Error('Invalid recommendation page')
  const matching = entries.filter(entry => !category || entry.categories.includes(category))
    .filter(entry => !query || [entry.id, entry.name, entry.repositoryUrl, entry.manifestPath, ...entry.categories]
      .some(value => value.toLowerCase().includes(query)))
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize))
  const page = Math.min(requestedPage, pageCount)
  return {
    entries: matching.slice((page - 1) * pageSize, page * pageSize),
    categoryIds: [...new Set(entries.flatMap(entry => entry.categories))].sort(),
    pagination: { view: 'market', featuredOnly: true, query, category, page, pageSize, total: matching.length, pageCount,
      hasPrevious: page > 1, hasNext: page < pageCount },
  }
}
