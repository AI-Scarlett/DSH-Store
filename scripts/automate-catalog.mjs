#!/usr/bin/env node
import { createCatalogGithubReader, sameCommitLineage } from './catalog-github-reader.mjs'
import { admissionBinding, admissionDecision, LICENSE_METADATA_REVIEW_REASON, validateAdmissionReviews } from '../src/admission-review.mjs'
import { catalogIdentityHash, validateCatalogMigrations, migrateCatalogIdentity, catalogMigrationTarget, catalogMigrationSource, verifyMigrationRepositories } from '../src/catalog-migration.mjs'
import { SOURCE_SCAN_BOUNDS, SCAN_POLICY_VERSION, MANIFEST_MAX_BYTES } from '../src/source-scan-policy.mjs'

import { reviewFixedSource } from '../src/fixed-source-review.mjs'
import { discoverFeedCandidates, orderDiscoveryCandidates } from '../src/discovery-feeds.mjs'
import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRepository } from './check-plugin-submission.mjs'
import { assertCatalogLocalization, localizeCatalogEntry, relocalizeCatalogEntries } from '../src/catalog-localization.mjs'
import {
  assessUpstreamVersion,
  isAutomaticPolicyBlocked,
  isPendingAutomaticPolicyRecheck,
  admissionReviewRegistryStaleForEntry,
  refreshAutomaticPolicyReview,
  buildCatalogVersionUpdate,
  catalogChangeReviewContract,
  catalogUpdateIdentityMatches,
  catalogUpdatePolicy,
  updatePolicyForAdmission,
  holdExternalOnlyAfterDisconnectedHistory,
  sourceDeclaredCompatibility,
} from '../src/catalog-update-review.mjs'
import {
  assertLegacyCatalogCompatibility,
  catalogBridgeBuffer,
  canonicalGithubRepository,
  compareCatalogEntries,
  compareVersions,
  loadCatalogFromFiles,
  splitCatalogDocument,
  validateCatalog,
} from '../src/catalog.mjs'
import { assertNoExcludedCandidates, excludedRepositoryKeys, pruneExcludedCandidates } from '../src/repository-exclusions.mjs'
import { validateCandidateRegistry } from '../src/candidates.mjs'
import { isBoundedSourceLineage, isNoCommonAncestorError } from '../src/automation-source-policy.mjs'
import { assertNoExcludedRecommendations, isBlockedAuthor, isWithdrawnRepository, pruneExcludedRecommendations } from '../src/author-exclusions.mjs'
import { validateCommunityRecommendations } from '../marketplace/lib/community-recommendations.js'
import {
  bindFixedSourceLatestDshWindow,
  applyLatestDshCompatibilityPolicy,
  createManualCompatibilityCandidateScope,
  supportsDshReleaseWindow,
  DSH_RELEASE_WINDOW_AUTHORITY,
  DSH_REGISTRY_URL,
  fetchOfficialDshReleaseWindow,
} from '../src/catalog-compatibility-policy.mjs'
import { validateManualScanPlan } from './manual-scan-plan.mjs'
import {
  inspectRejectedCandidateCompatibility,
  isDurableRejectedCandidateDecision,
  REJECTED_CANDIDATE_RETENTION_AUTHORITY,
  selectRejectedCandidateRetentionBatch,
} from '../src/candidate-retention-policy.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const catalogPath = resolve(root, 'registry/catalog.json')
const catalogIndexPath = resolve(root, 'registry/catalog-index.json')
const candidatesPath = resolve(root, 'registry/candidates.json')
const recommendationsPath = resolve(root, 'registry/community-recommendations.json')
const policyPath = resolve(root, 'registry/automation-policy.json')
const admissionReviewsPath = resolve(root, 'registry/admission-reviews.json')
const admissionReviewsBytes = await readFile(admissionReviewsPath)
const admissionReviews = validateAdmissionReviews(JSON.parse(admissionReviewsBytes.toString('utf8')))
const admissionReviewDigest = sha256(JSON.stringify(admissionReviews))
const catalogMigrations = validateCatalogMigrations(JSON.parse(await readFile(resolve(root, 'registry/catalog-migrations.json'), 'utf8')))
const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare']
const STORE_REPLY_USER_IDS = new Set([264102358, 41898282])
const INFRASTRUCTURE_CODES = new Set([
  'SUBMISSION_FETCH_UNAVAILABLE', 'SUBMISSION_GITHUB_HTTP', 'SUBMISSION_GITHUB_TIMEOUT',
  'SUBMISSION_GITHUB_NETWORK', 'SUBMISSION_REPOSITORY_HTTP', 'SUBMISSION_COMMIT_HTTP',
  'SUBMISSION_TREE_HTTP', 'SUBMISSION_SOURCE_HTTP',
])
const SELF_MANAGER_REPOSITORY = 'https://github.com/AI-Scarlett/DSH-Store'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseArgs(argv) {
  const options = {
    write: false, expectedCatalogSha: null, expectedCatalogIndexSha: null, expectedCandidatesSha: null,
    expectedRecommendationsSha: null,
    catalogBackup: null, catalogIndexBackup: null, catalogDetailsBackup: null,
    candidatesBackup: null, recommendationsBackup: null, observedAt: null, report: null,
    manualScanPlan: null, catalogOnly: false, candidateAutoAdmission: false, candidateProbe: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--write') options.write = true
    else if (value === '--expected-catalog-sha') options.expectedCatalogSha = argv[++index]
    else if (value === '--expected-catalog-index-sha') options.expectedCatalogIndexSha = argv[++index]
    else if (value === '--expected-candidates-sha') options.expectedCandidatesSha = argv[++index]
    else if (value === '--expected-recommendations-sha') options.expectedRecommendationsSha = argv[++index]
    else if (value === '--catalog-backup') options.catalogBackup = argv[++index]
    else if (value === '--catalog-index-backup') options.catalogIndexBackup = argv[++index]
    else if (value === '--catalog-details-backup') options.catalogDetailsBackup = argv[++index]
    else if (value === '--candidates-backup') options.candidatesBackup = argv[++index]
    else if (value === '--recommendations-backup') options.recommendationsBackup = argv[++index]
    else if (value === '--observed-at') options.observedAt = argv[++index]
    else if (value === '--report') options.report = argv[++index]
    else if (value === '--manual-scan-plan') options.manualScanPlan = argv[++index]
    else if (value === '--catalog-only') options.catalogOnly = true
    else if (value === '--candidate-auto-admission') options.candidateAutoAdmission = true
    else if (value === '--candidate-probe') options.candidateProbe = argv[++index]
    else throw new Error(`unknown argument: ${value}`)
  }
  return options
}

