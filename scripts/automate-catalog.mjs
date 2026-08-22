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
} from '../src/catalog-update-review.mjs'
import { canonicalGithubRepository, compareCatalogEntries, compareVersions, validateCatalog } from '../src/catalog.mjs'
import { validateCandidateRegistry } from '../src/candidates.mjs'
import { permissionSignals } from '../src/automation-source-policy.mjs'

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
    reasons.push('runtime source file count is outside the automatic review bound')
  }
  const runtimeSizes = runtimeFiles.map(item => Number.isSafeInteger(item.size)
    ? item.size
    : policy.sourceBounds.maxFileBytes + 1)
  const totalBytes = runtimeSizes.reduce((sum, size) => sum + size, 0)
  const runtimeBytesWithinBounds = runtimeSizes.every(size => size <= policy.sourceBounds.maxFileBytes)
    && totalBytes <= policy.sourceBounds.maxTotalRuntimeBytes
  if (!runtimeBytesWithinBounds) reasons.push('runtime source exceeds the automatic review byte bound')
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
      if (url === 'https://github.com/AI-Scarlett/dsh-safe-plugin-manager') continue
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
        catalogDocument: withoutCurrent, token: process.env.GITHUB_TOKEN, timeoutMs: 12_000,
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
      const analysis = await retryInfrastructure(() => analyzeFixedSource(candidate, policy, github))
      const sourcePolicy = catalogUpdatePolicy(entry)
      if (sourcePolicy === 'source-verified' && !analysis.approved) {
        return { index, entry, kind: 'deferred', snapshot, versionAssessment, sourcePolicy, reason: analysis.reasons.join('; ') }
      }
      if (sourcePolicy === 'user-reviewed') {
        const hardReasons = analysis.reasons.filter(reason => !reviewableReasons.some(prefix => reason.startsWith(prefix)))
        if (hardReasons.length > 0) {
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

async function inspectDiscoveries(catalog, candidates, policy, github, observedAt, report) {
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
      if (previous) Object.assign(previous, record)
      else candidates.entries.push(record)
      candidateByRepository.set(repositoryKey, record)
      report.rejectedCandidates.push({ repository: repository.html_url, commit: head.sha, reason: record.statusReason })
    }
  }
}

async function atomicWrite(path, buffer) {
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, buffer, { flag: 'wx', mode: 0o644 })
  await rename(temporary, path)
}

const options = parseArgs(process.argv.slice(2))
const observedAt = iso(options.observedAt ?? new Date().toISOString(), '--observed-at')
const policy = JSON.parse(await readFile(policyPath, 'utf8'))
if (policy.schemaVersion !== 1 || policy.scheduleHours !== 3) throw new Error('unsupported automation policy')
const originalCatalog = await readFile(catalogPath)
const originalCandidates = await readFile(candidatesPath)
const catalogSha = sha256(originalCatalog)
const candidatesSha = sha256(originalCandidates)
const catalog = JSON.parse(originalCatalog.toString('utf8'))
const candidates = JSON.parse(originalCandidates.toString('utf8'))
const baseCommit = process.env.CATALOG_BASE_COMMIT ?? process.env.GITHUB_SHA ?? null
if (baseCommit !== null && !/^[0-9a-f]{40}$/.test(baseCommit)) throw new Error('automation base Commit must be a full Git SHA')
validateCatalog(catalog)
assertCatalogLocalization(catalog)
validateCandidateRegistry(candidates)
const report = {
  schemaVersion: 2,
  planId: sha256(`${baseCommit ?? 'local'}:${catalogSha}:${candidatesSha}:${observedAt}`).slice(0, 24),
  baseCommit,
  observedAt,
  preconditions: { catalogSha256: catalogSha, candidatesSha256: candidatesSha },
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
  skippedDiscoveries: [], transientFailures: [],
}
const github = createGithubClient()
await updateExistingEntries(catalog, policy, github, observedAt, report)
await inspectDiscoveries(catalog, candidates, policy, github, observedAt, report)
catalog.entries.sort(compareCatalogEntries)
assertCatalogLocalization(catalog)

const catalogChanged = report.updatedEntries.length > 0 || report.addedEntries.length > 0
const candidatesChanged = report.rejectedCandidates.length > 0 || report.promotedCandidates.length > 0
if (catalogChanged) catalog.registry.updatedAt = observedAt
if (candidatesChanged) candidates.registry.updatedAt = observedAt
const validatedCatalog = validateCatalog(catalog)
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

if (options.report) await atomicWrite(resolve(options.report), Buffer.from(`${JSON.stringify(report, null, 2)}\n`))
if (!options.write) {
  process.stdout.write(`CATALOG_AUTOMATION_DRY_RUN plan=${report.planId} catalogChanged=${catalogChanged} candidatesChanged=${candidatesChanged}\n`)
  process.exit(0)
}
if (options.expectedCatalogSha !== catalogSha || options.expectedCandidatesSha !== candidatesSha) {
  throw new Error('automation precondition hash mismatch')
}
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
