#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalExistingIssues, MAX_AUTHOR_NOTICE_ACTIONS, sha256 } from './plan-author-notices.mjs'

const API_ROOT = 'https://api.github.com'
const MANAGED_LABEL = 'author-action-required'
const ACTION_TYPES = new Set(['create', 'update', 'notify', 'source-update', 'baseline', 'close'])
const SOURCE_STATUSES = new Set([
  'new-baseline', 'tracking-baseline', 'modified-still-blocked', 'not-modified',
  'modified-and-resolved', 'resolved-without-source-change', 'resolved-source-unknown', 'unknown',
])
const CANDIDATE_COVERAGE_DISPOSITIONS = new Set([
  'direct-remediation', 'public-reviewing', 'public-remediation', 'public-deferred', 'public-discovery-only',
])
const CANDIDATE_NOTIFICATION_STATES = new Set(['managed-issue', 'scheduled-this-run', 'queued', 'public-registry-only'])

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`invalid argument: ${name}`)
    }
    options[name.slice(2)] = value
    index += 1
  }
  return options
}

function requiredString(value, name, pattern, maximum = 60_000) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || (pattern && !pattern.test(value))) {
    throw new Error(`${name} is invalid`)
  }
  return value
}

function repositoryName(value) {
  return requiredString(value, 'GITHUB_REPOSITORY', /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/)
}

function snapshotBuffer(issues) {
  return Buffer.from(`${JSON.stringify(canonicalExistingIssues(issues), null, 2)}\n`)
}