function iso(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO date-time`)
  return new Date(value).toISOString()
}

function boundedText(value, fallback, maximum = 600) {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (text || fallback).slice(0, maximum)
}

function repositoryParts(repositoryUrl) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(canonicalGithubRepository(repositoryUrl))
  return { owner: match[1], repository: match[2] }
}

function canonicalManifestRepository(value) {
  const source = typeof value === 'string' ? value : value?.url
  if (typeof source !== 'string') return null
  try { return canonicalGithubRepository(source.replace(/^git\+/, '').replace(/^git:\/\//, 'https://')) } catch { return null }
}

function requiredOwnerUserId(metadata, stage) {
  const userId = Number(metadata?.owner?.id)
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw Object.assign(new Error(`GitHub did not return a stable repository-owner identity during ${stage}`), {
      code: 'CATALOG_OWNER_ID_UNKNOWN',
    })
  }
  return userId
}

function normalizedLicense(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[()\s]/g, '')
}

function candidateId(fullName) {
  return fullName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96)
}

function routeForFailure(code) {
  if (code === 'SUBMISSION_PACKAGE_AMBIGUOUS') return 'monorepo-review'
  if (code === 'SUBMISSION_BUNDLE_MISSING') return 'adapter-required'
  return 'blocked'
}

function isSelfManagerEntry(entry) {
  const repository = typeof entry?.repositoryUrl === 'string'
    ? entry.repositoryUrl.trim().replace(/\.git\/?$/i, '').replace(/\/$/, '').toLowerCase()
    : null
  return String(entry?.id ?? '').trim().toLowerCase() === 'dsh-safe-plugin-manager'
    && repository === SELF_MANAGER_REPOSITORY.toLowerCase()
}

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))

async function retryInfrastructure(worker) {
  let lastError
  for (const retryDelay of [0, 750]) {
    if (retryDelay > 0) await delay(retryDelay)
    try { return await worker() } catch (error) {
      if (error?.code === 'CATALOG_AUTOMATION_GITHUB_BUDGET') throw error
      if (!INFRASTRUCTURE_CODES.has(error?.code) && !String(error?.code ?? '').startsWith('CATALOG_AUTOMATION_GITHUB_')) throw error
      lastError = error
    }
  }
  throw lastError
}

function isWithinRepository(path) {
  const target = resolve(path)
  const rel = relative(root, target)
  return rel !== '' && (rel.startsWith('..') || isAbsolute(rel))
}

function requireExternalBackup(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path) || !isWithinRepository(path)) {
    throw new Error(`${label} must be an explicit absolute path outside the repository`)
  }
  return resolve(path)
}

async function analyzeFixedSource(candidate, policy, github) {
  const reasons = []
  const { owner, repository } = repositoryParts(candidate.repositoryUrl)
  const metadata = await github.api(`repos/${owner}/${repository}`)
  const ownerUserId = requiredOwnerUserId(metadata, 'fixed-source admission')
  if (isBlockedAuthor(ownerUserId, policy)) {
    throw Object.assign(new Error('repository owner is permanently excluded from DSH STORE admission'), { code: 'CATALOG_AUTHOR_PERMANENTLY_BLOCKED' })
  }
  const manifest = JSON.parse(await github.raw(candidate.repositoryUrl, candidate.commit, candidate.manifestPath, { maxBytes: MANIFEST_MAX_BYTES }))
  const manifestRepository = canonicalManifestRepository(manifest.repository)
  const repositoryLicense = metadata?.license?.spdx_id
  const manifestLicense = typeof manifest.license === 'string' && manifest.license.trim() ? manifest.license.trim() : null
  if (policy.automaticApproval.requireManifestRepositoryMatch && manifestRepository !== candidate.repositoryUrl) {
    reasons.push('manifest repository does not match the canonical GitHub repository')
  }
  if (policy.automaticApproval.requireRepositoryLicenseMatch) {
    if (!repositoryLicense || String(repositoryLicense).toUpperCase() === 'NOASSERTION') reasons.push(LICENSE_METADATA_REVIEW_REASON)
    else if (normalizedLicense(repositoryLicense) !== normalizedLicense(candidate.details.license)) {
      reasons.push('manifest and GitHub repository license metadata conflict')
    }
    if (manifestLicense && normalizedLicense(manifestLicense) !== normalizedLicense(candidate.details.license)) {
      reasons.push('manifest license does not match the Catalog declaration')
    }
  }
  if (policy.automaticApproval.requireExplicitFiles && (!Array.isArray(manifest.files) || manifest.files.length === 0)) {
    reasons.push('manifest does not declare an explicit distributable files list')
  }
  if (policy.automaticApproval.requireDshCompatibility && !candidate.compatibility.dsh) reasons.push('DSH compatibility is not explicitly declared')
  if (policy.automaticApproval.requireNodeCompatibility && !candidate.compatibility.node) reasons.push('Node.js compatibility is not explicitly declared')
  const contractReasons = [...reasons]
  const contractVerified = contractReasons.length === 0
  if (!policy.automaticApproval.allowLifecycleScripts && candidate.risk.installScripts.length > 0) {
    reasons.push(`install lifecycle scripts are present: ${candidate.risk.installScripts.join(', ')}`)
  }
  const dependencies = {
    ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}),
  }
  if (!policy.automaticApproval.allowRuntimeDependencies && Object.keys(dependencies).length > 0) {
    reasons.push('runtime or optional dependencies require a separate supply-chain review')
  }
  if (Array.isArray(manifest.bundledDependencies) && manifest.bundledDependencies.length > 0) {
    reasons.push('bundled dependencies are not eligible for automatic approval')
  }

  const tree = await github.api(`repos/${owner}/${repository}/git/trees/${candidate.commit}?recursive=1`, {
    maxBytes: 8 * 1024 * 1024,
  })
  const review = await reviewFixedSource(candidate, manifest, tree, policy, (path, maxBytes) =>
    github.raw(candidate.repositoryUrl, candidate.commit, path, { maxBytes }))
  reasons.push(...review.reasons)
  if (candidate.configOverrides?.length) reasons.push(`Bundle configuration overrides require review: ${candidate.configOverrides.join(', ')}; later layers replace the entire config`)
  return {
    ...review,
    contractVerified,
    contractReasons,
    policyDigest: sha256(JSON.stringify({ sourceBounds: policy.sourceBounds, automaticApproval: policy.automaticApproval })),
    approved: reasons.length === 0,
    reasons: [...new Set(reasons)].slice(0, 40),
    repositoryLicense: repositoryLicense ?? null,
    manifestLicense,
    sourceUpdatedAt: metadata?.pushed_at ?? null,
    dependencies: Object.keys(dependencies).sort().slice(0, 50),
    runtimeDependencies: dependencies,
  }
}

function automatedEntry(candidate, analysis, observedAt) {
  const admission = admissionDecision(candidate, analysis, admissionReviews)
  const approved = ['source-verified', 'reviewed'].includes(admission.state)
  const permissions = admission.state === 'reviewed' ? admission.permissions : analysis.approved
    ? { level: 'low', files: 'none', network: 'none', commands: 'none', credentials: ['none'] }
    : { level: 'unknown', files: 'unknown', network: 'unknown', commands: 'unknown', credentials: ['unknown'] }
  return localizeCatalogEntry({
    ...candidate,
    admission: { ...admission, reviewRegistryDigest: admissionReviewDigest },
    compatibility: sourceDeclaredCompatibility({ compatibility: {} }, candidate),
    status: approved ? 'approved' : 'blocked',
    ...(approved ? {} : { statusReason: boundedText(`Automatic policy blocked installation: ${analysis.reasons.join('; ')}`, 'Automatic policy could not prove safe installation.') }),
    updatePolicy: updatePolicyForAdmission(admission.state, analysis.signals),
    assurance: {
      discovery: {
        status: 'verified', method: 'automated-fixed-source-policy-v1', checkedAt: observedAt,
        evidenceUrl: `${candidate.repositoryUrl}/commit/${candidate.commit}`,
        summary: approved
          ? 'Fixed source, package contract, license, bounded runtime source, dependencies, and permission signals passed the automatic policy.'
          : 'Fixed source and Bundle identity were verified; automatic install approval failed closed on one or more policy gates.',
      },
      installability: { status: 'unknown', summary: 'No third-party installation or build code was executed by the automation.' },
      runtime: { status: 'unknown', summary: 'No DSH runtime acceptance was inferred from static automation.' },
      securityReview: { status: 'unknown', summary: 'Automated source policy is not an independent security audit.' },
    },
    details: {
      ...candidate.details, permissions,
      externalDependencies: approved ? [] : analysis.dependencies,
      reviewStatus: admission.state === 'reviewed' ? 'manual-review' : 'automated-scan',
    },
    risk: {
      ...candidate.risk,
      review: approved ? 'automated-fixed-source-policy-v1' : 'automatic-policy-blocked-not-installable',
    },
    source: {
      updatedAt: analysis.sourceUpdatedAt ?? observedAt,
      observedAt,
      provenance: 'github-commit',
    },
  })
}

function candidateRecord(repository, head, previous, observedAt, outcome) {
  return {
    id: candidateId(repository.full_name),
    name: boundedText(repository.full_name, 'Unknown GitHub repository', 160),
    description: boundedText(repository.description, 'Discovered GitHub repository awaiting a compatible DSH Bundle.', 1000),
    repositoryUrl: repository.html_url,
    defaultBranch: repository.default_branch,
    latestCommit: head.sha,
    sourceUpdatedAt: head?.commit?.committer?.date ?? head?.commit?.author?.date ?? repository.updated_at ?? null,
    discoveredAt: previous?.discoveredAt ?? observedAt,
    discoverySources: [...new Set([...(previous?.discoverySources ?? []), 'github-automatic-radar-v1'])],
    topics: [...new Set([...(Array.isArray(repository.topics) ? repository.topics : []), 'automatic-radar'])].slice(0, 50),
    status: outcome.status,
    route: outcome.route,
    statusReason: boundedText(outcome.reason, 'Automatic policy did not produce an installable Catalog entry.'),
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function authorCommentTime(comment) {
  const time = Date.parse(comment?.updated_at ?? comment?.created_at ?? '')
  return Number.isFinite(time) ? time : 0
}

async function verifyAuthorRequest(github, request, repositoryUrl, expectedRepositoryState = 'present') {
  const central = 'AI-Scarlett/DSH-Store'
  const canonicalRepository = canonicalGithubRepository(repositoryUrl)
  const { owner, repository } = repositoryParts(canonicalRepository)
  const issue = await github.api(`repos/${central}/issues/${request.issueNumber}`)
  const noticeMarker = `<!-- dsh-author-notice:v1 key=${owner}/${repository}`
  if (issue.pull_request || issue.state !== 'open' || !issue.body?.includes(canonicalRepository)
    || !issue.body.includes(noticeMarker)) throw new Error('author request no longer matches the open managed remediation Issue')
  const comments = await github.api(`repos/${central}/issues/${request.issueNumber}/comments?per_page=100`)
  if (!Array.isArray(comments) || comments.length >= 100) throw new Error('author request comment snapshot is incomplete')
  const authors = comments.filter(comment => Number(comment.user?.id) === request.userId && comment.user?.type === 'User')
    .sort((left, right) => authorCommentTime(left) - authorCommentTime(right) || Number(left.id) - Number(right.id))
  const latest = authors.at(-1)
  if (latest?.id !== request.commentId || latest.updated_at !== request.updatedAt
    || sha256(String(latest.body ?? '')) !== request.bodySha256
    || !String(latest.body ?? '').includes(request.quote)) throw new Error('author request changed, was withdrawn, or was superseded')
  if (comments.some(comment => STORE_REPLY_USER_IDS.has(Number(comment.user?.id))
    && (authorCommentTime(comment) > authorCommentTime(latest)
      || authorCommentTime(comment) === authorCommentTime(latest) && Number(comment.id) > Number(latest.id)))) {
    throw new Error('author request already has a later Store response')
  }
  if (String(latest.user?.login ?? '').toLowerCase() !== owner.toLowerCase()) {
    throw new Error('author request identity does not match the canonical repository owner')
  }
  let repositoryMetadata
  try {
    repositoryMetadata = await github.api(`repos/${owner}/${repository}`)
  } catch (error) {
    if (expectedRepositoryState !== 'not-found' || error?.status !== 404) throw error
    return { issue, comment: latest, repository: null }
  }
  if (expectedRepositoryState === 'not-found') throw new Error('withdrawn repository is available; regenerate the source plan')
  const ownerId = requiredOwnerUserId(repositoryMetadata, 'author request source verification')
  if (ownerId !== request.userId || repositoryMetadata?.private === true || repositoryMetadata?.archived === true
    || repositoryMetadata?.disabled === true) throw new Error('author request source is not the same active public owner repository')
  return { issue, comment: latest, repository: repositoryMetadata }
}

async function applyAuthorWithdrawalPlan(catalog, policy, plan, originalCatalogIndex, github, report) {
  if (!plan.withdrawal) return []
  const request = plan.withdrawal
  await verifyAuthorRequest(github, request, request.repositoryUrl, request.expectedRepositoryState)
  const repositoryUrl = canonicalGithubRepository(request.repositoryUrl)
  const repositoryHash = sha256(`github-repository:${repositoryUrl.toLowerCase()}`)
  const policyRecord = (policy.withdrawnRepositories ?? []).find(record =>
    record.repositoryUrlSha256 === repositoryHash
      && record.requestRefSha256 === sha256(request.requestUrl)
      && record.requestBodySha256 === request.bodySha256)
  if (!policyRecord) throw new Error('withdrawal request is not present in the reviewed Catalog policy')
  const entry = catalog.entries.find(item => item.id === request.catalogId)
  if (!entry || canonicalGithubRepository(entry.repositoryUrl) !== repositoryUrl || !isWithdrawnRepository(entry.repositoryUrl, policy)) {
    throw new Error('withdrawal Catalog target changed or has already been removed')
  }
  const indexDocument = JSON.parse(originalCatalogIndex.toString('utf8'))
  const indexEntry = indexDocument.entries?.find(item => item.id === entry.id && item.repositoryUrl === repositoryUrl)
  const detailPath = indexEntry?.detailPath
  if (typeof detailPath !== 'string' || !/^catalog\/details\/[a-z0-9][a-z0-9-]*\.json$/.test(detailPath)) {
    throw new Error('withdrawn Catalog entry has no exact bounded detail path')
  }
  catalog.entries = catalog.entries.filter(item => item !== entry)
  report.removedEntries.push({
    recordFingerprint: sha256(`${entry.id}\n${entry.repositoryUrl.toLowerCase()}`),
    reason: 'author-requested-permanent-withdrawal',
  })
  return [`registry/${detailPath}`]
}

async function inspectAuthorCatalogRecheck(catalog, policy, github, observedAt, report, plan, dshReleaseWindow) {
  const entry = catalog.entries.find(item => item.id === plan.catalog.id)
  if (!entry || entry.repositoryUrl !== plan.catalog.repositoryUrl || entry.commit !== plan.catalog.commit
    || entry.version !== plan.catalog.version || entry.status !== 'blocked' || entry.updatePolicy !== 'external-only') {
    throw new Error('author recheck Catalog identity or blocked external-only precondition changed')
  }
  await verifyAuthorRequest(github, plan.request, plan.catalog.repositoryUrl, 'present')
  const { owner, repository } = repositoryParts(plan.catalog.repositoryUrl)
  const metadata = await github.api(`repos/${owner}/${repository}`)
  const defaultBranch = metadata.default_branch
  if (typeof defaultBranch !== 'string' || !defaultBranch) throw new Error('author recheck source has no verified default branch')
  const head = await github.api(`repos/${owner}/${repository}/commits/${encodeURIComponent(defaultBranch)}`)
  if (head?.sha !== plan.source.commit) throw new Error('author recheck source Commit changed; regenerate the plan')

  const withoutCurrent = { ...catalog, entries: catalog.entries.filter(item => item.id !== entry.id) }
  const result = await retryInfrastructure(() => checkRepository(plan.catalog.repositoryUrl, entry.installPath ?? '.', {
    catalogDocument: withoutCurrent,
    token: process.env.GITHUB_TOKEN,
    timeoutMs: 12_000,
    fetch: github.fetch,
    fixedCommit: plan.source.commit,
  }))
  const candidate = result.candidate
  if (candidate.commit !== plan.source.commit || candidate.defaultBranch !== defaultBranch
    || candidate.version !== plan.source.version || compareVersions(candidate.version, entry.version) <= 0
    || normalizedLicense(candidate.details?.license) !== normalizedLicense(entry.details?.license)) {
    throw new Error('author recheck fixed source no longer matches the approved Catalog identity and version scope')
  }
  let reviewEntry = entry
  const migration = catalogMigrationTarget(entry, { commit: candidate.commit, repositoryUrl: candidate.repositoryUrl }, catalogMigrations)
  if (migration.record) {
    const manifest = JSON.parse(await github.raw(candidate.repositoryUrl, candidate.commit, candidate.manifestPath, { maxBytes: MANIFEST_MAX_BYTES }))
    reviewEntry = migrateCatalogIdentity(entry, { commit: candidate.commit, repositoryUrl: candidate.repositoryUrl }, manifest, catalogMigrations).entry
  }
  if (!catalogUpdateIdentityMatches(reviewEntry, candidate)) {
    throw new Error('author recheck fixed source identity differs from the Catalog entry and its reviewed migration')
  }

  let lineage = sameCommitLineage(entry.commit, candidate.commit)
  let disconnectedHistory = false
  if (!lineage) {
    try {
      lineage = await retryInfrastructure(() => github.api(
        `repos/${owner}/${repository}/compare/${entry.commit}...${candidate.commit}`,
        { maxBytes: 4 * 1024 * 1024, captureNoCommonAncestor: true },
      ))
    } catch (error) {
      disconnectedHistory = isNoCommonAncestorError(error, entry.commit, candidate.commit)
      if (!disconnectedHistory) throw error
    }
  }
  if (!disconnectedHistory && !isBoundedSourceLineage(lineage, policy.updates?.maxCommitSpan ?? 200)) {
    throw new Error('author recheck source is not a bounded descendant of the Catalog Commit')
  }

  const analysis = await retryInfrastructure(() => analyzeFixedSource(candidate, policy, github))
  let reviewed = refreshAutomaticPolicyReview(reviewEntry, automatedEntry(candidate, analysis, observedAt))
  if (reviewed.status !== 'blocked') {
    reviewed = {
      ...reviewed,
      status: 'blocked',
      statusReason: 'Automatic policy blocked installation: this Catalog entry is permanently external-only and cannot be auto-approved.',
      updatePolicy: 'external-only',
      risk: { ...reviewed.risk, review: 'automatic-policy-blocked-not-installable' },
    }
  }
  if (reviewed.updatePolicy !== 'external-only') throw new Error('author recheck attempted to change external-only policy')
  if (disconnectedHistory) reviewed = holdExternalOnlyAfterDisconnectedHistory(reviewed, entry.commit, candidate.commit, analysis.reasons)
  const updated = buildCatalogVersionUpdate(reviewed, candidate, {
    ...analysis,
    sourceUpdatedAt: head?.commit?.committer?.date ?? head?.commit?.author?.date ?? metadata?.pushed_at ?? null,
  }, observedAt, 'external-only')
  if (updated.status !== 'blocked' || updated.updatePolicy !== 'external-only') {
    throw new Error('author recheck did not preserve the non-installable external-only boundary')
  }
  const compatibility = bindFixedSourceLatestDshWindow(updated, dshReleaseWindow)
  const index = catalog.entries.findIndex(item => item.id === entry.id)
  catalog.entries[index] = updated
  const review = {
    catalogId: entry.id,
    repositoryUrl: entry.repositoryUrl,
    fromCommit: entry.commit,
    toCommit: updated.commit,
    fromVersion: entry.version,
    toVersion: updated.version,
    status: updated.status,
    updatePolicy: updated.updatePolicy,
    admissionBinding: updated.admission?.binding ?? null,
    permissionSignals: analysis.signals,
    sourceReview: {
      engine: analysis.engine,
      contractVerified: analysis.contractVerified,
      contractReasons: analysis.contractReasons,
      scanComplete: analysis.scanComplete,
      filesScanned: analysis.filesScanned,
      runtimeFiles: analysis.runtimeFiles,
      runtimeBytes: analysis.runtimeBytes,
      scope: analysis.scope,
      capabilityEvidence: analysis.capabilityEvidence,
      securityScan: analysis.securityScan,
      runtimeDependencies: analysis.runtimeDependencies ?? {},
      licenseEvidence: analysis.licenseEvidence ?? null,
      budgetFindings: analysis.budgetFindings ?? [],
    },
    identityMigration: migration.record ? {
      fromPackageName: migration.record.from.packageName,
      toPackageName: migration.record.to.packageName,
      previousIdentityHash: migration.record.previousIdentityHash,
      currentIdentityHash: catalogIdentityHash(entry),
    } : null,
    reasons: analysis.reasons,
    sourceDigest: analysis.sourceDigest,
    disconnectedHistory,
    compatibility,
  }
  report.manualScan = {
    planId: sha256(stableJson({ baseCommit: report.baseCommit, inputPlanSha256: report.preconditions.manualScanPlanSha256,
      catalog: plan.catalog, source: plan.source, request: plan.request })).slice(0, 24),
    status: 'passed',
    type: plan.type,
    request: { issueNumber: plan.request.issueNumber, commentId: plan.request.commentId, userId: plan.request.userId, bodySha256: plan.request.bodySha256 },
    selected: [{ repositoryUrl: candidate.repositoryUrl, commit: candidate.commit, packageName: candidate.packageName, version: candidate.version }],
    latestDshReleasesAtPolicyRun: [...dshReleaseWindow.releases],
    admitted: [],
    authorRecheck: review,
    withdrawnCatalogIds: [],
  }
  report.updatedEntries.push({ id: entry.id, from: entry.commit, to: updated.commit, fromVersion: entry.version,
    toVersion: updated.version, version: updated.version, changeKind: 'author-requested-fixed-source-recheck',
    policy: 'external-only', lineageReview: disconnectedHistory ? 'disconnected-history-external-only' : 'bounded-descendant' })
  report.updateReviews.push({ id: entry.id, repositoryUrl: entry.repositoryUrl, manifestPath: entry.manifestPath,
    catalogVersion: entry.version, upstreamVersion: updated.version, candidateCommit: updated.commit,
    policy: 'external-only', lineageReview: disconnectedHistory ? 'disconnected-history-external-only' : 'bounded-descendant',
    decision: 'catalog-updated-blocked', warnings: analysis.reasons })
}

function validateCandidateProbe(bytes) {
  if (!bytes || bytes.length > 256 * 1024) throw new Error('candidate probe exceeds the bounded input size')
  const value = JSON.parse(bytes.toString('utf8'))
  if (value.schemaVersion !== 1 || typeof value.repository !== 'string') throw new Error('invalid candidate probe document')
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)) value.repository = `https://github.com/${value.repository}`
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/i.test(value.repository)
    || !/^[0-9a-f]{40}$/.test(value.commit ?? '')
    || !Array.isArray(value.results) || value.results.length < 1 || value.results.length > 3) {
    throw new Error('invalid candidate probe document')
  }
  const versions = new Set()
  for (const row of value.results) {
    if (!row || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(row.version ?? '') || versions.has(row.version)) {
      throw new Error('candidate probe has invalid or duplicate versions')
    }
    if (!['compatible', 'incompatible', 'unknown'].includes(row.status)) throw new Error('candidate probe status is invalid')
    if (row.status === 'compatible' && row.method !== 'host-boot') throw new Error('compatible candidate probe requires host-boot evidence')
    versions.add(row.version)
  }
  return value
}

