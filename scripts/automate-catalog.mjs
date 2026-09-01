#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRepository } from './check-plugin-submission.mjs'
import { assertCatalogLocalization, localizeCatalogEntry } from '../src/catalog-localization.mjs'
import {
  assessUpstreamVersion,
  buildCatalogVersionUpdate,
  catalogUpdateIdentityMatches,
  catalogUpdatePolicy,
  sourceDeclaredCompatibility,
} from '../src/catalog-update-review.mjs'
import {
  assertLegacyCatalogCompatibility,
  canonicalGithubRepository,
  compareCatalogEntries,
  compareVersions,
  validateCatalog,
} from '../src/catalog.mjs'
import { validateCandidateRegistry } from '../src/candidates.mjs'
import { permissionSignals } from '../src/automation-source-policy.mjs'
import {
  applyLatestDshCompatibilityPolicy,
  DSH_RELEASE_WINDOW_AUTHORITY,
  DSH_REGISTRY_URL,
  fetchOfficialDshReleaseWindow,
} from '../src/catalog-compatibility-policy.mjs'
import {
  inspectRejectedCandidateCompatibility,
  REJECTED_CANDIDATE_RETENTION_AUTHORITY,
  selectRejectedCandidateRetentionBatch,
} from '../src/candidate-retention-policy.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const catalogPath = resolve(root, 'registry/catalog.json')
const candidatesPath = resolve(root, 'registry/candidates.json')
const policyPath = resolve(root, 'registry/automation-policy.json')
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|json|ya?ml|sh|py|rb|go|rs)$/i
const NATIVE_FILE = /\.(?:node|wasm|dll|dylib|so|exe|bin)$/i
const EXCLUDED_DIRECTORY = /(?:^|\/)(?:node_modules|vendor|test|tests|docs?|examples?|fixtures?|benchmarks?|coverage|\.github)(?:\/|$)/i
const EXCLUDED_METADATA_FILE = /(?:^|\/)(?:brief\.json|catalog-entry(?:\.draft)?\.json)$/i
const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare']
const INFRASTRUCTURE_CODES = new Set([
  'SUBMISSION_FETCH_UNAVAILABLE', 'SUBMISSION_GITHUB_HTTP', 'SUBMISSION_GITHUB_TIMEOUT',
  'SUBMISSION_GITHUB_NETWORK', 'SUBMISSION_REPOSITORY_HTTP', 'SUBMISSION_COMMIT_HTTP',
  'SUBMISSION_TREE_HTTP', 'SUBMISSION_SOURCE_HTTP',
])
const SELF_MANAGER_REPOSITORY = 'https://github.com/AI-Scarlett/DSH-Store'
const SELF_MANAGER_PROTECTED_ENTRY_REASON = 'Bundle Patch uses a protected DSH entry ID'
const SELF_MANAGER_PROTECTED_DSH_REASON = 'runtime source contains the protectedDsh permission signal'
const SELF_MANAGER_MAX_RUNTIME_FILES = 512
const SELF_MANAGER_MAX_FILE_BYTES = 2 * 1024 * 1024
const SELF_MANAGER_MAX_TOTAL_RUNTIME_BYTES = 8 * 1024 * 1024

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseArgs(argv) {
  const options = {
    write: false, expectedCatalogSha: null, expectedCandidatesSha: null,
    catalogBackup: null, candidatesBackup: null, observedAt: null, report: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--write') options.write = true
    else if (value === '--expected-catalog-sha') options.expectedCatalogSha = argv[++index]
    else if (value === '--expected-candidates-sha') options.expectedCandidatesSha = argv[++index]
    else if (value === '--catalog-backup') options.catalogBackup = argv[++index]
    else if (value === '--candidates-backup') options.candidatesBackup = argv[++index]
    else if (value === '--observed-at') options.observedAt = argv[++index]
    else if (value === '--report') options.report = argv[++index]
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

function isSafeSelfManagerUpdate(entry, hardReasons) {
  const repository = isSelfManagerEntry(entry) ? SELF_MANAGER_REPOSITORY.toLowerCase() : null
  const reason = hardReasons?.length === 1 ? String(hardReasons[0]).trim() : null
  return repository === SELF_MANAGER_REPOSITORY.toLowerCase()
    && Array.isArray(hardReasons)
    && hardReasons.length === 1
    && (reason.includes(SELF_MANAGER_PROTECTED_ENTRY_REASON)
      || reason === SELF_MANAGER_PROTECTED_DSH_REASON)
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

function githubHeaders(token, accept = 'application/vnd.github+json') {
  return {
    accept, 'user-agent': 'dsh-safe-plugin-manager-catalog-automation',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

function createGithubClient(options = {}) {
  const request = options.fetch ?? globalThis.fetch
  const token = options.token ?? process.env.GITHUB_TOKEN ?? ''
  const timeoutMs = options.timeoutMs ?? 15_000
  if (typeof request !== 'function') throw new Error('GitHub fetch is unavailable')

  async function text(url, settings = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await request(url, {
        headers: githubHeaders(token, settings.accept), signal: controller.signal,
      })
      if (!response.ok) throw Object.assign(new Error(`GitHub returned HTTP ${response.status}`), {
        code: 'CATALOG_AUTOMATION_GITHUB_HTTP', status: response.status,
      })
      const value = await response.text()
      if (Buffer.byteLength(value) > (settings.maxBytes ?? 4 * 1024 * 1024)) {
        throw Object.assign(new Error('GitHub response exceeded the automation bound'), { code: 'CATALOG_AUTOMATION_SOURCE_TOO_LARGE' })
      }
      return value
    } catch (error) {
      if (typeof error?.code === 'string') throw error
      throw Object.assign(new Error(error?.name === 'AbortError' ? 'GitHub request timed out' : 'GitHub request failed'), {
        code: error?.name === 'AbortError' ? 'CATALOG_AUTOMATION_GITHUB_TIMEOUT' : 'CATALOG_AUTOMATION_GITHUB_NETWORK',
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async function json(url, settings = {}) {
    const value = await text(url, settings)
    try { return JSON.parse(value) } catch {
      throw Object.assign(new Error('GitHub returned invalid JSON'), { code: 'CATALOG_AUTOMATION_GITHUB_JSON' })
    }
  }

  return {
    json,
    api: (path, settings) => json(`https://api.github.com/${path.replace(/^\//, '')}`, settings),
    raw: (repositoryUrl, commit, path, settings = {}) => {
      const { owner, repository } = repositoryParts(repositoryUrl)
      const encoded = path.split('/').map(encodeURIComponent).join('/')
      return text(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${commit}/${encoded}`, {
        ...settings, accept: 'application/vnd.github.raw+json',
      })
    },
  }
}

function mergeSignals(target, current) {
  for (const key of Object.keys(target)) target[key] = target[key] || Boolean(current[key])
}

function packagePrefix(candidate) {
  return candidate.installPath ? `${candidate.installPath.replace(/\/$/, '')}/` : ''
}

async function analyzeFixedSource(candidate, policy, github) {
  const reasons = []
  const signals = {
    files: false, network: false, commands: false, credentials: false,
    protectedDsh: false, nativeOrExecutableArtifacts: false,
  }
  const { owner, repository } = repositoryParts(candidate.repositoryUrl)
  const metadata = await github.api(`repos/${owner}/${repository}`)
  const manifest = JSON.parse(await github.raw(candidate.repositoryUrl, candidate.commit, candidate.manifestPath, { maxBytes: policy.sourceBounds.maxFileBytes }))
  const manifestRepository = canonicalManifestRepository(manifest.repository)
  const repositoryLicense = metadata?.license?.spdx_id
  if (policy.automaticApproval.requireManifestRepositoryMatch && manifestRepository !== candidate.repositoryUrl) {
    reasons.push('manifest repository does not match the canonical GitHub repository')
  }
  if (policy.automaticApproval.requireRepositoryLicenseMatch
    && (!repositoryLicense || repositoryLicense === 'NOASSERTION'
      || normalizedLicense(repositoryLicense) !== normalizedLicense(candidate.details.license))) {
    reasons.push('manifest and GitHub repository license metadata do not match')
  }
  if (policy.automaticApproval.requireExplicitFiles && (!Array.isArray(manifest.files) || manifest.files.length === 0)) {
    reasons.push('manifest does not declare an explicit distributable files list')
  }
  if (policy.automaticApproval.requireDshCompatibility && !candidate.compatibility.dsh) reasons.push('DSH compatibility is not explicitly declared')
  if (policy.automaticApproval.requireNodeCompatibility && !candidate.compatibility.node) reasons.push('Node.js compatibility is not explicitly declared')
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
  if (tree?.truncated === true) reasons.push('repository tree is truncated')
  const entries = Array.isArray(tree?.tree) ? tree.tree : []
  if (entries.length === 0 || entries.length > policy.sourceBounds.maxTreeEntries) reasons.push('repository tree exceeds the automatic review bound')
  const prefix = packagePrefix(candidate)
  const packageEntries = entries.filter(item => typeof item?.path === 'string' && (!prefix || item.path.startsWith(prefix)))
  if (!policy.automaticApproval.allowSymlinks && packageEntries.some(item => item.mode === '120000')) reasons.push('package contains symbolic links')
  if (!policy.automaticApproval.allowSubmodules && packageEntries.some(item => item.mode === '160000' || item.type === 'commit')) reasons.push('package contains Git submodules')

  const runtimeFiles = packageEntries.filter(item => {
    if (item.type !== 'blob') return false
    const relativePath = prefix ? item.path.slice(prefix.length) : item.path
    if (EXCLUDED_DIRECTORY.test(relativePath)) return false
    if (EXCLUDED_METADATA_FILE.test(relativePath)) return false
    if (NATIVE_FILE.test(relativePath) || item.mode === '100755') signals.nativeOrExecutableArtifacts = true
    return SOURCE_FILE.test(relativePath)
  })
  const runtimeFileCountWithinBounds = runtimeFiles.length > 0
    && runtimeFiles.length <= policy.sourceBounds.maxRuntimeFiles
  if (!runtimeFileCountWithinBounds) {
    reasons.push(`runtime source file count is outside the automatic review bound: ${runtimeFiles.length} files (maximum ${policy.sourceBounds.maxRuntimeFiles})`)
  }
  const runtimeSizes = runtimeFiles.map(item => Number.isSafeInteger(item.size)
    ? item.size
    : policy.sourceBounds.maxFileBytes + 1)
  const totalBytes = runtimeSizes.reduce((sum, size) => sum + size, 0)
  const runtimeBytesWithinBounds = runtimeSizes.every(size => size <= policy.sourceBounds.maxFileBytes)
    && totalBytes <= policy.sourceBounds.maxTotalRuntimeBytes
  if (!runtimeBytesWithinBounds) {
    reasons.push(`runtime source exceeds the automatic review byte bound: ${totalBytes} total bytes (maximum ${policy.sourceBounds.maxTotalRuntimeBytes}); largest file ${Math.max(0, ...runtimeSizes)} bytes (maximum ${policy.sourceBounds.maxFileBytes})`)
  }
  if (runtimeFileCountWithinBounds && runtimeBytesWithinBounds) {
    for (let index = 0; index < runtimeFiles.length; index += 8) {
      const batch = runtimeFiles.slice(index, index + 8)
      const sources = await Promise.all(batch.map(item => github.raw(
        candidate.repositoryUrl,
        candidate.commit,
        item.path,
        { maxBytes: policy.sourceBounds.maxFileBytes },
      )))
      for (const source of sources) mergeSignals(signals, permissionSignals(source))
    }
  }
  for (const [signal, allowed] of Object.entries(policy.automaticApproval.permissionSignals)) {
    if (!allowed && signals[signal]) reasons.push(`runtime source contains the ${signal} permission signal`)
  }
  return {
    approved: reasons.length === 0,
    reasons: [...new Set(reasons)].slice(0, 20), signals,
    repositoryLicense: repositoryLicense ?? null,
    sourceUpdatedAt: metadata?.pushed_at ?? null,
    dependencies: Object.keys(dependencies).sort().slice(0, 50),
    runtimeFiles: runtimeFiles.length,
    runtimeBytes: totalBytes,
  }
}

function automatedEntry(candidate, analysis, observedAt) {
  const approved = analysis.approved
  const permissions = approved
    ? { level: 'low', files: 'none', network: 'none', commands: 'none', credentials: ['none'] }
    : { level: 'unknown', files: 'unknown', network: 'unknown', commands: 'unknown', credentials: ['unknown'] }
  return localizeCatalogEntry({
    ...candidate,
    compatibility: sourceDeclaredCompatibility({ compatibility: {} }, candidate),
    status: approved ? 'approved' : 'blocked',
    ...(approved ? {} : { statusReason: boundedText(`Automatic policy blocked installation: ${analysis.reasons.join('; ')}`, 'Automatic policy could not prove safe installation.') }),
    updatePolicy: approved ? 'source-verified' : 'external-only',
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
      reviewStatus: 'automated-scan',
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

async function discoverRepositories(policy, github) {
  const found = new Map()
  for (const query of policy.search.queries) {
    const result = await github.api(`search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${policy.search.resultsPerQuery}`)
    for (const item of result?.items ?? []) {
      if (item?.private || item?.archived || item?.disabled || typeof item?.html_url !== 'string') continue
      const url = canonicalGithubRepository(item.html_url)
      if (url === 'https://github.com/AI-Scarlett/DSH-Store') continue
      found.set(url.toLowerCase(), { ...item, html_url: url })
    }
  }
  return [...found.values()].sort((left, right) => Date.parse(right.updated_at ?? 0) - Date.parse(left.updated_at ?? 0))
}

async function updateExistingEntries(catalog, policy, github, observedAt, report) {
  const baselineCatalog = { ...catalog, entries: [...catalog.entries] }
  const repositorySnapshots = new Map()
  const updatePolicy = policy.updates ?? {}
  const concurrency = Number.isInteger(updatePolicy.concurrency) ? updatePolicy.concurrency : 8
  const maxCommitSpan = Number.isInteger(updatePolicy.maxCommitSpan) ? updatePolicy.maxCommitSpan : 200
  const reviewableReasons = [
    'DSH compatibility is not explicitly declared',
    'Node.js compatibility is not explicitly declared',
    'install lifecycle scripts are present:',
    'runtime or optional dependencies require a separate supply-chain review',
    'bundled dependencies are not eligible for automatic approval',
    'runtime source contains the files permission signal',
    'runtime source contains the network permission signal',
    'runtime source contains the commands permission signal',
    'runtime source contains the credentials permission signal',
    'runtime source contains the nativeOrExecutableArtifacts permission signal',
  ]

  function sourceSnapshot(entry) {
    const key = entry.repositoryUrl.toLowerCase()
    if (!repositorySnapshots.has(key)) {
      repositorySnapshots.set(key, retryInfrastructure(async () => {
        const { owner, repository } = repositoryParts(entry.repositoryUrl)
        const metadata = await github.api(`repos/${owner}/${repository}`)
        if (metadata?.private === true || metadata?.archived === true || metadata?.disabled === true) {
          throw Object.assign(new Error('the canonical repository is private, archived, or disabled'), {
            code: 'CATALOG_SOURCE_REPOSITORY_INACTIVE',
          })
        }
        const defaultBranch = typeof metadata?.default_branch === 'string' && metadata.default_branch
          ? metadata.default_branch
          : entry.defaultBranch
        const head = await github.api(`repos/${owner}/${repository}/commits/${encodeURIComponent(defaultBranch || 'main')}`)
        if (!/^[0-9a-f]{40}$/.test(head?.sha ?? '')) {
          throw Object.assign(new Error('GitHub did not return a full immutable Commit'), {
            code: 'CATALOG_SOURCE_COMMIT_INVALID',
          })
        }
        return {
          commit: head.sha,
          defaultBranch,
          sourceUpdatedAt: head?.commit?.committer?.date ?? head?.commit?.author?.date ?? metadata?.pushed_at ?? null,
        }
      }))
    }
    return repositorySnapshots.get(key)
  }

  async function inspectEntry(entry, index) {
    let snapshot
    try {
      snapshot = await sourceSnapshot(entry)
      if (snapshot.commit === entry.commit) return { index, entry, kind: 'current' }
      let manifest
      try {
        manifest = JSON.parse(await github.raw(entry.repositoryUrl, snapshot.commit, entry.manifestPath, {
          maxBytes: policy.sourceBounds.maxFileBytes,
        }))
      } catch (error) {
        if (String(error?.code ?? '').startsWith('CATALOG_AUTOMATION_GITHUB_')) throw error
        return { index, entry, kind: 'deferred', snapshot, reason: 'the fixed-Commit manifest is not valid JSON' }
      }
      const versionAssessment = assessUpstreamVersion(entry, { commit: snapshot.commit, manifest })
      if (versionAssessment.status !== 'newer-version') {
        return { index, entry, kind: versionAssessment.status, snapshot, versionAssessment }
      }

      process.stdout.write(`CATALOG_AUTOMATION_UPDATE_REVIEW id=${entry.id} from=${entry.version} to=${versionAssessment.upstreamVersion} candidate=${snapshot.commit.slice(0, 12)}\n`)
      const withoutCurrent = { ...baselineCatalog, entries: baselineCatalog.entries.filter(item => item.id !== entry.id) }
      const result = await retryInfrastructure(() => checkRepository(entry.repositoryUrl, entry.installPath ?? '', {
        catalogDocument: withoutCurrent,
        allowProtectedManager: isSelfManagerEntry(entry),
        token: process.env.GITHUB_TOKEN, timeoutMs: 12_000,
      }))
      const candidate = result.candidate
      if (candidate.commit !== snapshot.commit || candidate.defaultBranch !== snapshot.defaultBranch) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, reason: 'the upstream default branch moved during the fixed-source review' }
      }
      if (!catalogUpdateIdentityMatches(entry, candidate) || compareVersions(candidate.version, entry.version) !== 1) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, reason: 'the package, path, Bundle entry identity, or version contract changed' }
      }
      if (normalizedLicense(candidate.details?.license) !== normalizedLicense(entry.details?.license)) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, reason: 'the manifest license changed from the Catalog declaration' }
      }
      const { owner, repository } = repositoryParts(entry.repositoryUrl)
      const lineage = await retryInfrastructure(() => github.api(
        `repos/${owner}/${repository}/compare/${entry.commit}...${candidate.commit}`,
        { maxBytes: 4 * 1024 * 1024 },
      ))
      if (lineage?.status !== 'ahead' || !Number.isInteger(lineage?.total_commits) || lineage.total_commits > maxCommitSpan) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, reason: 'the candidate is not a bounded direct descendant of the Catalog Commit' }
      }
      const analysisPolicy = isSelfManagerEntry(entry)
        ? {
          ...policy,
          sourceBounds: {
            ...policy.sourceBounds,
            maxRuntimeFiles: Math.max(policy.sourceBounds.maxRuntimeFiles, SELF_MANAGER_MAX_RUNTIME_FILES),
            maxFileBytes: Math.max(policy.sourceBounds.maxFileBytes, SELF_MANAGER_MAX_FILE_BYTES),
            maxTotalRuntimeBytes: Math.max(policy.sourceBounds.maxTotalRuntimeBytes, SELF_MANAGER_MAX_TOTAL_RUNTIME_BYTES),
          },
        }
        : policy
      const analysis = await retryInfrastructure(() => analyzeFixedSource(candidate, analysisPolicy, github))
      const sourcePolicy = catalogUpdatePolicy(entry)
      const hardReasons = analysis.reasons.filter(reason => !reviewableReasons.some(prefix => reason.startsWith(prefix)))
      const safeSelfManagerUpdate = isSafeSelfManagerUpdate(entry, hardReasons)
      if (sourcePolicy === 'source-verified' && !analysis.approved && !safeSelfManagerUpdate) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, sourcePolicy, reason: analysis.reasons.join('; ') }
      }
      if (sourcePolicy === 'user-reviewed') {
        if (hardReasons.length > 0 && !safeSelfManagerUpdate) {
          return { index, entry, kind: 'deferred', snapshot, versionAssessment, sourcePolicy, reason: hardReasons.join('; ') }
        }
      }
      const updated = buildCatalogVersionUpdate(entry, candidate, {
        ...analysis,
        sourceUpdatedAt: snapshot.sourceUpdatedAt ?? analysis.sourceUpdatedAt,
      }, observedAt, sourcePolicy)
      return {
        index, entry, kind: 'updated', snapshot, versionAssessment, sourcePolicy, updated,
        warnings: analysis.reasons,
      }
    } catch (error) {
      const infrastructure = INFRASTRUCTURE_CODES.has(error?.code)
        || (String(error?.code ?? '').startsWith('CATALOG_AUTOMATION_GITHUB_')
          && ![404, 410, 451].includes(error?.status))
      return {
        index, entry, kind: infrastructure ? 'transient' : 'deferred', snapshot,
        reason: boundedText(error?.message, infrastructure ? 'temporary source update lookup failure' : 'source update review failed'),
      }
    }
  }

  const results = []
  for (let index = 0; index < baselineCatalog.entries.length; index += concurrency) {
    const batch = baselineCatalog.entries.slice(index, index + concurrency)
    results.push(...await Promise.all(batch.map((entry, offset) => inspectEntry(entry, index + offset))))
  }
  for (const result of results.sort((left, right) => left.index - right.index)) {
    const { entry, snapshot, versionAssessment } = result
    report.sourceVersionChecks.checkedEntries += 1
    if (result.kind === 'current') {
      report.sourceVersionChecks.currentEntries += 1
      continue
    }
    if (result.kind === 'source-changed-without-version-bump') {
      report.sourceVersionChecks.sourceChangedWithoutVersionBump += 1
      report.sourceChangesWithoutVersionBump.push({
        id: entry.id, version: entry.version, catalogCommit: entry.commit, candidateCommit: snapshot.commit,
      })
      continue
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
      report.sourceVersionChecks.catalogUpdates += 1
      report.updatedEntries.push({
        id: entry.id,
        from: entry.commit,
        to: result.updated.commit,
        fromVersion: entry.version,
        toVersion: result.updated.version,
        version: result.updated.version,
        policy: result.sourcePolicy,
      })
      report.updateReviews.push({
        id: entry.id,
        repositoryUrl: entry.repositoryUrl,
        manifestPath: entry.manifestPath,
        catalogVersion: entry.version,
        upstreamVersion: result.updated.version,
        candidateCommit: result.updated.commit,
        policy: result.sourcePolicy,
        decision: 'catalog-updated',
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
}

async function inspectDiscoveries(catalog, candidates, policy, github, observedAt, report, dshReleaseWindow) {
  const repositories = await retryInfrastructure(() => discoverRepositories(policy, github))
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
    if (previous?.latestCommit === head.sha && previous.status === 'rejected') continue
    inspected += 1
    process.stdout.write(`CATALOG_AUTOMATION_DISCOVERY_CHECK repository=${repository.full_name} candidate=${head.sha.slice(0, 12)}\n`)
    try {
      const result = await retryInfrastructure(() => checkRepository(repository.html_url, '', {
        catalogDocument: catalog, token: process.env.GITHUB_TOKEN, timeoutMs: 12_000,
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
        if (previous) {
          candidates.entries = candidates.entries.filter(item => item !== previous)
          report.candidateRetention.registryRemovals += 1
        }
        candidateByRepository.delete(repositoryKey)
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
if (policy.schemaVersion !== 1 || policy.scheduleHours !== 8) throw new Error('unsupported automation policy')
if (policy.compatibility?.authority !== DSH_RELEASE_WINDOW_AUTHORITY
  || policy.compatibility?.registryUrl !== DSH_REGISTRY_URL
  || policy.compatibility?.latestReleaseCount !== 3
  || policy.compatibility?.requiredCompatibleReleases !== 1
  || policy.compatibility?.unsupportedCatalogStatus !== 'unlisted'
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
  || policy.candidateRetention?.maxManifestBytes !== policy.sourceBounds.maxFileBytes
  || policy.candidateRetention?.concurrency !== 8) {
  throw new Error('unsupported rejected Candidate Registry retention policy')
}
const originalCatalog = await readFile(catalogPath)
const originalCandidates = await readFile(candidatesPath)
const catalogSha = sha256(originalCatalog)
const candidatesSha = sha256(originalCandidates)
const catalog = JSON.parse(originalCatalog.toString('utf8'))
const candidates = JSON.parse(originalCandidates.toString('utf8'))
failureContext.stage = 'validate-authority'
const baseCommit = process.env.CATALOG_BASE_COMMIT ?? process.env.GITHUB_SHA ?? null
if (baseCommit !== null && !/^[0-9a-f]{40}$/.test(baseCommit)) throw new Error('automation base Commit must be a full Git SHA')
validateCatalog(catalog)
assertLegacyCatalogCompatibility(catalog)
assertCatalogLocalization(catalog)
validateCandidateRegistry(candidates)
failureContext.stage = 'fetch-official-dsh-release-window'
const dshReleaseWindow = await fetchOfficialDshReleaseWindow({
  registryUrl: policy.compatibility.registryUrl,
  releaseCount: policy.compatibility.latestReleaseCount,
})
const dshReleaseWindowSha = sha256(JSON.stringify(dshReleaseWindow))
const report = {
  schemaVersion: 2,
  status: 'running',
  completed: false,
  statisticsAvailable: false,
  planId: sha256(`${baseCommit ?? 'local'}:${catalogSha}:${candidatesSha}:${dshReleaseWindowSha}:${observedAt}`).slice(0, 24),
  baseCommit,
  observedAt,
  preconditions: {
    catalogSha256: catalogSha,
    candidatesSha256: candidatesSha,
    dshReleaseWindowSha256: dshReleaseWindowSha,
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
    upstreamVersionBehind: 0,
    unresolvedEntries: 0,
  },
  updateReviews: [], updatedEntries: [], sourceChangesWithoutVersionBump: [], upstreamVersionBehind: [],
  addedEntries: [], deferredUpdates: [], rejectedCandidates: [], promotedCandidates: [],
  compatibilityUnlisted: [], compatibilityRestored: [], compatibilityRefreshed: [],
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
    registryRemovals: 0,
  },
  skippedDiscoveries: [], transientFailures: [],
}
failureContext.report = report
const github = createGithubClient()
failureContext.stage = 'inspect-historical-catalog-entries'
await updateExistingEntries(catalog, policy, github, observedAt, report)
failureContext.stage = 'prune-historical-candidates'
await pruneHistoricalRejectedCandidates(candidates, policy, github, dshReleaseWindow, observedAt, report)
failureContext.stage = 'inspect-new-discoveries'
await inspectDiscoveries(catalog, candidates, policy, github, observedAt, report, dshReleaseWindow)
failureContext.stage = 'apply-latest-dsh-compatibility-policy'
report.compatibilityPolicy = applyLatestDshCompatibilityPolicy(
  catalog, candidates, dshReleaseWindow, observedAt,
)
report.compatibilityUnlisted = report.compatibilityPolicy.unlisted
report.compatibilityRestored = report.compatibilityPolicy.restored
report.compatibilityRefreshed = report.compatibilityPolicy.refreshed
catalog.entries.sort(compareCatalogEntries)
assertCatalogLocalization(catalog)

const catalogChanged = report.updatedEntries.length > 0 || report.addedEntries.length > 0
  || report.compatibilityPolicy.catalogChanged
const candidatesChanged = report.rejectedCandidates.length > 0 || report.promotedCandidates.length > 0
  || report.candidateRetention.registryRemovals > 0 || report.compatibilityPolicy.candidatesChanged
if (catalogChanged) catalog.registry.updatedAt = observedAt
if (candidatesChanged) candidates.registry.updatedAt = observedAt
failureContext.stage = 'validate-automation-output'
const validatedCatalog = validateCatalog(catalog)
assertLegacyCatalogCompatibility(catalog)
const validatedCandidates = validateCandidateRegistry(candidates)
const catalogBuffer = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`)
const candidatesBuffer = Buffer.from(`${JSON.stringify({
  schemaVersion: validatedCandidates.schemaVersion,
  registry: validatedCandidates.registry,
  entries: validatedCandidates.entries.map(({ installable, allowedActions, ...entry }) => entry),
}, null, 2)}\n`)
report.postconditions = {
  catalogChanged, candidatesChanged,
  catalogSha256: sha256(catalogBuffer), candidatesSha256: sha256(candidatesBuffer),
  catalogEntries: validatedCatalog.entries.length, candidateEntries: validatedCandidates.entries.length,
}
report.status = 'passed'
report.completed = true
report.statisticsAvailable = true

failureContext.stage = 'preserve-decision-record'
if (options.report) await atomicWrite(resolve(options.report), Buffer.from(`${JSON.stringify(report, null, 2)}\n`))
if (!options.write) {
  process.stdout.write(`CATALOG_AUTOMATION_DRY_RUN plan=${report.planId} catalogChanged=${catalogChanged} candidatesChanged=${candidatesChanged}\n`)
  process.exit(0)
}
failureContext.stage = 'validate-write-preconditions'
if (options.expectedCatalogSha !== catalogSha || options.expectedCandidatesSha !== candidatesSha) {
  throw new Error('automation precondition hash mismatch')
}
failureContext.stage = 'apply-catalog-transaction'
const catalogBackup = requireExternalBackup(options.catalogBackup, '--catalog-backup')
const candidatesBackup = requireExternalBackup(options.candidatesBackup, '--candidates-backup')
await copyFile(catalogPath, catalogBackup)
await copyFile(candidatesPath, candidatesBackup)
try {
  if (catalogChanged) await atomicWrite(catalogPath, catalogBuffer)
  if (candidatesChanged) await atomicWrite(candidatesPath, candidatesBuffer)
} catch (error) {
  if (catalogChanged) await atomicWrite(catalogPath, originalCatalog)
  if (candidatesChanged) await atomicWrite(candidatesPath, originalCandidates)
  throw error
}
process.stdout.write(`CATALOG_AUTOMATION_OK plan=${report.planId} catalogChanged=${catalogChanged} candidatesChanged=${candidatesChanged} entries=${validatedCatalog.entries.length}\n`)
} catch (error) {
  try {
    await writeAutomationFailureReport(failureContext, error)
  } catch (reportError) {
    throw new AggregateError([error, reportError], 'Catalog automation failed and its failure report could not be preserved')
  }
  throw error
}