function validatePlan(plan) {
  if (plan?.schemaVersion !== 1) throw new Error('unsupported author notice plan schema')
  requiredString(plan.planId, 'planId', /^[0-9a-f]{24}$/)
  requiredString(plan.baseCommit, 'baseCommit', /^[0-9a-f]{40}$/)
  if (plan.sourceCatalogRunId !== null && plan.sourceCatalogRunId !== undefined) {
    requiredString(plan.sourceCatalogRunId, 'sourceCatalogRunId', /^\d+$/)
  }
  for (const name of ['catalogSha256', 'candidatesSha256', 'reportSha256', 'existingIssuesSha256', 'notificationTargetsSha256']) {
    requiredString(plan?.preconditions?.[name], `preconditions.${name}`, /^[0-9a-f]{64}$/)
  }
  if (!Array.isArray(plan.requiredLabels) || !Array.isArray(plan.actions)) throw new Error('plan arrays are missing')
  if (!Array.isArray(plan.candidateCoverage) || plan.candidateCoverage.length > 2_500) {
    throw new Error('candidate coverage ledger is missing or exceeds its bound')
  }
  requiredString(plan.candidateCoverageFingerprint, 'candidateCoverageFingerprint', /^[0-9a-f]{64}$/)
  if (sha256(JSON.stringify(plan.candidateCoverage)) !== plan.candidateCoverageFingerprint) {
    throw new Error('candidate coverage fingerprint mismatch')
  }
  const candidateKeys = new Set()
  let candidateRecords = 0
  const candidateDispositionCounts = Object.fromEntries([...CANDIDATE_COVERAGE_DISPOSITIONS].map(value => [value, 0]))
  const candidateNotificationCounts = Object.fromEntries([...CANDIDATE_NOTIFICATION_STATES].map(value => [value, 0]))
  for (const record of plan.candidateCoverage) {
    requiredString(record?.key, 'candidateCoverage.key', /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/)
    requiredString(record?.repositoryUrl, 'candidateCoverage.repositoryUrl', /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/)
    if (candidateKeys.has(record.key)) throw new Error(`duplicate candidate coverage repository ${record.key}`)
    candidateKeys.add(record.key)
    if (!Array.isArray(record.candidateIds) || record.candidateIds.length < 1 || record.candidateIds.length > 50) {
      throw new Error(`candidate IDs for ${record.key} are invalid`)
    }
    for (const id of record.candidateIds) requiredString(id, 'candidateCoverage.candidateId', /^[a-z0-9][a-z0-9._-]{0,95}$/)
    if (!Array.isArray(record.statuses) || record.statuses.length < 1 || record.statuses.length > 8) throw new Error(`candidate statuses for ${record.key} are invalid`)
    if (!Array.isArray(record.routes) || record.routes.length < 1 || record.routes.length > 8) throw new Error(`candidate routes for ${record.key} are invalid`)
    for (const status of record.statuses) requiredString(status, 'candidateCoverage.status', /^[a-z0-9-]{1,40}$/)
    for (const route of record.routes) requiredString(route, 'candidateCoverage.route', /^[a-z0-9-]{1,40}$/)
    if (!CANDIDATE_COVERAGE_DISPOSITIONS.has(record.disposition)) throw new Error(`candidate disposition for ${record.key} is invalid`)
    if (!CANDIDATE_NOTIFICATION_STATES.has(record.notificationState)) throw new Error(`candidate notification state for ${record.key} is invalid`)
    if ((record.disposition === 'direct-remediation') === (record.notificationState === 'public-registry-only')) {
      throw new Error(`candidate notification lane for ${record.key} is inconsistent`)
    }
    if (record.managedIssueNumber !== null && (!Number.isInteger(record.managedIssueNumber) || record.managedIssueNumber < 1)) {
      throw new Error(`candidate managed issue for ${record.key} is invalid`)
    }
    candidateRecords += record.candidateIds.length
    candidateDispositionCounts[record.disposition] += 1
    candidateNotificationCounts[record.notificationState] += 1
  }
  if (plan?.summary?.candidateRegistryRecords !== candidateRecords
    || plan?.summary?.candidateRegistryRepositories !== plan.candidateCoverage.length
    || plan?.summary?.candidateCoverageAccounted !== candidateRecords
    || plan?.summary?.candidateCoverageUnaccounted !== 0
    || plan?.summary?.candidateCoverageInvariantPassed !== true) {
    throw new Error('candidate coverage summary invariant failed')
  }
  const expectedCandidateSummary = {
    candidateDirectNotificationEligible: candidateDispositionCounts['direct-remediation'],
    candidateDirectManagedIssues: candidateNotificationCounts['managed-issue'],
    candidateDirectScheduledThisRun: candidateNotificationCounts['scheduled-this-run'],
    candidateDirectQueued: candidateNotificationCounts.queued,
    candidatePublicReviewing: candidateDispositionCounts['public-reviewing'],
    candidatePublicRemediation: candidateDispositionCounts['public-remediation'],
    candidatePublicDeferred: candidateDispositionCounts['public-deferred'],
    candidatePublicDiscoveryOnly: candidateDispositionCounts['public-discovery-only'],
    candidatePublicRegistryOnly: candidateNotificationCounts['public-registry-only'],
  }
  for (const [name, value] of Object.entries(expectedCandidateSummary)) {
    if (plan.summary[name] !== value) throw new Error(`candidate coverage summary ${name} mismatch`)
  }
  if (plan.actions.length > MAX_AUTHOR_NOTICE_ACTIONS) throw new Error('author notice action bound exceeded')
  if (plan.actions.filter(action => action?.type === 'create').length > 12) throw new Error('author notice create bound exceeded')
  const issueNumbers = new Set()
  for (const action of plan.actions) {
    if (!ACTION_TYPES.has(action?.type)) throw new Error('plan action type is invalid')
    requiredString(action.key, 'action.key', /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/)
    requiredString(action.signature, 'action.signature', /^[0-9a-f]{64}$/)
    requiredString(action.sourceFingerprint, 'action.sourceFingerprint', /^[0-9a-f]{64}$/)
    if (!SOURCE_STATUSES.has(action.sourceStatus)) throw new Error('plan source status is invalid')
    if (action.type === 'create' || action.type === 'update') {
      requiredString(action.title, 'action.title', null, 256)
      if (!Array.isArray(action.labels) || !action.labels.includes(MANAGED_LABEL) || action.labels.length > 4) {
        throw new Error(`labels for ${action.key} are invalid`)
      }
      for (const label of action.labels) requiredString(label, 'action.label', /^[a-z0-9-]{1,50}$/)
    }
    if (action.type === 'create' || action.type === 'notify' || action.type === 'source-update'
      || action.type === 'baseline' || action.type === 'update') {
      requiredString(action.body, 'action.body')
    }
    if (action.type !== 'create') {
      if (!Number.isInteger(action.issueNumber) || action.issueNumber < 1 || issueNumbers.has(action.issueNumber)) {
        throw new Error(`issue number for ${action.key} is invalid or duplicated`)
      }
      issueNumbers.add(action.issueNumber)
    }
    if (action.type === 'update') requiredString(action.pendingBody, 'action.pendingBody')
    if (action.type !== 'create' && action.type !== 'baseline') {
      requiredString(action.comment, 'action.comment', null, 10_000)
      requiredString(action.commentMarker, 'action.commentMarker', /^[a-z0-9_.:/-]{1,240}$/)
      if (!action.comment.includes(`<!-- ${action.commentMarker} -->`)) throw new Error('comment marker mismatch')
    }
  }
  const labelNames = new Set()
  for (const label of plan.requiredLabels) {
    requiredString(label?.name, 'label.name', /^[a-z0-9-]{1,50}$/)
    requiredString(label?.color, 'label.color', /^[0-9A-Fa-f]{6}$/)
    requiredString(label?.description, 'label.description', null, 100)
    if (labelNames.has(label.name)) throw new Error(`duplicate label ${label.name}`)
    labelNames.add(label.name)
  }
  for (const action of plan.actions) {
    for (const label of action.labels ?? []) if (!labelNames.has(label)) throw new Error(`undeclared label ${label}`)
  }
}