async function inspectManualAdmissions(catalog, candidates, policy, github, observedAt, report, dshReleaseWindow, scanPlan) {
  const manualReport = {
    scanPlanId: scanPlan.scan.planId,
    scanBaseCommit: scanPlan.scan.baseCommit,
    sourceIndexSha256: scanPlan.scan.sourceIndexSha256,
    mainResultsSha256: scanPlan.scan.mainResultsSha256,
    supplementalResultsSha256: scanPlan.scan.supplementalResultsSha256,
    sourceTargets: scanPlan.scan.targetCount,
    sourceOutcomes: scanPlan.scan.outcomes,
    latestDshReleasesAtScan: scanPlan.scan.latestDshReleases,
    latestDshReleasesAtPolicyRun: [...dshReleaseWindow.releases],
    selected: scanPlan.selected.map(({ repositoryUrl, commit, packageName, version, entryIds, sourceBinding, sourceDigest }) => ({
      repositoryUrl, commit, packageName, version, entryIds, sourceBinding, sourceDigest,
    })),
    alreadyCatalogued: [],
    admitted: [],
  }
  report.manualScan = manualReport
  const manualEntries = []
  const catalogRepositories = new Set(catalog.entries.map(entry => entry.repositoryUrl.toLowerCase()))

  for (const selected of scanPlan.selected) {
    const repositoryKey = selected.repositoryUrl.toLowerCase()
    if (catalogRepositories.has(repositoryKey)) {
      manualReport.alreadyCatalogued.push({ repositoryUrl: selected.repositoryUrl, commit: selected.commit })
      continue
    }
    const pluginPath = selected.manifestPath === 'package.json' ? '' : selected.manifestPath.slice(0, -'/package.json'.length)
    const result = await retryInfrastructure(() => checkRepository(selected.repositoryUrl, pluginPath, {
      catalogDocument: catalog,
      token: process.env.GITHUB_TOKEN,
      timeoutMs: 12_000,
      fetch: github.fetch,
      fixedCommit: selected.commit,
    }))
    const candidate = result.candidate
    const identityMatches = candidate.repositoryUrl === selected.repositoryUrl
      && candidate.commit === selected.commit
      && candidate.packageName === selected.packageName
      && candidate.version === selected.version
      && candidate.manifestPath === selected.manifestPath
      && stableJson(candidate.entryIds) === stableJson(selected.entryIds)
      && candidate.compatibility.dsh === selected.compatibility.dsh
      && stableJson(candidate.compatibility.dshReleases ?? {}) === stableJson(selected.compatibility.dshReleases)
    if (!identityMatches) {
      throw Object.assign(new Error(`manual scan result no longer matches fixed source identity for ${selected.repositoryUrl}`), {
        code: 'MANUAL_SCAN_SOURCE_BINDING_CHANGED',
      })
    }
    const analysis = await retryInfrastructure(() => analyzeFixedSource(candidate, policy, github))
    if (analysis.sourceDigest !== selected.sourceDigest) {
      throw Object.assign(new Error(`manual scan source digest changed at ${selected.repositoryUrl}@${selected.commit}`), {
        code: 'MANUAL_SCAN_SOURCE_DIGEST_CHANGED',
      })
    }
    const entry = automatedEntry(candidate, analysis, observedAt)
    if (entry.status !== 'approved' || !supportsDshReleaseWindow(entry, dshReleaseWindow.releases)) {
      throw Object.assign(new Error(`manual scan candidate no longer satisfies Catalog admission at ${selected.repositoryUrl}: ${entry.statusReason ?? 'no compatible result in the official latest-three DSH release window'}`), {
        code: 'MANUAL_SCAN_ADMISSION_GATE_FAILED',
      })
    }
    manualEntries.push(entry)
    catalog.entries.push(entry)
    catalogRepositories.add(repositoryKey)
    manualReport.admitted.push({ repositoryUrl: entry.repositoryUrl, id: entry.id, commit: entry.commit, status: entry.status })
    report.addedEntries.push({ id: entry.id, status: entry.status, commit: entry.commit, reasons: [] })
  }

  const manualCompatibilityCandidates = createManualCompatibilityCandidateScope(candidates)
  report.compatibilityPolicy = applyLatestDshCompatibilityPolicy(
    { ...catalog, entries: manualEntries },
    manualCompatibilityCandidates,
    dshReleaseWindow,
    observedAt,
    { policyDigest: sha256(JSON.stringify({ sourceBounds: policy.sourceBounds, automaticApproval: policy.automaticApproval })), reviewRegistryDigest: admissionReviewDigest },
  )
  if (report.compatibilityPolicy.candidatesChanged || manualCompatibilityCandidates.entries.length !== 0) {
    throw new Error('manual Catalog compatibility recheck escaped its isolated Candidate Registry scope')
  }
  report.compatibilityUnlisted = report.compatibilityPolicy.unlisted
  report.compatibilityRestored = report.compatibilityPolicy.restored
  report.compatibilityRefreshed = report.compatibilityPolicy.refreshed
  report.manualScan.planId = sha256(stableJson({
    baseCommit: report.baseCommit,
    inputPlanSha256: report.preconditions.manualScanPlanSha256,
    preconditions: report.preconditions,
    policyDigest: report.preconditions.sourcePolicySha256,
    admissionReviewsSha256: report.preconditions.admissionReviewsSha256,
    officialWindowSha256: report.preconditions.dshReleaseWindowSha256,
    selected: report.manualScan.selected,
    added: report.manualScan.admitted,
  })).slice(0, 24)
  report.manualScan.status = 'passed'
}

