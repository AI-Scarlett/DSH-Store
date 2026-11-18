import { canonicalGithubRepository } from '../src/catalog.mjs'

const FULL_SHA = /^[a-f0-9]{40}$/
const SHA256 = /^[a-f0-9]{64}$/
const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/
const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const RELEASE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function fail(message) {
  throw new TypeError(`invalid manual DSH scan plan: ${message}`)
}

function validateAuthorRequestedRecheck(value) {
  if (value.schemaVersion !== 1 || value.type !== 'author-requested-catalog-recheck') fail('unsupported author recheck plan type')
  if (typeof value.planId !== 'string' || !/^[a-z0-9][a-z0-9-]{5,100}$/.test(value.planId)) fail('author recheck plan ID is invalid')
  if (!FULL_SHA.test(value.baseCommit ?? '')) fail('author recheck base Commit must be a full Git SHA')
  const request = value.request
  if (!request || request.repository !== 'AI-Scarlett/DSH-Store'
    || !Number.isSafeInteger(request.issueNumber) || request.issueNumber < 1
    || !Number.isSafeInteger(request.commentId) || request.commentId < 1
    || !Number.isSafeInteger(request.userId) || request.userId < 1
    || !Number.isFinite(Date.parse(request.updatedAt)) || !SHA256.test(request.bodySha256 ?? '')
    || typeof request.quote !== 'string' || request.quote.length < 8
    || !/recheck|re-review|fixed.commit|复扫|复检|重新扫|重新检查/i.test(request.quote)) {
    fail('an exact live author recheck request is required')
  }
  const catalog = value.catalog
  let repositoryUrl
  try { repositoryUrl = canonicalGithubRepository(catalog?.repositoryUrl) } catch { fail('Catalog repository is invalid') }
  if (repositoryUrl !== catalog.repositoryUrl || typeof catalog.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,95}$/.test(catalog.id)
    || !FULL_SHA.test(catalog.commit ?? '') || !RELEASE.test(catalog.version ?? '')
    || catalog.status !== 'blocked' || catalog.updatePolicy !== 'external-only') {
    fail('author rechecks may refresh only the exact blocked external-only Catalog entry')
  }
  if (!FULL_SHA.test(value.source?.commit ?? '') || !RELEASE.test(value.source?.version ?? '')) fail('author recheck source identity is invalid')
  if (value.authorization?.source !== 'direct-user-request' || typeof value.authorization.request !== 'string'
    || !value.authorization.request.trim()) fail('direct user authorization is required')

  if (value.withdrawal !== undefined) {
    const withdrawal = value.withdrawal
    let withdrawalRepository
    try { withdrawalRepository = canonicalGithubRepository(withdrawal.repositoryUrl) } catch { fail('withdrawal repository is invalid') }
    const expectedUrl = `https://github.com/AI-Scarlett/DSH-Store/issues/${withdrawal.issueNumber}#issuecomment-${withdrawal.commentId}`
    if (withdrawalRepository !== withdrawal.repositoryUrl || typeof withdrawal.catalogId !== 'string'
      || !Number.isSafeInteger(withdrawal.issueNumber) || withdrawal.issueNumber < 1
      || !Number.isSafeInteger(withdrawal.commentId) || withdrawal.commentId < 1
      || !Number.isSafeInteger(withdrawal.userId) || withdrawal.userId < 1
      || !Number.isFinite(Date.parse(withdrawal.updatedAt)) || !SHA256.test(withdrawal.bodySha256 ?? '')
      || withdrawal.requestUrl !== expectedUrl || withdrawal.expectedRepositoryState !== 'not-found'
      || typeof withdrawal.quote !== 'string' || !/deleted|已删除|不存在/i.test(withdrawal.quote)
      || !/close|关闭/i.test(withdrawal.quote) || !/unlist|下架/i.test(withdrawal.quote)) {
      fail('withdrawal requires a hash-bound author request to close and unlist the missing repository')
    }
  }
  return value
}