function githubClient(token) {
  requiredString(token, 'GITHUB_TOKEN', null, 10_000)
  const request = async (method, path, body, attempt = 1) => {
    const response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'dsh-store-author-notifications',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise(resolvePromise => setTimeout(resolvePromise, attempt * 1_000))
      return request(method, path, body, attempt + 1)
    }
    if (!response.ok) {
      const requestId = response.headers.get('x-github-request-id') ?? 'unknown'
      throw new Error(`GitHub API ${method} ${path} failed: HTTP ${response.status}, request ${requestId}`)
    }
    if (response.status === 204) return null
    return response.json()
  }
  const paginate = async path => {
    const output = []
    for (let page = 1; page <= 20; page += 1) {
      const joiner = path.includes('?') ? '&' : '?'
      const batch = await request('GET', `${path}${joiner}per_page=100&page=${page}`)
      if (!Array.isArray(batch)) throw new Error(`GitHub API pagination response for ${path} is invalid`)
      output.push(...batch)
      if (batch.length < 100) return output
    }
    throw new Error(`GitHub API pagination bound exceeded for ${path}`)
  }
  return { request, paginate }
}

async function managedIssueSnapshot(github, repository) {
  const issues = await github.paginate(`/repos/${repository}/issues?state=all&labels=${MANAGED_LABEL}`)
  return canonicalExistingIssues(issues.filter(issue => !issue.pull_request).map(issue => ({
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: issue.body ?? '',
    url: issue.html_url,
  })))
}

async function ensureLabels(github, repository, labels) {
  const current = await github.paginate(`/repos/${repository}/labels?`)
  const currentNames = new Set(current.map(label => String(label.name).toLowerCase()))
  for (const label of labels) {
    if (currentNames.has(label.name.toLowerCase())) continue
    try {
      await github.request('POST', `/repos/${repository}/labels`, label)
    } catch (error) {
      const refreshed = await github.paginate(`/repos/${repository}/labels?`)
      if (!refreshed.some(item => String(item.name).toLowerCase() === label.name.toLowerCase())) throw error
    }
  }
}

async function ensureComment(github, repository, issueNumber, marker, body) {
  const comments = await github.paginate(`/repos/${repository}/issues/${issueNumber}/comments?`)
  if (comments.some(comment => String(comment.body ?? '').includes(`<!-- ${marker} -->`))) return false
  await github.request('POST', `/repos/${repository}/issues/${issueNumber}/comments`, { body })
  return true
}