async function inspectManualReviewedFixedSourceUpdate(catalog, policy, github, observedAt, report, plan, dshReleaseWindow) {
  const target = plan.target
  const source = plan.source
  const index = catalog.entries.findIndex(entry => entry.id === target.id)
  const entry = catalog.entries[index]
  if (!entry || entry.repositoryUrl !== target.repositoryUrl || entry.commit !== target.commit || entry.version !== target.version) {
    throw new Error('reviewed fixed-source update no longer matches the exact Catalog entry precondition')
  }
  const reviewRecord = admissionReviews.reviews.find(review => review.repositoryUrl === source.repositoryUrl
    && review.commit === source.commit && review.binding === source.sourceBinding && review.verdict === 'approved')
  if (!reviewRecord) throw new Error('reviewed fixed-source update has no matching approved admission record on main')

  const { owner, repository } = repositoryParts(source.repositoryUrl)
  let lineage = sameCommitLineage(entry.commit, source.commit)
  if (!lineage) {
    lineage = await retryInfrastructure(() => github.api(
      `repos/${owner}/${repository}/compare/${entry.commit}...${source.commit}`,
      { maxBytes: 4 * 1024 * 1024 },
    ))
  }
  if (!isBoundedSourceLineage(lineage, policy.updates?.maxCommitSpan ?? 200)) {
    throw new Error('reviewed fixed source is not a bounded descendant of the current Catalog pin')
  }

  const checked = await retryInfrastructure(() => checkRepository(source.repositoryUrl, '', {
    catalogDocument: catalog,
    token: process.env.GITHUB_TOKEN,
    timeoutMs: 12_000,
    fetch: github.fetch,
    fixedCommit: source.commit,
    allowProtectedManager: isSelfManagerEntry(entry),
  }))
  const candidate = checked.candidate
  if (candidate.repositoryUrl !== source.repositoryUrl || candidate.commit !== source.commit
    || candidate.packageName !== source.packageName || candidate.version !== source.version
    || candidate.manifestPath !== source.manifestPath
    || stableJson(candidate.entryIds) !== stableJson(source.entryIds)) {
    throw new Error('reviewed fixed source no longer matches its immutable package identity')
  }
  const sourceTree = await retryInfrastructure(() => github.api(
    `repos/${owner}/${repository}/git/trees/${source.sourceTree}?recursive=1`,
    { maxBytes: 8 * 1024 * 1024 },
  ))
  if (sourceTree?.sha !== source.sourceTree) throw new Error('reviewed fixed-source tree changed')

  const analysis = await retryInfrastructure(() => analyzeFixedSource(candidate, policy, github))
  if (!analysis.scanComplete || analysis.sourceDigest !== source.sourceDigest
    || admissionBinding(candidate, analysis) !== source.sourceBinding) {
    throw new Error('reviewed fixed-source scan binding no longer matches the approved record')
  }
  if (compareVersions(candidate.version, entry.version) <= 0) {
    throw new Error('reviewed fixed source is not a higher version than the Catalog entry')
  }
  if (!catalogUpdateIdentityMatches(entry, candidate)) {
    throw new Error('reviewed fixed-source package identity differs from the Catalog entry')
  }

  const candidateEntry = automatedEntry(candidate, analysis, observedAt)
  if (candidateEntry.status !== 'approved' || candidateEntry.admission?.state !== 'reviewed'
    || candidateEntry.admission?.binding !== source.sourceBinding) {
    throw new Error('the approved fixed-source review did not produce a reviewed Catalog admission')
  }
  if (!supportsDshReleaseWindow(candidateEntry, dshReleaseWindow.releases)) {
    throw new Error('reviewed fixed source has no compatible result in the official latest-three DSH release window')
  }

  const reviewed = refreshAutomaticPolicyReview(entry, candidateEntry)
  const updated = buildCatalogVersionUpdate(reviewed, candidate, analysis, observedAt, catalogUpdatePolicy(reviewed))
  if (updated.status !== 'approved' || updated.admission?.state !== 'reviewed'
    || updated.admission?.binding !== source.sourceBinding) {
    throw new Error('manual fixed-source update failed to preserve the exact reviewed admission')
  }
  catalog.entries[index] = updated

  report.manualScan = {
    planId: sha256(stableJson({
      baseCommit: report.baseCommit,
      inputPlanSha256: report.preconditions.manualScanPlanSha256,
      preconditions: report.preconditions,
      target,
      source,
      review: plan.review,
      latestDshReleases: dshReleaseWindow.releases,
    })).slice(0, 24),
    type: plan.type,
    status: 'passed',
    target,
    selected: source,
    reviewBinding: source.sourceBinding,
    latestDshReleasesAtPolicyRun: [...dshReleaseWindow.releases],
    updated: { id: updated.id, commit: updated.commit, version: updated.version, status: updated.status },
  }
  report.updatedEntries.push({ id: updated.id, from: entry.commit, to: updated.commit,
    fromVersion: entry.version, toVersion: updated.version, version: updated.version,
    changeKind: 'manual-reviewed-fixed-source-update', policy: updated.updatePolicy,
    lineageReview: 'bounded-descendant' })
  report.updateReviews.push({ id: updated.id, repositoryUrl: updated.repositoryUrl,
    catalogVersion: entry.version, upstreamVersion: updated.version, candidateCommit: updated.commit,
    policy: updated.updatePolicy, decision: 'manual-reviewed-update', sourceBinding: source.sourceBinding,
    warnings: analysis.reasons })
  report.compatibilityPolicy = {
    authority: dshReleaseWindow.authority,
    registryUrl: dshReleaseWindow.registryUrl,
    latestVersion: dshReleaseWindow.latestVersion,
    latestReleases: [...dshReleaseWindow.releases],
    requiredCompatibleReleases: 1,
    checkedCatalogEntries: 1,
    catalogChanged: true,
    candidatesChanged: false,
    unlisted: [], restored: [], refreshed: [],
  }
}

async function discoverRepositories(policy, github) {
  if (policy.search?.enabled !== true) return []
  const found = new Map()
  const excluded = excludedRepositoryKeys(policy)
  for (const query of policy.search.queries) {
    try {
      const result = await github.api(`search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${policy.search.resultsPerQuery}`)
      for (const item of result?.items ?? []) {
        if (item?.private || item?.archived || item?.disabled || typeof item?.html_url !== 'string') continue
        const url = canonicalGithubRepository(item.html_url)
        if (url === 'https://github.com/AI-Scarlett/DSH-Store') continue
        if (excluded.has(url.toLowerCase())) continue
        if (isWithdrawnRepository(url, policy)) continue
        if (isBlockedAuthor(Number(item?.owner?.id), policy)) continue
        found.set(url.toLowerCase(), { ...item, html_url: url })
      }
    } catch {
      // transient search query failures do not abort other discoveries
    }
  }
  if (policy.discoveryFeeds?.enabled === true) {
    try {
      const offset = Math.floor(Date.now() / 3600000) * 8
      for (const item of await discoverFeedCandidates(github, { offset })) {
        if (!excluded.has(item.html_url.toLowerCase()) && !isWithdrawnRepository(item.html_url, policy)
          && !isBlockedAuthor(Number(item?.owner?.id), policy)
          && !found.has(item.html_url.toLowerCase())) found.set(item.html_url.toLowerCase(), item)
      }
    } catch {
      // feed failures do not abort search discoveries or overall automation
    }
  }
  return orderDiscoveryCandidates(found.values())
}

