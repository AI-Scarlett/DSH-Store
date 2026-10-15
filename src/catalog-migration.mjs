import { createHash } from 'node:crypto'

// Migration records are source changes reviewed in a CI-checked PR. They never
// grant admission or erase the old identity. Each immutable pair is single-use.
export function validateCatalogMigrations(document) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document.migrations)) throw new Error('invalid Catalog migration registry')
  const seen = new Set()
  for (const r of document.migrations) {
    if (!r.id || !/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(r.repositoryUrl ?? '')
      || !/^[a-f0-9]{40}$/.test(r.fromCommit ?? '') || !/^[a-f0-9]{40}$/.test(r.toCommit ?? '')
      || !/^[a-f0-9]{64}$/.test(r.previousIdentityHash ?? '')
      || typeof r.rationale !== 'string' || r.rationale.length < 20 || !r.reviewer
      || !Array.isArray(r.evidenceUrls) || !r.evidenceUrls.length
      || r.evidenceUrls.some(url => !/^https:\/\/github\.com\//.test(url))
      || !r.from || !r.to || !r.to.packageName || !r.to.manifestPath || !r.to.license
      || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(r.to.packageName)
      || r.to.packageName.startsWith('@deepseek-ai/')
      || [r.to.manifestPath, r.to.installPath].filter(v => v != null).some(v => typeof v !== 'string' || !v || v.startsWith('/') || v.includes('..') || v.includes('\\'))
      || !Number.isFinite(Date.parse(r.reviewedAt))) throw new Error('incomplete Catalog identity migration')
    const key = `${r.id}:${r.fromCommit}:${r.toCommit}`
    if (seen.has(key)) throw new Error('duplicate Catalog identity migration')
    seen.add(key)
  }
  return document
}

export function catalogIdentityHash(entry) {
  return createHash('sha256').update(JSON.stringify({ id: entry.id, repositoryUrl: entry.repositoryUrl,
    commit: entry.commit, packageName: entry.packageName, manifestPath: entry.manifestPath,
    installPath: entry.installPath ?? null, license: entry.details.license, entryIds: [...entry.entryIds].sort() })).digest('hex')
}

export function catalogMigrationTarget(entry, snapshot, document) {
  validateCatalogMigrations(document)
  const record = document.migrations.find(r => r.id === entry.id && r.repositoryUrl === entry.repositoryUrl
    && r.fromCommit === entry.commit && r.toCommit === snapshot.commit && r.previousIdentityHash === catalogIdentityHash(entry))
  return record ? { manifestPath: record.to.manifestPath, record } : { manifestPath: entry.manifestPath, record: null }
}

export function migrateCatalogIdentity(entry, snapshot, manifest, document) {
  validateCatalogMigrations(document)
  const { record: r } = catalogMigrationTarget(entry, snapshot, document)
  if (!r) return { entry, applied: false }
  if (r.from.packageName !== entry.packageName || r.from.manifestPath !== entry.manifestPath || r.from.license !== entry.details.license
    || r.to.packageName !== manifest.name || r.to.license !== manifest.license) throw new Error('Catalog migration preconditions changed')
  return { applied: true, entry: { ...entry, packageName: r.to.packageName,
    manifestPath: r.to.manifestPath, installPath: r.to.installPath ?? null,
    details: { ...entry.details, license: r.to.license } } }
}
