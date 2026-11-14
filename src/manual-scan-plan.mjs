/Users/zhouxiaoming/.bash_profile: line 16: /Users/zhouxiaoming/.local/bin/env: No such file or directory
import { canonicalGithubRepository } from './catalog.mjs'

const FULL_SHA = /^[a-f0-9]{40}$/
const SHA256 = /^[a-f0-9]{64}$/
const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/
const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const RELEASE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function fail(message) {
  throw new TypeError(`invalid manual DSH scan plan: ${message}`)
}

export function validateManualScanPlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object is required')
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