async function verifyIssue(github, repository, issueNumber, expected) {
  const issue = await github.request('GET', `/repos/${repository}/issues/${issueNumber}`)
  if (expected.title !== undefined && issue.title !== expected.title) throw new Error(`issue #${issueNumber} title readback mismatch`)
  if (expected.body !== undefined && issue.body !== expected.body) throw new Error(`issue #${issueNumber} body readback mismatch`)
  if (expected.state !== undefined && issue.state !== expected.state) throw new Error(`issue #${issueNumber} state readback mismatch`)
  if (expected.labels) {
    const actual = issue.labels.map(label => typeof label === 'string' ? label : label.name).sort()
    if (JSON.stringify(actual) !== JSON.stringify([...expected.labels].sort())) throw new Error(`issue #${issueNumber} label readback mismatch`)
  }
  return issue.html_url
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  for (const required of ['plan', 'catalog', 'candidates', 'report', 'notification-targets']) {
    if (!options[required]) throw new Error(`--${required} is required`)
  }
  const [planBuffer, catalogBuffer, candidatesBuffer, reportBuffer, targetsBuffer] = await Promise.all([
    readFile(resolve(options.plan)), readFile(resolve(options.catalog)), readFile(resolve(options.candidates)),
    readFile(resolve(options.report)), readFile(resolve(options['notification-targets'])),
  ])
  const plan = JSON.parse(planBuffer)
  validatePlan(plan)
  const expectedHashes = {
    catalogSha256: sha256(catalogBuffer),
    candidatesSha256: sha256(candidatesBuffer),
    reportSha256: sha256(reportBuffer),
    notificationTargetsSha256: sha256(targetsBuffer),
  }
  for (const [name, value] of Object.entries(expectedHashes)) {
    if (plan.preconditions[name] !== value) throw new Error(`${name} changed after the author notice plan was created`)
  }

  const repository = repositoryName(process.env.GITHUB_REPOSITORY)
  const github = githubClient(process.env.GITHUB_TOKEN)
  const authority = await github.request('GET', `/repos/${repository}/commits/main`)
  if (authority.sha !== plan.baseCommit) throw new Error('remote main changed after the author notice plan was created')
  const existing = await managedIssueSnapshot(github, repository)
  if (sha256(snapshotBuffer(existing)) !== plan.preconditions.existingIssuesSha256) {
    throw new Error('managed GitHub Issues changed after the author notice plan was created')
  }

  await ensureLabels(github, repository, plan.requiredLabels)
  const changed = []
  for (const action of plan.actions) {
    if (action.type === 'create') {
      const issue = await github.request('POST', `/repos/${repository}/issues`, {
        title: action.title, body: action.body, labels: action.labels,
      })
      const url = await verifyIssue(github, repository, issue.number, {
        title: action.title, body: action.body, state: 'open', labels: action.labels,
      })
      changed.push({ type: action.type, key: action.key, issueNumber: issue.number, url })
      continue
    }
    if (action.type === 'update') {
      await github.request('PATCH', `/repos/${repository}/issues/${action.issueNumber}`, {
        title: action.title, body: action.pendingBody, state: 'open', labels: action.labels,
      })
      await ensureComment(github, repository, action.issueNumber, action.commentMarker, action.comment)
      await github.request('PATCH', `/repos/${repository}/issues/${action.issueNumber}`, { body: action.body })
      const url = await verifyIssue(github, repository, action.issueNumber, {
        title: action.title, body: action.body, state: 'open', labels: action.labels,
      })
      changed.push({ type: action.type, key: action.key, issueNumber: action.issueNumber, url })
      continue
    }
    if (action.type === 'notify' || action.type === 'source-update') {
      await ensureComment(github, repository, action.issueNumber, action.commentMarker, action.comment)
      await github.request('PATCH', `/repos/${repository}/issues/${action.issueNumber}`, { body: action.body })
      const url = await verifyIssue(github, repository, action.issueNumber, { body: action.body, state: 'open' })
      changed.push({ type: action.type, key: action.key, issueNumber: action.issueNumber, url })
      continue
    }
    if (action.type === 'baseline') {
      await github.request('PATCH', `/repos/${repository}/issues/${action.issueNumber}`, { body: action.body })
      const url = await verifyIssue(github, repository, action.issueNumber, { body: action.body, state: 'open' })
      changed.push({ type: action.type, key: action.key, issueNumber: action.issueNumber, url })
      continue
    }
    await ensureComment(github, repository, action.issueNumber, action.commentMarker, action.comment)
    await github.request('PATCH', `/repos/${repository}/issues/${action.issueNumber}`, { state: 'closed' })
    const url = await verifyIssue(github, repository, action.issueNumber, { state: 'closed' })
    changed.push({ type: action.type, key: action.key, issueNumber: action.issueNumber, url })
  }

  process.stdout.write(`AUTHOR_NOTICES_APPLIED plan=${plan.planId} creates=${changed.filter(item => item.type === 'create').length} updates=${changed.filter(item => item.type === 'update' || item.type === 'notify' || item.type === 'source-update').length} baselines=${changed.filter(item => item.type === 'baseline').length} closes=${changed.filter(item => item.type === 'close').length}\n`)
  for (const item of changed) process.stdout.write(`${item.type.toUpperCase()} ${item.key} #${item.issueNumber} ${item.url}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