async function updateExistingEntries(catalog, policy, github, observedAt, report) {
  const baselineCatalog = { ...catalog, entries: [...catalog.entries] }
  const repositorySnapshots = new Map()
  const excluded = excludedRepositoryKeys(policy)
  const updatePolicy = policy.updates ?? {}
  const concurrency = Number.isInteger(updatePolicy.concurrency) ? updatePolicy.concurrency : 8
  const maxCommitSpan = Number.isInteger(updatePolicy.maxCommitSpan) ? updatePolicy.maxCommitSpan : 200


  function sourceSnapshot(entry) {
    const target = catalogMigrationSource(entry, catalogMigrations)
    const key = `${entry.repositoryUrl}:${target.repositoryUrl}`.toLowerCase()
    if (!repositorySnapshots.has(key)) {
      repositorySnapshots.set(key, retryInfrastructure(async () => {
        const { owner, repository } = repositoryParts(target.repositoryUrl)
        const metadata = await github.api(`repos/${owner}/${repository}`)
        const ownerUserId = requiredOwnerUserId(metadata, 'Catalog owner recheck')
        if (isBlockedAuthor(ownerUserId, policy)) {
          return { commit: entry.commit, repositoryUrl: target.repositoryUrl, ownerUserId, blockedAuthor: true }
        }
        if (metadata?.private === true || metadata?.archived === true || metadata?.disabled === true) throw Object.assign(new Error('the canonical repository is private, archived, or disabled'), { code: 'CATALOG_SOURCE_REPOSITORY_INACTIVE' })
        const defaultBranch = metadata.default_branch || target.defaultBranch || 'main'
        if (target.record?.to.repositoryUrl) {
          const original = repositoryParts(entry.repositoryUrl)
          const [from, to] = await Promise.all([
            github.api(`repos/${original.owner}/${original.repository}`), github.api(`repos/${owner}/${repository}`),
          ])
          verifyMigrationRepositories(target.record, from, to)
        }
        let head
        try {
          head = await github.api(`repos/${owner}/${repository}/commits/${encodeURIComponent(defaultBranch)}`)
        } catch (error) {
          if (error?.status === 404) {
            const metadata = await github.api(`repos/${owner}/${repository}`)
            if (metadata?.private === true || metadata?.archived === true || metadata?.disabled === true) {
              throw Object.assign(new Error('the canonical repository is private, archived, or disabled'), {
                code: 'CATALOG_SOURCE_REPOSITORY_INACTIVE',
              })
            }
            const resolvedBranch = typeof metadata?.default_branch === 'string' && metadata.default_branch
              ? metadata.default_branch
              : defaultBranch
            head = await github.api(`repos/${owner}/${repository}/commits/${encodeURIComponent(resolvedBranch || 'main')}`)
            if (!/^[0-9a-f]{40}$/.test(head?.sha ?? '')) {
              throw Object.assign(new Error('GitHub did not return a full immutable Commit'), {
                code: 'CATALOG_SOURCE_COMMIT_INVALID',
              })
            }
            return {
              commit: head.sha,
              repositoryUrl: target.repositoryUrl,
              ownerUserId,
              defaultBranch: resolvedBranch,
              sourceUpdatedAt: head?.commit?.committer?.date ?? head?.commit?.author?.date ?? metadata?.pushed_at ?? null,
            }
          }
          throw error
        }
        if (!/^[0-9a-f]{40}$/.test(head?.sha ?? '')) {
          throw Object.assign(new Error('GitHub did not return a full immutable Commit'), {
            code: 'CATALOG_SOURCE_COMMIT_INVALID',
          })
        }
        if (head.sha === entry.commit) {
          return {
            commit: head.sha,
            repositoryUrl: target.repositoryUrl,
            ownerUserId,
            defaultBranch,
            sourceUpdatedAt: head?.commit?.committer?.date ?? head?.commit?.author?.date ?? null,
          }
        }
        return {
          commit: head.sha,
          repositoryUrl: target.repositoryUrl,
          ownerUserId,
          defaultBranch: typeof metadata?.default_branch === 'string' && metadata.default_branch
            ? metadata.default_branch
            : defaultBranch,
          sourceUpdatedAt: head?.commit?.committer?.date ?? head?.commit?.author?.date ?? metadata?.pushed_at ?? null,
        }
      }))
    }
    return repositorySnapshots.get(key)
  }

  async function inspectEntry(entry, index) {
    let snapshot
    let versionAssessment = null
    let changeContract = null
    try {
      if (isWithdrawnRepository(entry.repositoryUrl, policy)) return { index, entry, kind: 'withdrawn' }
      if (excluded.has(entry.repositoryUrl.toLowerCase())) return { index, entry, kind: 'current' }
      snapshot = await sourceSnapshot(entry)
      if (snapshot.blockedAuthor === true) return { index, entry, kind: 'blocked-author', ownerUserId: snapshot.ownerUserId }
      const pendingMigration = catalogMigrationTarget(entry, snapshot, catalogMigrations).record
      const currentPolicyDigest = sha256(JSON.stringify({ sourceBounds: policy.sourceBounds, automaticApproval: policy.automaticApproval }))
      const admissionAuthorityStale = entry.admission && (
        entry.admission.engine !== SCAN_POLICY_VERSION
        || admissionReviewRegistryStaleForEntry(entry, admissionReviews.reviews, admissionReviewDigest)
        || entry.admission.policyDigest !== currentPolicyDigest
      )
      const policyReviewStale = entry.status === 'approved'
        || isAutomaticPolicyBlocked(entry)
        || admissionAuthorityStale
        || String(entry.statusReason ?? '').startsWith('DSH_LATEST_THREE_COMPATIBILITY_HOLD:')
      const recheckCurrent = snapshot.commit === entry.commit && (pendingMigration !== null
        || isPendingAutomaticPolicyRecheck(entry)
        || (policyReviewStale && (entry.admission?.engine !== SCAN_POLICY_VERSION
          || admissionReviewRegistryStaleForEntry(entry, admissionReviews.reviews, admissionReviewDigest)
          || entry.admission?.policyDigest !== sha256(JSON.stringify({ sourceBounds: policy.sourceBounds, automaticApproval: policy.automaticApproval })))))
      if (snapshot.commit === entry.commit && !recheckCurrent) return { index, entry, kind: 'current' }
      let manifest
      try {
        manifest = JSON.parse(await github.raw(snapshot.repositoryUrl ?? entry.repositoryUrl, snapshot.commit, catalogMigrationTarget(entry, snapshot, catalogMigrations).manifestPath, {
          maxBytes: MANIFEST_MAX_BYTES,
        }))
      } catch (error) {
        if (String(error?.code ?? '').startsWith('CATALOG_AUTOMATION_GITHUB_')) throw error
        return { index, entry, kind: 'deferred', snapshot, reason: 'the fixed-Commit manifest is not valid JSON' }
      }
      const migration = migrateCatalogIdentity(entry, snapshot, manifest, catalogMigrations)
      if (migration.applied) entry = migration.entry
      versionAssessment = assessUpstreamVersion(entry, { commit: snapshot.commit, manifest })
      changeContract = recheckCurrent
        ? { reviewable: true, expectedVersionComparison: 0, changeKind: 'automatic-policy-recheck' }
        : catalogChangeReviewContract(versionAssessment)
      if (!changeContract.reviewable) {
        return { index, entry, kind: versionAssessment.status, snapshot, versionAssessment }
      }

      process.stdout.write(`CATALOG_AUTOMATION_UPDATE_REVIEW id=${entry.id} kind=${changeContract.changeKind} from=${entry.version} to=${versionAssessment.upstreamVersion} candidate=${snapshot.commit.slice(0, 12)}\n`)
      const withoutCurrent = { ...baselineCatalog, entries: baselineCatalog.entries.filter(item => item.id !== entry.id) }
      const result = await retryInfrastructure(() => checkRepository(entry.repositoryUrl, entry.installPath ?? '.', {
        catalogDocument: withoutCurrent,
        allowProtectedManager: isSelfManagerEntry(entry),
        token: process.env.GITHUB_TOKEN, timeoutMs: 12_000,
        fetch: github.fetch, fixedCommit: snapshot.commit,
      }))
      const candidate = result.candidate
      if (candidate.commit !== snapshot.commit || candidate.defaultBranch !== snapshot.defaultBranch) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, reason: 'the upstream default branch moved during the fixed-source review' }
      }
      if (!catalogUpdateIdentityMatches(entry, candidate)
        || compareVersions(candidate.version, entry.version) !== changeContract.expectedVersionComparison) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, reason: 'the package, path, Bundle entry identity, or version contract changed' }
      }
      if (normalizedLicense(candidate.details?.license) !== normalizedLicense(entry.details?.license)) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, reason: 'the manifest license changed from the Catalog declaration' }
      }
      const sourcePolicy = catalogUpdatePolicy(entry)
      const { owner, repository } = repositoryParts(entry.repositoryUrl)
      let lineage = sameCommitLineage(entry.commit, candidate.commit)
      let disconnectedExternalOnly = false
      try {
        lineage ??= await retryInfrastructure(() => github.api(
          `repos/${owner}/${repository}/compare/${entry.commit}...${candidate.commit}`,
          { maxBytes: 4 * 1024 * 1024, captureNoCommonAncestor: true },
        ))
      } catch (error) {
        disconnectedExternalOnly = sourcePolicy === 'external-only'
          && isNoCommonAncestorError(error, entry.commit, candidate.commit)
        if (!disconnectedExternalOnly) throw error
      }
      const boundedDescendant = !recheckCurrent && isBoundedSourceLineage(lineage, maxCommitSpan)
      // DSH-Store's historical Catalog pin can reference a PR-head commit that
      // was later squash-merged. Permit only this exact first-party entry to
      // cross a bounded, shared-ancestor history split; the fixed candidate
      // still must pass the complete manifest, Bundle, and runtime-source gates.
      const boundedSelfManagerDivergence = !recheckCurrent && isSelfManagerEntry(entry)
        && isBoundedSourceLineage(lineage, maxCommitSpan, { allowDiverged: true })
        && lineage.status === 'diverged'
      const identicalRecheck = recheckCurrent && lineage?.status === 'identical'
        && Number.isInteger(lineage?.total_commits) && lineage.total_commits === 0
      const lineageReview = disconnectedExternalOnly ? 'disconnected-history-external-only'
        : identicalRecheck ? 'same-commit-policy-recheck'
        : boundedSelfManagerDivergence ? 'bounded-self-manager-history-divergence'
          : boundedDescendant ? 'direct-descendant' : null
      if (!lineageReview) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, reason: 'the candidate is not a bounded direct descendant of the Catalog Commit' }
      }
      const analysisPolicy = policy
      const analysis = await retryInfrastructure(() => analyzeFixedSource(candidate, analysisPolicy, github))
      const decision = automatedEntry(candidate, analysis, observedAt)
      // Source approval and human review are both immutable-Commit decisions.
      // Preserve the last approved pin when a newer candidate is not admitted.
      if (entry.status === 'approved' && decision.status !== 'approved' && !recheckCurrent) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, sourcePolicy, reason: analysis.reasons.join('; ') }
      }
      let reviewed = refreshAutomaticPolicyReview(entry, decision)
      if (disconnectedExternalOnly) {
        reviewed = holdExternalOnlyAfterDisconnectedHistory(reviewed, entry.commit, candidate.commit, analysis.reasons)
      }
      // Avoid daily source rechecks rewriting identical unresolved records.
      if (recheckCurrent && reviewed.status === entry.status && reviewed.statusReason === entry.statusReason
        && JSON.stringify(reviewed.details) === JSON.stringify(entry.details)
        && JSON.stringify(reviewed.admission) === JSON.stringify(entry.admission)) return { index, entry, kind: 'current' }
      const updated = buildCatalogVersionUpdate(reviewed, candidate, {
        ...analysis,
        sourceUpdatedAt: snapshot.sourceUpdatedAt ?? analysis.sourceUpdatedAt,
      }, observedAt, reviewed.updatePolicy)
      if (isAutomaticPolicyBlocked(entry)) updated.assurance.discovery.method = 'automated-fixed-source-recheck-v1'
      return {
        index, entry, kind: 'updated', snapshot, versionAssessment, changeContract, sourcePolicy, updated,
        lineageReview, warnings: analysis.reasons,
      }
    } catch (error) {
      const infrastructure = INFRASTRUCTURE_CODES.has(error?.code)
        || (String(error?.code ?? '').startsWith('CATALOG_AUTOMATION_GITHUB_')
          && ![404, 410, 451].includes(error?.status))
      return {
        index, entry, kind: infrastructure ? 'transient' : 'deferred', snapshot, versionAssessment, changeContract,
        reason: boundedText(error?.message, infrastructure ? 'temporary source update lookup failure' : 'source update review failed'),
      }
    }
  }

  const results = []
  for (let index = 0; index < baselineCatalog.entries.length; index += concurrency) {
    const batch = baselineCatalog.entries.slice(index, index + concurrency)
    results.push(...await Promise.all(batch.map((entry, offset) => inspectEntry(entry, index + offset))))
  }
  const removedCatalogIds = new Set()
  for (const result of results.sort((left, right) => left.index - right.index)) {
    const { entry, snapshot, versionAssessment } = result
    report.sourceVersionChecks.checkedEntries += 1
    if (result.kind === 'withdrawn' || result.kind === 'blocked-author') {
      removedCatalogIds.add(entry.id)
      report.removedEntries.push({ recordFingerprint: sha256(`${entry.id}\n${entry.repositoryUrl.toLowerCase()}`),
        reason: result.kind === 'withdrawn' ? 'author-requested-permanent-withdrawal' : 'permanently-excluded-author-identity' })
      continue
    }
    if (result.kind === 'current') {
      report.sourceVersionChecks.currentEntries += 1
      continue
    }
    if (versionAssessment?.status === 'source-changed-without-version-bump') {
      report.sourceVersionChecks.sourceChangedWithoutVersionBump += 1
      report.sourceChangesWithoutVersionBump.push({
        id: entry.id, version: entry.version, catalogCommit: entry.commit, candidateCommit: snapshot.commit,
        decision: result.kind === 'updated' ? 'catalog-repinned'
          : result.kind === 'transient' ? 'retry-later' : 'update-blocked',
        reason: result.reason ?? null,
      })
      if (result.kind === 'updated') report.sourceVersionChecks.sameVersionCatalogUpdates += 1
      else report.sourceVersionChecks.sameVersionUpdatesDeferred += 1
    }
    if (result.kind === 'upstream-version-behind') {
      report.sourceVersionChecks.upstreamVersionBehind += 1
      report.upstreamVersionBehind.push({
        id: entry.id, catalogVersion: entry.version, upstreamVersion: versionAssessment.upstreamVersion,
        candidateCommit: snapshot.commit,
      })
      continue
    }
    if (versionAssessment?.status === 'newer-version') report.sourceVersionChecks.newerVersionCandidates += 1
    if (result.kind === 'updated') {
      catalog.entries[result.index] = result.updated
      if (result.changeContract.changeKind === 'version-update') {
        report.sourceVersionChecks.catalogUpdates += 1
      }
      report.updatedEntries.push({
        id: entry.id,
        from: entry.commit,
        to: result.updated.commit,
        fromVersion: entry.version,
        toVersion: result.updated.version,
        version: result.updated.version,
        changeKind: result.changeContract.changeKind,
        policy: result.sourcePolicy,
        lineageReview: result.lineageReview,
      })
      report.updateReviews.push({
        id: entry.id,
        repositoryUrl: entry.repositoryUrl,
        manifestPath: entry.manifestPath,
        catalogVersion: entry.version,
        upstreamVersion: result.updated.version,
        candidateCommit: result.updated.commit,
        policy: result.sourcePolicy,
        lineageReview: result.lineageReview,
        decision: result.changeContract.changeKind === 'same-version-source-update'
          ? 'catalog-repinned-same-version' : 'catalog-updated',
        warnings: result.warnings.slice(0, 20),
      })
      continue
    }
    const deferred = {
      id: entry.id,
      commit: snapshot?.commit ?? null,
      catalogVersion: entry.version,
      upstreamVersion: versionAssessment?.upstreamVersion ?? null,
      policy: catalogUpdatePolicy(entry),
      reason: result.reason,
    }
    if (result.kind === 'transient') {
      report.transientFailures.push({ repository: entry.repositoryUrl, reason: result.reason })
    } else {
      report.deferredUpdates.push(deferred)
    }
    if (versionAssessment?.status === 'newer-version') {
      report.sourceVersionChecks.newerVersionsDeferred += 1
      report.updateReviews.push({
        id: entry.id,
        repositoryUrl: entry.repositoryUrl,
        manifestPath: entry.manifestPath,
        catalogVersion: entry.version,
        upstreamVersion: versionAssessment.upstreamVersion,
        candidateCommit: snapshot?.commit ?? null,
        policy: catalogUpdatePolicy(entry),
        decision: result.kind === 'transient' ? 'retry-later' : 'update-blocked',
        reason: result.reason,
      })
    } else {
      report.sourceVersionChecks.unresolvedEntries += 1
    }
  }
  if (removedCatalogIds.size) catalog.entries = catalog.entries.filter(entry => !removedCatalogIds.has(entry.id))
}

async function inspectCandidateAutoAdmissions(catalog, candidates, policy, github, observedAt, report, dshReleaseWindow, probe) {
  const candidate = candidates.entries.find(entry => entry
    && typeof entry.repositoryUrl === 'string'
    && entry.repositoryUrl.toLowerCase() === probe.repository.toLowerCase()
    && entry.latestCommit === probe.commit)
  if (!candidate) throw new Error('candidate probe does not match an entry in the Candidate Registry')
  if (candidate.status === 'rejected') throw new Error('candidate was already rejected; a new fixed Commit needs a new probe')
  if (isWithdrawnRepository(candidate.repositoryUrl, policy)
    || excludedRepositoryKeys(policy).has(candidate.repositoryUrl.toLowerCase())) {
    throw new Error('candidate repository is excluded from admission')
  }
  const releases = {}
  for (const release of dshReleaseWindow.releases) {
    const row = probe.results.find(item => item.version === release)
    releases[release] = !row ? 'unknown'
      : row.status === 'compatible' && row.method === 'host-boot' ? 'compatible'
        : row.status === 'incompatible' ? 'incompatible' : 'unknown'
  }
  report.candidateAutoAdmission = {
    repository: candidate.repositoryUrl,
    commit: candidate.latestCommit,
    probeSha256: report.preconditions.candidateProbeSha256,
    latestDshReleases: [...dshReleaseWindow.releases],
    releaseStatuses: releases,
    admitted: [],
    rejected: [],
  }
  let checked
  try {
    const result = await retryInfrastructure(() => checkRepository(candidate.repositoryUrl, '', {
      catalogDocument: catalog, token: process.env.GITHUB_TOKEN, timeoutMs: 12_000, fetch: github.fetch, fixedCommit: candidate.latestCommit,
    }))
    checked = result.candidate
  } catch (error) {
    candidate.status = 'rejected'
    candidate.route = routeForFailure(error?.code)
    candidate.statusReason = `${error?.code ?? 'CANDIDATE_PRECHECK_FAILED'}: ${boundedText(error?.message, 'candidate fixed-source precheck failed')}`
    report.candidateAutoAdmission.rejected.push({ repository: candidate.repositoryUrl, reason: candidate.statusReason })
    report.rejectedCandidates.push({ repository: candidate.repositoryUrl, commit: candidate.latestCommit, reason: candidate.statusReason })
    return
  }
  if (checked.repositoryUrl.toLowerCase() !== candidate.repositoryUrl.toLowerCase() || checked.commit !== candidate.latestCommit) {
    candidate.status = 'rejected'
    candidate.route = routeForFailure('CANDIDATE_COMMIT_UNAVAILABLE')
    candidate.statusReason = 'Candidate auto-admission blocked: the probed fixed Commit is no longer the source returned by the canonical repository manifest.'
    report.candidateAutoAdmission.rejected.push({ repository: candidate.repositoryUrl, reason: candidate.statusReason })
    report.rejectedCandidates.push({ repository: candidate.repositoryUrl, commit: candidate.latestCommit, reason: candidate.statusReason })
    return
  }
  checked.compatibility = {
    ...(checked.compatibility ?? {}),
    dsh: checked.compatibility?.dsh ?? candidate.compatibility?.dsh ?? '',
    dshReleases: releases,
  }
  const analysis = await retryInfrastructure(() => analyzeFixedSource(checked, policy, github))
  const entry = automatedEntry(checked, analysis, observedAt)
  if (entry.status !== 'approved' || !supportsDshReleaseWindow(entry, dshReleaseWindow.releases)) {
    candidate.status = 'rejected'
    candidate.route = routeForFailure('AUTOMATIC_POLICY_REJECTED')
    candidate.statusReason = boundedText(
      `Candidate auto-admission blocked: ${entry.statusReason ?? (analysis.reasons.join('; ') || 'no compatible latest-three host-boot result')}`,
      'Candidate auto-admission did not prove an installable entry under the current policy.',
    )
    report.candidateAutoAdmission.rejected.push({ repository: candidate.repositoryUrl, reason: candidate.statusReason })
    report.rejectedCandidates.push({ repository: candidate.repositoryUrl, commit: candidate.latestCommit, reason: candidate.statusReason })
    return
  }
  catalog.entries.push(entry)
  candidates.entries = candidates.entries.filter(item => item !== candidate)
  report.addedEntries.push({ id: entry.id, status: entry.status, commit: entry.commit, reasons: analysis.reasons })
  report.promotedCandidates.push({ repository: candidate.repositoryUrl, catalogId: entry.id })
  report.candidateAutoAdmission.admitted.push({ repository: candidate.repositoryUrl, id: entry.id, commit: entry.commit })
}

