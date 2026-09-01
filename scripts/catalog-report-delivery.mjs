#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_ROOT = 'https://api.github.com'
const ISSUE_TITLE = 'DSH STORE 自动更新报告（每 3 小时）'
const MANAGED_MARKER_PREFIX = '<!-- dsh-catalog-report:'
const ACTION_TYPES = new Set(['create', 'comment', 'update', 'skip'])

function parseArgs(argv) {
  const mode = argv[0]
  if (!['snapshot', 'plan', 'apply'].includes(mode)) throw new Error('first argument must be snapshot, plan, or apply')
  const options = {}
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`invalid argument: ${name}`)
    }
    options[name.slice(2)] = value
    index += 1
  }
  return { mode, options }
}

function requiredString(value, name, pattern, maximum = 65_000) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || (pattern && !pattern.test(value))) {
    throw new Error(`${name} is invalid`)
  }
  return value
}

function repositoryName(value) {
  return requiredString(value, 'GITHUB_REPOSITORY', /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalComment(value) {
  if (!Number.isInteger(value?.id) || value.id < 1) throw new Error('managed report comment id is invalid')
  return {
    id: value.id,
    body: requiredString(value.body ?? '', 'managed report comment body', null),
  }
}

export function canonicalReportDeliveryState(value) {
  if (value?.issue === null || value?.issue === undefined) return { issue: null }
  const issue = value.issue
  if (!Number.isInteger(issue.number) || issue.number < 1) throw new Error('report issue number is invalid')
  if (issue.title !== ISSUE_TITLE) throw new Error('report issue title is invalid')
  if (!['open', 'closed'].includes(issue.state)) throw new Error('report issue state is invalid')
  const comments = Array.isArray(issue.comments) ? issue.comments.map(canonicalComment) : []
  comments.sort((left, right) => left.id - right.id)
  if (comments.length > 2_000) throw new Error('managed report comment bound exceeded')
  const ids = new Set()
  for (const comment of comments) {
    if (ids.has(comment.id)) throw new Error('managed report comment id is duplicated')
    ids.add(comment.id)
  }
  return {
    issue: {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      url: requiredString(issue.url, 'report issue url', /^https:\/\/github\.com\//),
      body: typeof issue.body === 'string' ? issue.body : '',
      comments,
    },
  }
}

function stateBuffer(value) {
  return Buffer.from(`${JSON.stringify(canonicalReportDeliveryState(value), null, 2)}\n`)
}

function markerFor(deliveryKey) {
  requiredString(deliveryKey, 'deliveryKey', /^[a-z0-9][a-z0-9-]{0,95}$/)
  return `dsh-catalog-report:v1:${deliveryKey}`
}

function publishedBody(marker, reportBody) {
  const body = `<!-- ${marker} -->\n${reportBody.toString('utf8').trimEnd()}\n`
  if (Buffer.byteLength(body) > 65_000) throw new Error('catalog report body exceeds the GitHub Issue bound')
  return body
}

export function createCatalogReportDeliveryPlan({
  baseCommit,
  catalogRunId,
  deliveryKey,
  reportBody,
  state,
}) {
  requiredString(baseCommit, 'baseCommit', /^[0-9a-f]{40}$/)
  requiredString(catalogRunId, 'catalogRunId', /^\d+$/)
  if (!Buffer.isBuffer(reportBody)) throw new Error('reportBody must be a Buffer')
  if (!deliveryKey.includes(catalogRunId)) throw new Error('deliveryKey must contain catalogRunId')
  const canonicalState = canonicalReportDeliveryState(state)
  const marker = markerFor(deliveryKey)
  const body = publishedBody(marker, reportBody)
  if (!body.includes('@AI-Scarlett')) throw new Error('catalog report must mention @AI-Scarlett')
  const issue = canonicalState.issue
  const markerText = `<!-- ${marker} -->`
  const deliveredTargets = issue === null ? [] : [
    ...(issue.body.includes(markerText) ? [{ commentId: null, body: issue.body }] : []),
    ...issue.comments
      .filter(comment => comment.body.includes(markerText))
      .map(comment => ({ commentId: comment.id, body: comment.body })),
  ]
  if (deliveredTargets.length > 1) throw new Error('catalog report marker is duplicated')
  const deliveredTarget = deliveredTargets[0] ?? null
  const action = issue === null
    ? { type: 'create', issueNumber: null, reopen: false }
    : deliveredTarget === null
      ? { type: 'comment', issueNumber: issue.number, reopen: issue.state === 'closed' }
      : deliveredTarget.body === body
        ? { type: 'skip', issueNumber: issue.number, reopen: false }
        : {
            type: 'update',
            issueNumber: issue.number,
            commentId: deliveredTarget.commentId,
            reopen: issue.state === 'closed',
          }
  const planWithoutId = {
    schemaVersion: 1,
    operation: 'deliver-catalog-run-report',
    baseCommit,
    catalogRunId,
    deliveryKey,
    marker,
    issueTitle: ISSUE_TITLE,
    preconditions: {
      reportBodySha256: sha256(reportBody),
      reportStateSha256: sha256(stateBuffer(canonicalState)),
    },
    postconditions: {
      publishedBodySha256: sha256(body),
      mention: '@AI-Scarlett',
      githubNotificationEmailDeliveryVerified: false,
    },
    action,
  }
  return {
    ...planWithoutId,
    planId: sha256(JSON.stringify(planWithoutId)).slice(0, 24),
  }
}

export function validateCatalogReportDeliveryPlan(plan) {
  if (plan?.schemaVersion !== 1 || plan?.operation !== 'deliver-catalog-run-report') {
    throw new Error('unsupported catalog report delivery plan')
  }
  requiredString(plan.planId, 'planId', /^[0-9a-f]{24}$/)
  requiredString(plan.baseCommit, 'baseCommit', /^[0-9a-f]{40}$/)
  requiredString(plan.catalogRunId, 'catalogRunId', /^\d+$/)
  if (!plan.deliveryKey.includes(plan.catalogRunId)) throw new Error('deliveryKey must contain catalogRunId')
  if (plan.marker !== markerFor(plan.deliveryKey)) throw new Error('catalog report marker mismatch')
  if (plan.issueTitle !== ISSUE_TITLE) throw new Error('catalog report issue title mismatch')
  for (const name of ['reportBodySha256', 'reportStateSha256']) {
    requiredString(plan?.preconditions?.[name], `preconditions.${name}`, /^[0-9a-f]{64}$/)
  }
  requiredString(plan?.postconditions?.publishedBodySha256, 'postconditions.publishedBodySha256', /^[0-9a-f]{64}$/)
  if (plan?.postconditions?.mention !== '@AI-Scarlett'
    || plan?.postconditions?.githubNotificationEmailDeliveryVerified !== false) {
    throw new Error('catalog report delivery postconditions are invalid')
  }
  if (!ACTION_TYPES.has(plan?.action?.type)) throw new Error('catalog report action type is invalid')
  if (plan.action.type === 'create') {
    if (plan.action.issueNumber !== null || plan.action.reopen !== false) throw new Error('catalog report create action is invalid')
  } else if (!Number.isInteger(plan.action.issueNumber) || plan.action.issueNumber < 1) {
    throw new Error('catalog report issue action is invalid')
  }
  if (plan.action.type === 'update'
    && plan.action.commentId !== null
    && (!Number.isInteger(plan.action.commentId) || plan.action.commentId < 1)) {
    throw new Error('catalog report update target is invalid')
  }
  if (plan.action.type !== 'update' && plan.action.commentId !== undefined) {
    throw new Error('catalog report comment target is unexpected')
  }
  if (typeof plan.action.reopen !== 'boolean') throw new Error('catalog report reopen flag is invalid')
}

function githubClient(token) {
  requiredString(token, 'GITHUB_TOKEN', null, 10_000)
  const request = async (method, path, body, attempt = 1) => {
    const response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'dsh-store-catalog-report-delivery',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (method === 'GET' && (response.status === 429 || response.status >= 500) && attempt < 4) {
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

async function snapshotReportState(github, repository) {
  const issues = await github.paginate(`/repos/${repository}/issues?state=all`)
  const matching = issues.filter(issue => !issue.pull_request && issue.title === ISSUE_TITLE)
  if (matching.length > 1) throw new Error('multiple managed Catalog report Issues exist')
  if (matching.length === 0) return { issue: null }
  const issue = matching[0]
  const comments = await github.paginate(`/repos/${repository}/issues/${issue.number}/comments?`)
  return canonicalReportDeliveryState({
    issue: {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      url: issue.html_url,
      body: issue.body ?? '',
      comments: comments
        .filter(comment => String(comment.body ?? '').includes(MANAGED_MARKER_PREFIX))
        .map(comment => ({ id: comment.id, body: comment.body ?? '' })),
    },
  })
}

async function writeNewJson(path, value) {
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

async function snapshotMode(options) {
  if (!options.output) throw new Error('--output is required')
  const repository = repositoryName(process.env.GITHUB_REPOSITORY)
  const github = githubClient(process.env.GITHUB_TOKEN)
  const state = await snapshotReportState(github, repository)
  await writeNewJson(options.output, state)
  process.stdout.write(`CATALOG_REPORT_STATE_OK issue=${state.issue?.number ?? 'none'} managed_comments=${state.issue?.comments.length ?? 0}\n`)
}

async function planMode(options) {
  for (const required of ['report', 'state', 'base-commit', 'catalog-run-id', 'delivery-key', 'output']) {
    if (!options[required]) throw new Error(`--${required} is required`)
  }
  const [reportBody, stateBufferValue] = await Promise.all([
    readFile(resolve(options.report)),
    readFile(resolve(options.state)),
  ])
  const plan = createCatalogReportDeliveryPlan({
    baseCommit: options['base-commit'],
    catalogRunId: options['catalog-run-id'],
    deliveryKey: options['delivery-key'],
    reportBody,
    state: JSON.parse(stateBufferValue),
  })
  await writeNewJson(options.output, plan)
  process.stdout.write(`CATALOG_REPORT_PLAN_OK plan=${plan.planId} action=${plan.action.type} run=${plan.catalogRunId}\n`)
}

async function applyMode(options) {
  for (const required of ['plan', 'report']) if (!options[required]) throw new Error(`--${required} is required`)
  const [planBuffer, reportBody] = await Promise.all([
    readFile(resolve(options.plan)),
    readFile(resolve(options.report)),
  ])
  const plan = JSON.parse(planBuffer)
  validateCatalogReportDeliveryPlan(plan)
  if (sha256(reportBody) !== plan.preconditions.reportBodySha256) {
    throw new Error('catalog report body changed after the delivery plan was created')
  }
  const body = publishedBody(plan.marker, reportBody)
  if (sha256(body) !== plan.postconditions.publishedBodySha256 || !body.includes('@AI-Scarlett')) {
    throw new Error('catalog report published body postcondition failed')
  }

  const repository = repositoryName(process.env.GITHUB_REPOSITORY)
  const github = githubClient(process.env.GITHUB_TOKEN)
  const authority = await github.request('GET', `/repos/${repository}/commits/main`)
  if (authority.sha !== plan.baseCommit) throw new Error('remote main changed after the Catalog report delivery plan was created')
  const currentState = await snapshotReportState(github, repository)
  if (sha256(stateBuffer(currentState)) !== plan.preconditions.reportStateSha256) {
    throw new Error('managed Catalog report Issue changed after the delivery plan was created')
  }
  const expected = createCatalogReportDeliveryPlan({
    baseCommit: plan.baseCommit,
    catalogRunId: plan.catalogRunId,
    deliveryKey: plan.deliveryKey,
    reportBody,
    state: currentState,
  })
  if (JSON.stringify(expected) !== JSON.stringify(plan)) throw new Error('Catalog report delivery plan no longer matches current state')

  if (plan.action.type === 'skip') {
    process.stdout.write(`CATALOG_REPORT_APPLIED plan=${plan.planId} action=skip run=${plan.catalogRunId} issue=${plan.action.issueNumber}\n`)
    return
  }
  if (plan.action.type === 'create') {
    const issue = await github.request('POST', `/repos/${repository}/issues`, { title: plan.issueTitle, body })
    if (issue.title !== plan.issueTitle || issue.body !== body || issue.state !== 'open') {
      throw new Error('created Catalog report Issue readback mismatch')
    }
    process.stdout.write(`CATALOG_REPORT_APPLIED plan=${plan.planId} action=create run=${plan.catalogRunId} issue=${issue.number} ${issue.html_url}\n`)
    return
  }

  if (plan.action.type === 'update') {
    let url
    if (plan.action.commentId === null) {
      const issue = await github.request('PATCH', `/repos/${repository}/issues/${plan.action.issueNumber}`, {
        body,
        ...(plan.action.reopen ? { state: 'open' } : {}),
      })
      if (issue.body !== body || (plan.action.reopen && issue.state !== 'open')) {
        throw new Error('updated Catalog report Issue readback mismatch')
      }
      url = issue.html_url
    } else {
      const comment = await github.request('PATCH', `/repos/${repository}/issues/comments/${plan.action.commentId}`, { body })
      if (comment.body !== body) throw new Error('updated Catalog report comment readback mismatch')
      url = comment.html_url
      if (plan.action.reopen) {
        const issue = await github.request('PATCH', `/repos/${repository}/issues/${plan.action.issueNumber}`, { state: 'open' })
        if (issue.state !== 'open') throw new Error('Catalog report Issue reopen readback mismatch')
      }
    }
    process.stdout.write(`CATALOG_REPORT_APPLIED plan=${plan.planId} action=update run=${plan.catalogRunId} issue=${plan.action.issueNumber} ${url}\n`)
    return
  }

  const comment = await github.request('POST', `/repos/${repository}/issues/${plan.action.issueNumber}/comments`, { body })
  if (comment.body !== body) throw new Error('Catalog report comment readback mismatch')
  if (plan.action.reopen) {
    const issue = await github.request('PATCH', `/repos/${repository}/issues/${plan.action.issueNumber}`, { state: 'open' })
    if (issue.state !== 'open') throw new Error('Catalog report Issue reopen readback mismatch')
  }
  process.stdout.write(`CATALOG_REPORT_APPLIED plan=${plan.planId} action=comment run=${plan.catalogRunId} issue=${plan.action.issueNumber} ${comment.html_url}\n`)
}

async function main() {
  const { mode, options } = parseArgs(process.argv.slice(2))
  if (mode === 'snapshot') return snapshotMode(options)
  if (mode === 'plan') return planMode(options)
  return applyMode(options)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