function validateReviewedFixedSourceUpdate(value) {
  if (value.schemaVersion !== 1 || value.type !== 'reviewed-fixed-source-catalog-update') fail('unsupported reviewed fixed-source update plan type')
  if (typeof value.planId !== 'string' || !/^[a-z0-9][a-z0-9-]{5,100}$/.test(value.planId)) fail('reviewed update plan ID is invalid')
  if (!FULL_SHA.test(value.baseCommit ?? '')) fail('reviewed update base Commit must be full')

  const target = value.target
  let repositoryUrl
  try { repositoryUrl = canonicalGithubRepository(target?.repositoryUrl) } catch { fail('reviewed update Catalog repository is invalid') }
  if (repositoryUrl !== 'https://github.com/AI-Scarlett/DSH-Store' || target.repositoryUrl !== repositoryUrl
    || target.id !== 'dsh-safe-plugin-manager' || !FULL_SHA.test(target.commit ?? '')
    || !RELEASE.test(target.version ?? '') || target.detailPath !== 'registry/catalog/details/dsh-safe-plugin-manager.json') {
    fail('reviewed updates are limited to the exact first-party DSH-Store Catalog entry')
  }

  const source = value.source
  if (!source || source.repositoryUrl !== repositoryUrl || !FULL_SHA.test(source.commit ?? '')
    || !FULL_SHA.test(source.sourceTree ?? '') || source.packageName !== 'dsh-safe-plugin-manager'
    || !RELEASE.test(source.version ?? '') || source.manifestPath !== 'package.json'
    || !Array.isArray(source.entryIds) || source.entryIds.length !== 1 || source.entryIds[0] !== target.id
    || !SHA256.test(source.sourceBinding ?? '') || !SHA256.test(source.sourceDigest ?? '')) {
    fail('reviewed source identity and immutable scan binding are required')
  }

  const review = value.review
  if (!review || review.commit !== source.commit || review.binding !== source.sourceBinding
    || review.verdict !== 'approved' || review.documentPath !== 'docs/reviews/store-0948-source-review-20261119.json'
    || !SHA256.test(review.documentSha256 ?? '')) {
    fail('reviewed update must match the exact first-party source review record')
  }

  const expectedScope = [
    'registry/catalog-index.json',
    'registry/catalog.json',
    target.detailPath,
  ].sort()
  if (!Array.isArray(value.scope) || JSON.stringify([...value.scope].sort()) !== JSON.stringify(expectedScope)) {
    fail('reviewed update scope must contain only the exact Catalog bridge, index, and detail')
  }

  const files = value.preconditions?.files
  if (!files || typeof files !== 'object' || Array.isArray(files)) fail('reviewed update file preconditions are required')
  const requiredFiles = [
    ...expectedScope,
    'registry/admission-reviews.json',
    review.documentPath,
  ].sort()
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(requiredFiles)
    || Object.entries(files).some(([file, digest]) => !/^[a-zA-Z0-9._/-]+$/.test(file) || file.includes('..')
      || !SHA256.test(digest ?? ''))) {
    fail('reviewed update must hash-bind its complete Catalog scope and review authority')
  }
  if (files[review.documentPath] !== review.documentSha256) fail('reviewed source document hash differs from its file precondition')

  const authorization = value.authorization
  if (!authorization || authorization.source !== 'direct-user-request'
    || typeof authorization.request !== 'string' || authorization.request.length < 20
    || authorization.reviewer !== 'Codex on behalf of AI-Scarlett'
    || !Number.isFinite(Date.parse(authorization.reviewedAt))
    || typeof authorization.rationale !== 'string' || authorization.rationale.length < 20) {
    fail('reviewed update requires the exact owner request and completed fixed-source review')
  }
  if (value.rollback?.type !== 'git-revert' || typeof value.rollback.description !== 'string'
    || value.rollback.description.length < 20) fail('reviewed update rollback must use recoverable Git history')
  return value
}