async function inspectDiscoveries(catalog, candidates, policy, github, observedAt, report, dshReleaseWindow) {
  let repositories = []
  try {
    repositories = await retryInfrastructure(() => discoverRepositories(policy, github))
  } catch (error) {
    report.transientFailures.push({
      repository: 'https://github.com/AI-Scarlett/DSH-Store',
      reason: boundedText(error?.message, 'discovery scan was temporarily unavailable'),
    })
    return
  }
  const catalogRepositories = new Set(catalog.entries.map(entry => entry.repositoryUrl.toLowerCase()))
  const candidateByRepository = new Map(candidates.entries.map(entry => [entry.repositoryUrl.toLowerCase(), entry]))
  let inspected = 0
  for (const repository of repositories) {
    if (inspected >= policy.search.maxNewRepositoriesPerRun) break
    const repositoryKey = repository.html_url.toLowerCase()
    if (catalogRepositories.has(repositoryKey)) continue
    const previous = candidateByRepository.get(repositoryKey)
    const { owner, repository: name } = repositoryParts(repository.html_url)
    let head
    try {
      head = await retryInfrastructure(() => github.api(`repos/${owner}/${name}/commits/${encodeURIComponent(repository.default_branch || 'main')}`))
    } catch (error) {
      inspected += 1
      if (error?.status === 404 || error?.status === 409) {
        report.skippedDiscoveries.push({ repository: repository.html_url, reason: `GitHub returned HTTP ${error.status} without a fixed Commit` })
      } else {
        report.transientFailures.push({ repository: repository.html_url, reason: boundedText(error?.message, 'temporary discovery lookup failure') })
      }
      continue
    }
    if (!/^[0-9a-f]{40}$/.test(head?.sha ?? '')) {
      inspected += 1
      report.skippedDiscoveries.push({ repository: repository.html_url, reason: 'GitHub did not return a fixed Commit' })
      continue
    }
    if (repository.discoveryOnly) {
      if (!previous) {
        const record = candidateRecord(repository, head, null, observedAt, { status: 'reviewing', route: 'direct-review', reason: 'External discovery signal only; fixed-source Catalog review required before installation.' })
        record.discoverySources = [repository.feedEvidence]
        candidates.entries.push(record); candidateByRepository.set(repositoryKey, record)
      }
      inspected += 1
      continue
    }
    if (previous?.latestCommit === head.sha && previous.status === 'rejected') continue
    inspected += 1
    process.stdout.write(`CATALOG_AUTOMATION_DISCOVERY_CHECK repository=${repository.full_name} candidate=${head.sha.slice(0, 12)}\n`)
    try {
      const result = await retryInfrastructure(() => checkRepository(repository.html_url, '', {
        catalogDocument: catalog, token: process.env.GITHUB_TOKEN, timeoutMs: 12_000, fetch: github.fetch, fixedCommit: head.sha,
      }))
      const analysis = await retryInfrastructure(() => analyzeFixedSource(result.candidate, policy, github))
      const entry = automatedEntry(result.candidate, analysis, observedAt)
      catalog.entries.push(entry)
      catalogRepositories.add(repositoryKey)
      report.addedEntries.push({ id: entry.id, status: entry.status, commit: entry.commit, reasons: analysis.reasons })
      if (previous) {
        candidates.entries = candidates.entries.filter(item => item.repositoryUrl.toLowerCase() !== repositoryKey)
        candidateByRepository.delete(repositoryKey)
        report.promotedCandidates.push({ repository: repository.html_url, catalogId: entry.id })
      }
    } catch (error) {
      if (INFRASTRUCTURE_CODES.has(error?.code) || String(error?.code ?? '').startsWith('CATALOG_AUTOMATION_GITHUB_')) {
        report.transientFailures.push({ repository: repository.html_url, reason: boundedText(error?.message, 'temporary source verification failure') })
        continue
      }
      const record = candidateRecord(repository, head, previous, observedAt, {
        status: 'rejected', route: routeForFailure(error?.code),
        reason: `${error?.code ?? 'AUTOMATIC_POLICY_REJECTED'}: ${boundedText(error?.message, 'automatic source review failed')}`,
      })
      const retention = await inspectCandidateRetention(
        record, 'new-discovery', policy, github, dshReleaseWindow, report,
      )
      if (retention.status === 'unsupported') {
        const preserveDurableDecision = previous && isDurableRejectedCandidateDecision(previous)
        if (preserveDurableDecision) {
          report.candidateRetention.durableDecisionsPreserved += 1
        } else if (previous) {
          candidates.entries = candidates.entries.filter(item => item !== previous)
          report.candidateRetention.registryRemovals += 1
        }
        if (!preserveDurableDecision) candidateByRepository.delete(repositoryKey)
        report.prunedCandidates.push(prunedCandidateRecord(record, retention, 'new-discovery'))
        continue
      }
      if (previous) Object.assign(previous, record)
      else candidates.entries.push(record)
      candidateByRepository.set(repositoryKey, record)
      report.rejectedCandidates.push({ repository: repository.html_url, commit: head.sha, reason: record.statusReason })
    }
  }
}

function prunedCandidateRecord(candidate, retention, source) {
  return {
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
    repositoryUrl: candidate.repositoryUrl,
    commit: candidate.latestCommit,
    discoverySources: candidate.discoverySources,
    topics: candidate.topics,
    source,
    previousFailure: candidate.statusReason,
    compatibilityReason: retention.reason,
    reason: boundedText(`${candidate.statusReason}; ${retention.reason}`, 'rejected candidate has no latest-three DSH compatibility evidence', 1_200),
  }
}

async function inspectCandidateRetention(candidate, source, policy, github, window, report) {
  try {
    const result = await retryInfrastructure(() => inspectRejectedCandidateCompatibility(
      candidate, window, policy.candidateRetention, github,
    ))
    report.candidateRetention.checkedCandidates += 1
    if (source === 'historical-bucket') report.candidateRetention.historicalChecked += 1
    else report.candidateRetention.newDiscoveriesChecked += 1
    if (result.status === 'compatible') report.candidateRetention.retainedCompatible += 1
    else if (result.status === 'unknown') report.candidateRetention.retainedUnknown += 1
    else report.candidateRetention.prunedUnsupported += 1
    return result
  } catch (error) {
    report.candidateRetention.checkedCandidates += 1
    if (source === 'historical-bucket') report.candidateRetention.historicalChecked += 1
    else report.candidateRetention.newDiscoveriesChecked += 1
    report.candidateRetention.retainedUnknown += 1
    const reason = boundedText(error?.message, 'candidate compatibility inspection was temporarily unavailable')
    report.transientFailures.push({ repository: candidate.repositoryUrl, reason })
    return { status: 'unknown', reason, manifestsChecked: 0 }
  }
}

async function pruneHistoricalRejectedCandidates(candidates, policy, github, window, observedAt, report) {
  const batch = selectRejectedCandidateRetentionBatch(
    candidates, observedAt, policy.candidateRetention, policy.scheduleHours,
  )
  report.candidateRetention.bucket = batch.bucket
  report.candidateRetention.bucketCount = batch.bucketCount
  report.candidateRetention.selectedCandidates = batch.entries.length
  const results = []
  for (let index = 0; index < batch.entries.length; index += policy.candidateRetention.concurrency) {
    const current = batch.entries.slice(index, index + policy.candidateRetention.concurrency)
    results.push(...await Promise.all(current.map(async candidate => ({
      candidate,
      retention: await inspectCandidateRetention(
        candidate, 'historical-bucket', policy, github, window, report,
      ),
    }))))
  }
  const removed = new Set()
  for (const { candidate, retention } of results) {
    if (retention.status !== 'unsupported') continue
    removed.add(candidate)
    report.prunedCandidates.push(prunedCandidateRecord(candidate, retention, 'historical-bucket'))
  }
  if (removed.size > 0) candidates.entries = candidates.entries.filter(candidate => !removed.has(candidate))
  report.candidateRetention.registryRemovals += removed.size
}

async function atomicWrite(path, buffer) {
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, buffer, { flag: 'wx', mode: 0o644 })
  await rename(temporary, path)
}

const catalogDetailsPath = resolve(root, 'registry/catalog/details')

async function backupCatalogDetails(path) {
  await rm(path, { recursive: true, force: true })
  await cp(catalogDetailsPath, path, { recursive: true, force: true })
}

async function restoreCatalogDetails(path) {
  await rm(catalogDetailsPath, { recursive: true, force: true })
  await mkdir(resolve(catalogDetailsPath, '..'), { recursive: true })
  await cp(path, catalogDetailsPath, { recursive: true, force: true })
}

