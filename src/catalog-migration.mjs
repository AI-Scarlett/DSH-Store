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
    if (r.to.entryIds !== undefined && (!Array.isArray(r.to.entryIds) || !r.to.entryIds.length
      || new Set(r.to.entryIds).size !== r.to.entryIds.length
      || r.to.entryIds.some(id => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id)))) throw new Error('invalid migrated Bundle identity')
    if (r.to.repositoryUrl !== undefined && (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.to.repositoryUrl)
      || !/^[A-Za-z0-9._/-]+$/.test(r.to.defaultBranch ?? '')
      || ![r.repositoryIdentity?.fromId, r.repositoryIdentity?.toId, r.repositoryIdentity?.ownerUserId].every(id => Number.isSafeInteger(id) && id > 0))) throw new Error('repository migration needs immutable repository and owner identities')
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
    && r.fromCommit === entry.commit && r.toCommit === snapshot.commit && r.previousIdentityHash === catalogIdentityHash(entry)
    && (r.to.repositoryUrl ?? entry.repositoryUrl) === (snapshot.repositoryUrl ?? entry.repositoryUrl))
  return record ? { manifestPath: record.to.manifestPath, record } : { manifestPath: entry.manifestPath, record: null }
}

export function catalogMigrationSource(entry, document) {
  validateCatalogMigrations(document)
  const matches = document.migrations.filter(r => r.id === entry.id && r.repositoryUrl === entry.repositoryUrl
    && r.fromCommit === entry.commit && r.previousIdentityHash === catalogIdentityHash(entry))
  if (matches.length > 1) throw new Error('ambiguous Catalog identity migration')
  const record = matches[0]
  return { repositoryUrl: record?.to.repositoryUrl ?? entry.repositoryUrl,
    defaultBranch: record?.to.defaultBranch ?? entry.defaultBranch, record }
}

export function verifyMigrationRepositories(record, from, to) {
  if (!record?.to.repositoryUrl) return
  const identity = record.repositoryIdentity
  if (from?.id !== identity.fromId || to?.id !== identity.toId || from.owner?.id !== identity.ownerUserId
    || to.owner?.id !== identity.ownerUserId || to.html_url !== record.to.repositoryUrl
    || to.default_branch !== record.to.defaultBranch || to.private || to.archived || to.disabled) throw new Error('repository migration ownership or canonical identity changed')
}

export function migrateCatalogIdentity(entry, snapshot, manifest, document) {
  validateCatalogMigrations(document)
  const { record: r } = catalogMigrationTarget(entry, snapshot, document)
  if (!r) return { entry, applied: false }
  if (r.from.packageName !== entry.packageName || r.from.manifestPath !== entry.manifestPath || r.from.license !== entry.details.license
    || r.to.packageName !== manifest.name || r.to.license !== manifest.license) throw new Error('Catalog migration preconditions changed')
  return { applied: true, entry: { ...entry, packageName: r.to.packageName,
    repositoryUrl: r.to.repositoryUrl ?? entry.repositoryUrl, defaultBranch: r.to.defaultBranch ?? entry.defaultBranch,
    ...(r.to.entryIds ? { entryIds: [...r.to.entryIds] } : {}),
    manifestPath: r.to.manifestPath, installPath: r.to.installPath ?? null,
    details: { ...entry.details, license: r.to.license } } }
}
