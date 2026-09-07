#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadCatalogFromFiles } from '../src/catalog.mjs'
import { githubClient } from './author-contact-http.mjs'
import { CONTACT_POLICY, contactBody, humanIdentity, reserveContact, readContactState } from './author-contact-state.mjs'
import { resolveTargets } from './resolve-author-notice-targets.mjs'
import { buildAuthorNoticePlan, canonicalExistingIssues, MAX_AUTHOR_NOTICE_ACTIONS, sha256 } from './plan-author-notices.mjs'

const MANAGED_LABEL = 'author-action-required'
const ACTION_TYPES = new Set(['create'])
const SOURCE_STATUSES = new Set([
  'new-baseline', 'tracking-baseline', 'modified-still-blocked', 'not-modified',
  'modified-and-resolved', 'resolved-without-source-change', 'resolved-source-unknown', 'unknown',
])
const CANDIDATE_COVERAGE_DISPOSITIONS = new Set([
  'direct-remediation', 'public-reviewing', 'public-remediation', 'public-deferred', 'public-discovery-only',
])
const CANDIDATE_NOTIFICATION_STATES = new Set(['managed-issue', 'scheduled-this-run', 'queued', 'public-registry-only', 'author-paused', 'contact-suppressed'])

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

export function validatePlan(plan) {
  if (plan?.schemaVersion !== 2 || plan?.policy?.globalPersonPolicy !== CONTACT_POLICY || plan.policy.automaticFollowups !== false) throw new Error('unsupported author notice plan schema')
  requiredString(plan.planId, 'planId', /^[0-9a-f]{24}$/)
  requiredString(plan.baseCommit, 'baseCommit', /^[0-9a-f]{40}$/)
  if (plan.sourceCatalogRunId !== null && plan.sourceCatalogRunId !== undefined) {
    requiredString(plan.sourceCatalogRunId, 'sourceCatalogRunId', /^\d+$/)
  }
  for (const name of ['catalogSha256', 'candidatesSha256', 'reportSha256', 'existingIssuesSha256', 'notificationTargetsSha256', 'contactStateSha256']) {
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
    if (!['author-paused', 'contact-suppressed'].includes(record.notificationState) && (record.disposition === 'direct-remediation') === (record.notificationState === 'public-registry-only')) {
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
    candidateDirectSuppressed: candidateNotificationCounts['contact-suppressed'],
    candidateAuthorPaused: candidateNotificationCounts['author-paused'],
    candidatePublicReviewing: candidateDispositionCounts['public-reviewing'],
    candidatePublicRemediation: candidateDispositionCounts['public-remediation'],
    candidatePublicDeferred: candidateDispositionCounts['public-deferred'],
    candidatePublicDiscoveryOnly: candidateDispositionCounts['public-discovery-only'],
    candidatePublicRegistryOnly: plan.candidateCoverage.length - candidateDispositionCounts['direct-remediation'],
  }
  for (const [name, value] of Object.entries(expectedCandidateSummary)) {
    if (plan.summary[name] !== value) throw new Error(`candidate coverage summary ${name} mismatch`)
  }
  if (plan.actions.length > MAX_AUTHOR_NOTICE_ACTIONS) throw new Error('author notice action bound exceeded')
  if (plan.actions.filter(action => action?.type === 'create').length > 12) throw new Error('author notice create bound exceeded')
  const people = new Set()
  const issueNumbers = new Set()
  for (const action of plan.actions) {
    if (!ACTION_TYPES.has(action?.type)) throw new Error('automatic followup is forbidden')
    const person = humanIdentity(action.recipient)
    if (!person || people.has(person.id)) throw new Error('invalid or duplicate recipient')
    people.add(person.id)
    const prefix = '@' + person.login + '\n\n'
    if (!action.body?.startsWith(prefix) || action.body !== contactBody(action.body.slice(prefix.length), person)
      || action.title?.includes('@')) throw new Error('unexpected recipient syntax')

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

async function managedIssueSnapshot(github, repository) {
  const issues = await github.paginate(`/repos/${repository}/issues?state=all&labels=${MANAGED_LABEL}`)
  return canonicalExistingIssues(issues.filter(issue => !issue.pull_request).map(issue => ({
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: issue.body ?? '',
    url: issue.html_url,
    labels: issue.labels,
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


export async function applyFirstContacts({ plan, github, repository, seed }) {
  validatePlan(plan)
  const changed = []
  if (plan.actions.length) await ensureLabels(github, repository, plan.requiredLabels)
  for (const action of plan.actions) {
    const live = await resolveTargets(path => github.request('GET', path), action.key)
    if (!live || live.id !== action.recipient.id || live.node_id !== action.recipient.node_id || live.login !== action.recipient.login) {
      throw new Error('recipient identity changed after planning; no message sent')
    }
    const claim = await reserveContact({
      github, repository, recipient: live, key: action.key, seed,
      claimId: sha256(`${plan.planId}:${live.id}`),
    })
    if (!claim.allowed) { changed.push({ key: action.key, type: 'suppressed', reason: claim.reason }); continue }
    const issue = await github.request('POST', `/repos/${repository}/issues`, {
      title: action.title, body: action.body, labels: action.labels,
    })
    const url = await verifyIssue(github, repository, issue.number, {
      title: action.title, body: action.body, state: 'open', labels: action.labels,
    })
    changed.push({ type: 'create', key: action.key, userId: live.id, issueNumber: issue.number, url })
  }
  return changed
}
async function main() {
  const options = parseArgs(process.argv.slice(2))
  for (const key of ['plan', 'catalog', 'candidates', 'report', 'notification-targets', 'contact-state']) {
    if (!options[key]) throw new Error(`--${key} is required`)
  }
  const [planBuffer, catalogBuffer, candidatesBuffer, reportBuffer, targetsBuffer, contactBuffer] = await Promise.all(
    ['plan', 'catalog', 'candidates', 'report', 'notification-targets', 'contact-state'].map(key => readFile(resolve(options[key]))),
  )
  const plan = JSON.parse(planBuffer)
  validatePlan(plan)
  const expectedHashes = {
    catalogSha256: sha256(catalogBuffer), candidatesSha256: sha256(candidatesBuffer),
    reportSha256: sha256(reportBuffer), notificationTargetsSha256: sha256(targetsBuffer),
    contactStateSha256: sha256(contactBuffer),
  }
  for (const [name, value] of Object.entries(expectedHashes)) {
    if (plan.preconditions[name] !== value) throw new Error(`${name} changed after planning`)
  }
  const repository = repositoryName(process.env.GITHUB_REPOSITORY)
  if (repository.toLowerCase() !== 'ai-scarlett/dsh-store') throw new Error('contact ledger authority must be AI-Scarlett/DSH-Store')
  const github = githubClient(process.env.GITHUB_TOKEN)
  const authority = await github.request('GET', `/repos/${repository}/commits/main`)
  if (authority.sha !== plan.baseCommit) throw new Error('remote main changed after planning')
  const existing = await managedIssueSnapshot(github, repository)
  if (sha256(snapshotBuffer(existing)) !== plan.preconditions.existingIssuesSha256) throw new Error('managed Issues changed after planning')
  const contactSnapshot = JSON.parse(contactBuffer)
  const liveState = await readContactState(github, repository)
  if (liveState.fileSha !== contactSnapshot.fileSha) throw new Error('contact state changed after planning; regenerate plan')
  const root = JSON.parse(catalogBuffer)
  const catalog = root?.registry?.indexPath ? await loadCatalogFromFiles({ indexUrl: pathToFileURL(resolve(options.catalog)) }) : root
  const expected = buildAuthorNoticePlan({
    catalog, candidates: JSON.parse(candidatesBuffer), report: JSON.parse(reportBuffer),
    notificationTargets: JSON.parse(targetsBuffer), existingIssues: existing, contactSnapshot,
    baseCommit: plan.baseCommit, inputHashes: plan.preconditions,
    maxCreate: plan.policy.maxNewIssuesPerRun, sourceCatalogRunId: plan.sourceCatalogRunId,
  })
  if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error('plan does not match the recomputed contact policy')
  const changed = await applyFirstContacts({ plan, github, repository })
  process.stdout.write(`AUTHOR_NOTICES_APPLIED plan=${plan.planId} creates=${changed.filter(item => item.type === 'create').length} suppressed=${changed.filter(item => item.type === 'suppressed').length}\n`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