async function writeCatalogFiles(bridgeBuffer, indexBuffer, details, { pruneUnlisted = true, prunePaths = [] } = {}) {
  await mkdir(catalogDetailsPath, { recursive: true })
  const expected = new Set()
  for (const detail of details) {
    const target = resolve(root, 'registry', detail.path)
    const scoped = relative(root, target)
    if (!scoped || scoped.startsWith('..') || isAbsolute(scoped)) throw new Error(`catalog detail path escapes the repository: ${detail.path}`)
    expected.add(target)
    const contents = Buffer.from(`${JSON.stringify(detail.entry, null, 2)}\n`)
    let existing = null
    try { existing = await readFile(target) } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (!existing?.equals(contents)) await atomicWrite(target, contents)
  }
  if (pruneUnlisted) {
    for (const name of await readdir(catalogDetailsPath)) {
      const target = resolve(catalogDetailsPath, name)
      if (!expected.has(target)) await rm(target, { recursive: true, force: true })
    }
  }
  for (const path of prunePaths) {
    if (typeof path !== 'string' || !/^registry\/catalog\/details\/[a-z0-9][a-z0-9-]*\.json$/.test(path)) {
      throw new Error('manual Catalog withdrawal contains an unsafe detail path')
    }
    const target = resolve(root, path)
    if (!target.startsWith(`${catalogDetailsPath}/`) || expected.has(target)) throw new Error('manual Catalog withdrawal detail path is outside its exact scope')
    await rm(target, { force: true })
  }
  let existingIndex = null
  try { existingIndex = await readFile(catalogIndexPath) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (!existingIndex?.equals(indexBuffer)) await atomicWrite(catalogIndexPath, indexBuffer)
  // Publish the compatibility bridge last: readers either observe the old
  // complete generation or a bridge whose integrity metadata matches the new
  // index and details generation.
  let existingBridge = null
  try { existingBridge = await readFile(catalogPath) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (!existingBridge?.equals(bridgeBuffer)) await atomicWrite(catalogPath, bridgeBuffer)
}

const options = parseArgs(process.argv.slice(2))
const failureContext = {
  options,
  observedAt: null,
  report: null,
  stage: 'validate-input',
}

async function writeAutomationFailureReport(context, error) {
  if (!context.options.report) return
  const observedAt = context.observedAt ?? new Date().toISOString()
  const baseCommit = process.env.CATALOG_BASE_COMMIT ?? process.env.GITHUB_SHA ?? null
  const partial = context.report ?? {
    schemaVersion: 2,
    planId: null,
    baseCommit: typeof baseCommit === 'string' && /^[0-9a-f]{40}$/.test(baseCommit) ? baseCommit : null,
    observedAt,
    preconditions: null,
    policy: 'registry/automation-policy.json',
  }
  const failureReport = {
    ...partial,
    status: 'failed',
    completed: false,
    statisticsAvailable: false,
    failure: {
      stage: boundedText(context.stage, 'unknown automation stage', 120),
      code: boundedText(error?.code, 'CATALOG_AUTOMATION_FAILED', 120),
      message: boundedText(error?.message, 'Catalog automation failed'),
    },
  }
  delete failureReport.postconditions
  await atomicWrite(
    resolve(context.options.report),
    Buffer.from(`${JSON.stringify(failureReport, null, 2)}\n`),
  )
}

try {
const observedAt = iso(options.observedAt ?? new Date().toISOString(), '--observed-at')
failureContext.observedAt = observedAt
failureContext.stage = 'validate-policy'
const policy = JSON.parse(await readFile(policyPath, 'utf8'))
if (JSON.stringify(policy.sourceBounds) !== JSON.stringify(SOURCE_SCAN_BOUNDS)) throw new Error('submission and automation scan budgets diverged')
if (policy.schemaVersion !== 1 || policy.scheduleHours !== 8) throw new Error('unsupported automation policy')
if (policy.scheduledScanScope !== 'catalog-only') throw new Error('scheduled automation must be restricted to the Catalog')
if (policy.compatibility?.authority !== DSH_RELEASE_WINDOW_AUTHORITY
  || policy.compatibility?.registryUrl !== DSH_REGISTRY_URL
  || policy.compatibility?.latestReleaseCount !== 3
  || policy.compatibility?.requiredCompatibleReleases !== 1
  || policy.compatibility?.unsupportedCatalogStatus !== 'blocked'
  || policy.compatibility?.candidateStatus !== 'reviewing'
  || policy.compatibility?.failClosedOnAuthorityError !== true) {
  throw new Error('unsupported DSH compatibility policy')
}
if (policy.candidateRetention?.authority !== REJECTED_CANDIDATE_RETENTION_AUTHORITY
  || policy.candidateRetention?.pruneRejectedWithoutLatestThreeCompatibility !== true
  || policy.candidateRetention?.exactReleaseEvidenceRequired !== true
  || policy.candidateRetention?.scanBuckets !== 24
  || policy.candidateRetention?.maxCandidatesPerRun !== 96
  || policy.candidateRetention?.maxTreeEntries !== policy.sourceBounds.maxTreeEntries
  || policy.candidateRetention?.maxManifestCandidates !== 48
  || policy.candidateRetention?.maxManifestBytes !== MANIFEST_MAX_BYTES
  || policy.candidateRetention?.concurrency !== 8) {
  throw new Error('unsupported rejected Candidate Registry retention policy')
}
const originalCatalog = await readFile(catalogPath)
const originalCatalogIndex = await readFile(catalogIndexPath)
const originalCandidates = await readFile(candidatesPath)
const originalRecommendations = await readFile(recommendationsPath)
const manualScanPlanBytes = options.manualScanPlan ? await readFile(resolve(options.manualScanPlan)) : null
if (manualScanPlanBytes && manualScanPlanBytes.length > 2 * 1024 * 1024) throw new Error('manual scan plan exceeds the bounded input size')
const manualScanPlan = manualScanPlanBytes ? validateManualScanPlan(JSON.parse(manualScanPlanBytes.toString('utf8'))) : null
const candidateMode = options.candidateAutoAdmission === true
const candidateProbeBytes = candidateMode && options.candidateProbe ? await readFile(resolve(options.candidateProbe)) : null
if (candidateMode && !candidateProbeBytes) throw new Error('--candidate-auto-admission requires --candidate-probe')
const candidateProbe = candidateProbeBytes ? validateCandidateProbe(candidateProbeBytes) : null
if (manualScanPlan && options.catalogOnly) throw new Error('--manual-scan-plan and --catalog-only are mutually exclusive')
if (candidateMode && (manualScanPlan || options.catalogOnly)) throw new Error('candidate auto admission cannot be combined with a manual plan or catalog-only scope')
if (!manualScanPlan && !options.catalogOnly && !candidateMode) throw new Error('select a verified --manual-scan-plan, a candidate probe, or the bounded --catalog-only scope')
const manualScanPlanSha = manualScanPlanBytes ? sha256(manualScanPlanBytes) : null
const catalogSha = sha256(originalCatalog)
const catalogIndexSha = sha256(originalCatalogIndex)
const candidatesSha = sha256(originalCandidates)
const recommendationsSha = sha256(originalRecommendations)
const catalog = await loadCatalogFromFiles({ indexUrl: new URL('../registry/catalog.json', import.meta.url) })
const candidates = JSON.parse(originalCandidates.toString('utf8'))
const recommendations = validateCommunityRecommendations(JSON.parse(originalRecommendations.toString('utf8')))
failureContext.stage = 'validate-authority'
const baseCommit = process.env.CATALOG_BASE_COMMIT ?? process.env.GITHUB_SHA ?? null
if (baseCommit !== null && !/^[0-9a-f]{40}$/.test(baseCommit)) throw new Error('automation base Commit must be a full Git SHA')
if (manualScanPlan?.type === 'author-requested-catalog-recheck' && manualScanPlan.baseCommit !== baseCommit) {
  throw new Error('author recheck plan was not created against the current Catalog base Commit')
}
if (manualScanPlan?.type === 'reviewed-fixed-source-catalog-update') {
  if (manualScanPlan.baseCommit !== baseCommit) throw new Error('reviewed update plan was not created against the current Catalog base Commit')
  for (const [file, expectedSha] of Object.entries(manualScanPlan.preconditions.files)) {
    const bytes = await readFile(resolve(root, file))
    if (sha256(bytes) !== expectedSha) throw new Error(`reviewed update precondition changed: ${file}`)
  }
}
validateCatalog(catalog)
assertLegacyCatalogCompatibility(catalog)
assertCatalogLocalization(catalog)
validateCandidateRegistry(candidates)
failureContext.stage = 'fetch-official-dsh-release-window'
const dshReleaseWindow = await fetchOfficialDshReleaseWindow({
  registryUrl: policy.compatibility.registryUrl,
  releaseCount: policy.compatibility.latestReleaseCount,
  githubToken: process.env.GITHUB_TOKEN,
})
const dshReleaseWindowSha = sha256(JSON.stringify(dshReleaseWindow))
const report = {
  schemaVersion: 2,
  status: 'running',
  completed: false,
  statisticsAvailable: false,
  planId: sha256(candidateMode
    ? `candidate-auto:${baseCommit ?? 'local'}:${catalogSha}:${catalogIndexSha}:${candidatesSha}:${recommendationsSha}:${dshReleaseWindowSha}:${sha256(candidateProbeBytes)}:${observedAt}`
    : manualScanPlan
      ? `${baseCommit ?? 'local'}:${catalogSha}:${catalogIndexSha}:${candidatesSha}:${recommendationsSha}:${dshReleaseWindowSha}:${manualScanPlanSha}:${observedAt}`
      : `catalog-only:${baseCommit ?? 'local'}:${catalogSha}:${catalogIndexSha}:${candidatesSha}:${recommendationsSha}:${dshReleaseWindowSha}:${observedAt}`).slice(0, 24),
  ...(manualScanPlan ? { mode: manualScanPlan.type === 'author-requested-catalog-recheck'
    ? 'manual-author-feedback-catalog-recheck'
    : manualScanPlan.type === 'reviewed-fixed-source-catalog-update'
      ? 'manual-reviewed-fixed-source-catalog-update' : 'manual-fixed-source-batch-admission' } : {}),
  ...(options.catalogOnly ? { mode: 'catalog-only-periodic-recheck', scanScope: 'catalog-only' } : {}),
  ...(candidateMode ? { mode: 'candidate-auto-admission' } : {}),
  baseCommit,
  observedAt,
  preconditions: {
    catalogSha256: catalogSha,
    catalogIndexSha256: catalogIndexSha,
    candidatesSha256: candidatesSha,
    communityRecommendationsSha256: recommendationsSha,
    dshReleaseWindowSha256: dshReleaseWindowSha,
    sourcePolicySha256: sha256(JSON.stringify(policy)),
    admissionReviewsSha256: sha256(JSON.stringify(admissionReviews)),
    catalogMigrationsSha256: sha256(JSON.stringify(catalogMigrations)),
    ...(manualScanPlan ? { manualScanPlanSha256: manualScanPlanSha } : {}),
    ...(candidateProbeBytes ? { candidateProbeSha256: sha256(candidateProbeBytes) } : {}),
  },
  policy: 'registry/automation-policy.json',
  sourceVersionChecks: {
    authority: 'canonical-github-default-branch-manifest-at-fixed-commit',
    checkedEntries: 0,
    currentEntries: 0,
    newerVersionCandidates: 0,
    catalogUpdates: 0,
    newerVersionsDeferred: 0,
    sourceChangedWithoutVersionBump: 0,
    sameVersionCatalogUpdates: 0,
    sameVersionUpdatesDeferred: 0,
    upstreamVersionBehind: 0,
    unresolvedEntries: 0,
  },
  updateReviews: [], updatedEntries: [], relocalizedEntries: [], sourceChangesWithoutVersionBump: [], upstreamVersionBehind: [],
  addedEntries: [], deferredUpdates: [], rejectedCandidates: [], promotedCandidates: [], removedEntries: [],
  removedRecommendations: [],
  compatibilityUnlisted: [], compatibilityRestored: [], compatibilityRefreshed: [],
  compatibilityPolicy: { catalogChanged: false, candidatesChanged: false, unlisted: [], restored: [], refreshed: [] },
  prunedCandidates: [],
  candidateRetention: {
    authority: REJECTED_CANDIDATE_RETENTION_AUTHORITY,
    latestReleases: [...dshReleaseWindow.releases],
    bucket: null,
    bucketCount: policy.candidateRetention.scanBuckets,
    selectedCandidates: 0,
    checkedCandidates: 0,
    historicalChecked: 0,
    newDiscoveriesChecked: 0,
    retainedCompatible: 0,
    retainedUnknown: 0,
    prunedUnsupported: 0,
    durableDecisionsPreserved: 0,
    registryRemovals: 0,
    ...(options.catalogOnly ? { skippedByScope: true } : {}),
  },
  skippedDiscoveries: [], transientFailures: [],
}
failureContext.report = report
const github = createCatalogGithubReader()
report.apiUsage = github.statistics
let manualWithdrawalDetailPaths = []
if (manualScanPlan) {
  if (manualScanPlan.type === 'author-requested-catalog-recheck') {
    failureContext.stage = 'verify-author-requested-catalog-recheck'
    manualWithdrawalDetailPaths = await applyAuthorWithdrawalPlan(catalog, policy, manualScanPlan, originalCatalogIndex, github, report)
    await inspectAuthorCatalogRecheck(catalog, policy, github, observedAt, report, manualScanPlan, dshReleaseWindow)
    report.manualScan.withdrawnCatalogIds = manualScanPlan.withdrawal ? [manualScanPlan.withdrawal.catalogId] : []
    report.manualScan.withdrawalRequest = manualScanPlan.withdrawal
      ? { issueNumber: manualScanPlan.withdrawal.issueNumber, commentId: manualScanPlan.withdrawal.commentId,
        userId: manualScanPlan.withdrawal.userId, bodySha256: manualScanPlan.withdrawal.bodySha256 }
      : null
    report.manualScan.withdrawnDetailPaths = manualWithdrawalDetailPaths
    report.manualScan.planId = sha256(stableJson({ planId: manualScanPlan.planId,
      inputPlanSha256: manualScanPlanSha, preconditions: report.preconditions,
      catalog: manualScanPlan.catalog, source: manualScanPlan.source,
      request: manualScanPlan.request, withdrawal: manualScanPlan.withdrawal ?? null,
    })).slice(0, 24)
    report.compatibilityPolicy = {
      authority: dshReleaseWindow.authority,
      registryUrl: dshReleaseWindow.registryUrl,
      latestVersion: dshReleaseWindow.latestVersion,
      latestReleases: [...dshReleaseWindow.releases],
      requiredCompatibleReleases: 1,
      checkedCatalogEntries: 1,
      compatibilityRecordsAdded: report.manualScan.authorRecheck.compatibility.recordsAdded,
      catalogChanged: report.manualScan.authorRecheck.compatibility.changed,
      candidatesChanged: false,
      unlisted: [],
      restored: [],
      refreshed: [],
      authorRecheck: [{ id: manualScanPlan.catalog.id,
        releaseStatuses: report.manualScan.authorRecheck.compatibility.releaseStatuses,
        compatibleReleasePresent: report.manualScan.authorRecheck.compatibility.compatibleReleasePresent }],
    }
  } else if (manualScanPlan.type === 'reviewed-fixed-source-catalog-update') {
    failureContext.stage = 'verify-manual-reviewed-fixed-source-update'
    await inspectManualReviewedFixedSourceUpdate(catalog, policy, github, observedAt, report, manualScanPlan, dshReleaseWindow)
  } else {
    failureContext.stage = 'inspect-manual-fixed-source-admissions'
    await inspectManualAdmissions(catalog, candidates, policy, github, observedAt, report, dshReleaseWindow, manualScanPlan)
  }
} else if (candidateMode) {
  failureContext.stage = 'candidate-auto-admission'
  await inspectCandidateAutoAdmissions(catalog, candidates, policy, github, observedAt, report, dshReleaseWindow, candidateProbe)
} else {
// The scheduled path is deliberately Catalog-only. Candidate discovery,
// Candidate Registry source reads, and retention cleanup require a separate
// fixed-source manual scan plan and are never inferred from a scheduled run.
await github.primeRepositories(catalog.entries.filter(entry => !isWithdrawnRepository(entry.repositoryUrl, policy))
  .flatMap(entry => [entry.repositoryUrl, catalogMigrationSource(entry, catalogMigrations).repositoryUrl]))
failureContext.stage = 'inspect-historical-catalog-entries'
await updateExistingEntries(catalog, policy, github, observedAt, report)
failureContext.stage = 'apply-latest-dsh-compatibility-policy'
report.compatibilityPolicy = applyLatestDshCompatibilityPolicy(
  catalog, candidates, dshReleaseWindow, observedAt,
  { policyDigest: sha256(JSON.stringify({ sourceBounds: policy.sourceBounds, automaticApproval: policy.automaticApproval })), reviewRegistryDigest: admissionReviewDigest },
  { manageCandidates: false },
)
report.compatibilityUnlisted = report.compatibilityPolicy.unlisted
report.compatibilityRestored = report.compatibilityPolicy.restored
report.compatibilityRefreshed = report.compatibilityPolicy.refreshed
}
failureContext.stage = 'refresh-catalog-localization'
if (!manualScanPlan && !candidateMode) {
  const localized = relocalizeCatalogEntries(catalog.entries, catalog.registry.categories)
  catalog.entries = localized.entries
  report.relocalizedEntries = localized.changes
}
catalog.entries.sort(compareCatalogEntries)
assertCatalogLocalization(catalog)

const catalogChanged = report.updatedEntries.length > 0 || report.addedEntries.length > 0
  || report.removedEntries.length > 0 || report.relocalizedEntries.length > 0 || report.compatibilityPolicy.catalogChanged
// Discovery can add or refresh Candidate records without entering any of the
// decision lists above. Bind the write decision to the actual file contents.
const prospectiveCandidatesBuffer = Buffer.from(`${JSON.stringify(candidates, null, 2)}\n`)
const candidatesChanged = !prospectiveCandidatesBuffer.equals(originalCandidates)
if (report.removedRecommendations.length > 0) recommendations.updatedAt = observedAt
const recommendationsBuffer = Buffer.from(`${JSON.stringify(recommendations, null, 2)}\n`)
const recommendationsChanged = !recommendationsBuffer.equals(originalRecommendations)
if (catalogChanged) catalog.registry.updatedAt = observedAt
if (candidatesChanged) candidates.registry.updatedAt = observedAt
failureContext.stage = 'validate-automation-output'
const validatedCatalog = validateCatalog(catalog)
assertLegacyCatalogCompatibility(catalog)
const validatedCandidates = validateCandidateRegistry(candidates)
const split = splitCatalogDocument(catalog, { detailsPath: catalog.registry.detailsPath })
const catalogBuffer = catalogBridgeBuffer(split.bridge)
const catalogIndexBuffer = Buffer.from(`${JSON.stringify(split.index, null, 2)}\n`)
const candidatesBuffer = Buffer.from(`${JSON.stringify({
  schemaVersion: validatedCandidates.schemaVersion,
  registry: validatedCandidates.registry,
  entries: validatedCandidates.entries.map(({ installable, allowedActions, ...entry }) => entry),
}, null, 2)}\n`)
const validatedRecommendations = validateCommunityRecommendations(recommendations)
const canonicalRecommendationsBuffer = Buffer.from(`${JSON.stringify(validatedRecommendations, null, 2)}\n`)
if (!candidatesChanged && !candidatesBuffer.equals(originalCandidates)) {
  throw new Error('Candidate Registry serialization changed without a write decision')
}
if (!recommendationsChanged && !canonicalRecommendationsBuffer.equals(originalRecommendations)) {
  throw new Error('Community recommendation serialization changed without a write decision')
}
if (manualScanPlan) {
  if (candidatesChanged || recommendationsChanged) throw new Error('manual Catalog policy run cannot mutate Candidate or Community registries')
  const admittedIds = new Set((report.manualScan.admitted ?? []).map(entry => entry.id))
  const recheckedIds = manualScanPlan.type === 'author-requested-catalog-recheck'
    ? new Set([manualScanPlan.catalog.id]) : new Set()
  const manuallyUpdatedIds = manualScanPlan.type === 'reviewed-fixed-source-catalog-update'
    ? new Set([manualScanPlan.target.id]) : new Set()
  const changedDetails = split.details.filter(detail => admittedIds.has(detail.entry.id)
    || recheckedIds.has(detail.entry.id) || manuallyUpdatedIds.has(detail.entry.id))
  const scopedFiles = new Set([
    ...changedDetails.map(detail => `registry/${detail.path}`),
    ...manualWithdrawalDetailPaths,
  ])
  const scope = catalogChanged
    ? [...new Set(['registry/catalog.json', 'registry/catalog-index.json', ...scopedFiles])].sort()
    : []
  const scopePreconditions = {}
  const scopePostconditions = {}
  for (const file of scope) {
    if (file === 'registry/catalog.json') {
      scopePreconditions[file] = catalogSha
      scopePostconditions[file] = sha256(catalogBuffer)
    } else if (file === 'registry/catalog-index.json') {
      scopePreconditions[file] = catalogIndexSha
      scopePostconditions[file] = sha256(catalogIndexBuffer)
    } else {
      let existing = null
      try { existing = await readFile(resolve(root, file)) } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      const detail = changedDetails.find(item => `registry/${item.path}` === file)
      if (detail) {
        if (manualScanPlan.type === 'manual-dsh-known-plugin-rescan' && existing !== null) {
          throw new Error(`manual Catalog admission detail path already exists: ${file}`)
        }
        if (manualScanPlan.type === 'author-requested-catalog-recheck' && existing === null) {
          throw new Error(`author recheck detail path is missing from the current Catalog: ${file}`)
        }
        if (manualScanPlan.type === 'reviewed-fixed-source-catalog-update' && existing === null) {
          throw new Error(`reviewed fixed-source detail path is missing from the current Catalog: ${file}`)
        }
        scopePreconditions[file] = existing === null ? null : sha256(existing)
        scopePostconditions[file] = sha256(Buffer.from(`${JSON.stringify(detail.entry, null, 2)}\n`))
      } else {
        if (!manualWithdrawalDetailPaths.includes(file) || existing === null) {
          throw new Error(`manual Catalog withdrawal detail path is not present in the exact removal scope: ${file}`)
        }
        scopePreconditions[file] = sha256(existing)
        scopePostconditions[file] = null
      }
    }
  }
  report.mutationPlan = {
    schemaVersion: 1,
    type: manualScanPlan.type === 'author-requested-catalog-recheck'
      ? 'manual-author-feedback-catalog-recheck'
      : manualScanPlan.type === 'reviewed-fixed-source-catalog-update'
        ? 'manual-reviewed-fixed-source-catalog-update' : 'manual-fixed-source-catalog-admission',
    planId: report.manualScan.planId,
    baseCommit,
    inputScanPlanSha256: manualScanPlanSha,
    scope,
    preconditions: scopePreconditions,
    postconditions: scopePostconditions,
    backup: 'external-runner-temporary-directory',
    commitRoute: 'signed-catalog-policy-pull-request',
  }
}
report.postconditions = {
  catalogChanged, candidatesChanged, recommendationsChanged,
  catalogSha256: sha256(catalogBuffer), catalogIndexSha256: sha256(catalogIndexBuffer),
  candidatesSha256: sha256(candidatesBuffer),
  communityRecommendationsSha256: sha256(canonicalRecommendationsBuffer),
  catalogEntries: validatedCatalog.entries.length, candidateEntries: validatedCandidates.entries.length,
  catalogDetails: split.details.length,
  legacyBridge: split.bridgeProjection,
}
report.status = 'passed'
report.completed = true
report.statisticsAvailable = true

failureContext.stage = 'preserve-decision-record'
if (options.report) await atomicWrite(resolve(options.report), Buffer.from(`${JSON.stringify(report, null, 2)}\n`))
if (!options.write) {
  process.stdout.write(`CATALOG_AUTOMATION_DRY_RUN plan=${report.planId} catalogChanged=${catalogChanged} candidatesChanged=${candidatesChanged} recommendationsChanged=${recommendationsChanged}\n`)
  process.exit(0)
}
failureContext.stage = 'validate-write-preconditions'
if (options.expectedCatalogSha !== catalogSha || options.expectedCatalogIndexSha !== catalogIndexSha
  || options.expectedCandidatesSha !== candidatesSha || options.expectedRecommendationsSha !== recommendationsSha) {
  throw new Error('automation precondition hash mismatch')
}
failureContext.stage = 'apply-catalog-transaction'
const catalogBackup = requireExternalBackup(options.catalogBackup, '--catalog-backup')
const catalogIndexBackup = requireExternalBackup(options.catalogIndexBackup, '--catalog-index-backup')
const catalogDetailsBackup = requireExternalBackup(options.catalogDetailsBackup, '--catalog-details-backup')
const candidatesBackup = requireExternalBackup(options.candidatesBackup, '--candidates-backup')
const recommendationsBackup = requireExternalBackup(options.recommendationsBackup, '--recommendations-backup')
await copyFile(catalogPath, catalogBackup)
await copyFile(catalogIndexPath, catalogIndexBackup)
await backupCatalogDetails(catalogDetailsBackup)
await copyFile(candidatesPath, candidatesBackup)
await copyFile(recommendationsPath, recommendationsBackup)
try {
  if (catalogChanged) await writeCatalogFiles(catalogBuffer, catalogIndexBuffer, split.details, {
    pruneUnlisted: !manualScanPlan,
    prunePaths: manualWithdrawalDetailPaths,
  })
  if (candidatesChanged) await atomicWrite(candidatesPath, candidatesBuffer)
  if (recommendationsChanged) await atomicWrite(recommendationsPath, canonicalRecommendationsBuffer)
} catch (error) {
  if (catalogChanged) {
    await atomicWrite(catalogPath, originalCatalog)
    await atomicWrite(catalogIndexPath, originalCatalogIndex)
    await restoreCatalogDetails(catalogDetailsBackup)
  }
  if (candidatesChanged) await atomicWrite(candidatesPath, originalCandidates)
  if (recommendationsChanged) await atomicWrite(recommendationsPath, originalRecommendations)
  throw error
}
process.stdout.write(`CATALOG_AUTOMATION_OK plan=${report.planId} catalogChanged=${catalogChanged} candidatesChanged=${candidatesChanged} recommendationsChanged=${recommendationsChanged} entries=${validatedCatalog.entries.length}\n`)
} catch (error) {
  try {
    await writeAutomationFailureReport(failureContext, error)
  } catch (reportError) {
    throw new AggregateError([error, reportError], 'Catalog automation failed and its failure report could not be preserved')
  }
  throw error
}