export function validateManualScanPlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object is required')
  if (value.type === 'author-requested-catalog-recheck') return validateAuthorRequestedRecheck(value)
  if (value.type === 'reviewed-fixed-source-catalog-update') return validateReviewedFixedSourceUpdate(value)
  if (value.schemaVersion !== 1 || value.type !== 'manual-dsh-known-plugin-rescan') fail('unsupported plan type')
  const scan = value.scan
  if (!scan || typeof scan !== 'object' || scan.status !== 'complete') fail('complete scan evidence is required')
  if (typeof scan.planId !== 'string' || !/^[a-z0-9][a-z0-9-]{5,100}$/.test(scan.planId)) fail('scan plan ID is invalid')
  if (!FULL_SHA.test(scan.baseCommit ?? '')) fail('scan base Commit must be a full Git SHA')
  if (!Number.isSafeInteger(scan.targetCount) || scan.targetCount < 1
    || scan.completedTargetCount !== scan.targetCount) fail('every addressable target must have a terminal result')
  if (!Array.isArray(scan.latestDshReleases) || scan.latestDshReleases.length !== 3
    || new Set(scan.latestDshReleases).size !== 3 || scan.latestDshReleases.some(release => !RELEASE.test(release))) {
    fail('the complete official latest-three DSH window is required')
  }
  for (const field of ['sourceIndexSha256', 'mainResultsSha256', 'supplementalResultsSha256', 'officialWindowSha256']) {
    if (!SHA256.test(scan[field] ?? '')) fail(`${field} must be a SHA-256 digest`)
  }
  if (typeof scan.sourceUrl !== 'string' || scan.sourceUrl !== 'https://cdn.dsh.so/plugins-index.json') fail('unexpected scan source')
  if (typeof scan.sourceGeneratedAt !== 'string' || Number.isNaN(Date.parse(scan.sourceGeneratedAt))) fail('source generation time is invalid')
  if (!scan.outcomes || typeof scan.outcomes !== 'object' || Array.isArray(scan.outcomes)) fail('outcome counts are required')
  const outcomeTotal = Object.values(scan.outcomes).reduce((sum, count) => {
    if (!Number.isSafeInteger(count) || count < 0) fail('outcome counts must be non-negative integers')
    return sum + count
  }, 0)
  if (outcomeTotal !== scan.targetCount || (scan.outcomes['pending-transient'] ?? 0) !== 0) {
    fail('outcome counts must cover all targets with no pending transient result')
  }
  if (!Array.isArray(value.selected) || value.selected.length < 1 || value.selected.length > 200) fail('selected admission set is outside bounds')
  if (scan.selectedCount !== value.selected.length) fail('selected admission count does not match the plan')

  const repositories = new Set()
  const entryIds = new Set()
  const selected = value.selected.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`selected[${index}] must be an object`)
    let repositoryUrl
    try { repositoryUrl = canonicalGithubRepository(entry.repositoryUrl) } catch { fail(`selected[${index}] repository is invalid`) }
    if (repositoryUrl !== entry.repositoryUrl) fail(`selected[${index}] repository must be canonical`)
    if (repositories.has(repositoryUrl.toLowerCase())) fail('repositories must be unique')
    repositories.add(repositoryUrl.toLowerCase())
    if (!FULL_SHA.test(entry.commit ?? '')) fail(`selected[${index}] Commit must be full and immutable`)
    if (entry.outcome !== 'eligible' || entry.scanComplete !== true || entry.admissionState !== 'source-verified') {
      fail(`selected[${index}] is not a complete source-verified scan result`)
    }
    for (const field of ['sourceBinding', 'sourceDigest']) {
      if (!SHA256.test(entry[field] ?? '')) fail(`selected[${index}].${field} must be a SHA-256 digest`)
    }
    if (typeof entry.packageName !== 'string' || !PACKAGE_NAME.test(entry.packageName)) fail(`selected[${index}] package name is invalid`)
    if (typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(entry.version)) {
      fail(`selected[${index}] package version is invalid`)
    }
    if (typeof entry.manifestPath !== 'string' || entry.manifestPath.startsWith('/')
      || entry.manifestPath.includes('..') || entry.manifestPath.includes('\\') || !entry.manifestPath.endsWith('package.json')) {
      fail(`selected[${index}] manifest path is invalid`)
    }
    if (!Array.isArray(entry.entryIds) || entry.entryIds.length < 1 || entry.entryIds.some(id => !ENTRY_ID.test(id))) {
      fail(`selected[${index}] Bundle entry IDs are invalid`)
    }
    for (const id of entry.entryIds) {
      const key = id.toLowerCase()
      if (entryIds.has(key)) fail(`selected Bundle entry ID collision: ${id}`)
      entryIds.add(key)
    }
    const compatibility = entry.compatibility
    if (!compatibility || typeof compatibility.dsh !== 'string' || !compatibility.dsh.trim()
      || !compatibility.dshReleases || typeof compatibility.dshReleases !== 'object' || Array.isArray(compatibility.dshReleases)) {
      fail(`selected[${index}] DSH compatibility evidence is required`)
    }
    if (!scan.latestDshReleases.some(release => compatibility.dshReleases[release] === 'compatible')) {
      fail(`selected[${index}] has no compatible result in the scanned official latest-three window`)
    }
    for (const [release, status] of Object.entries(compatibility.dshReleases)) {
      if (!RELEASE.test(release) || !['compatible', 'incompatible', 'unknown'].includes(status)) {
        fail(`selected[${index}] has invalid exact compatibility evidence`)
      }
    }
    return {
      repositoryUrl,
      commit: entry.commit,
      packageName: entry.packageName,
      version: entry.version,
      manifestPath: entry.manifestPath,
      entryIds: [...entry.entryIds],
      outcome: entry.outcome,
      scanComplete: entry.scanComplete,
      admissionState: entry.admissionState,
      sourceBinding: entry.sourceBinding,
      sourceDigest: entry.sourceDigest,
      compatibility: {
        dsh: compatibility.dsh,
        dshReleases: { ...compatibility.dshReleases },
      },
    }
  })

  return { ...value, selected }
}
