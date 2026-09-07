#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { githubClient } from './author-contact-http.mjs'

const MAX_ISSUES = 500
const MAX_ITEMS = 100
const MAX_COMMENT_PAGES = 20
const STORE_PROBLEM_PATTERNS = [
  /dsh[\s-]*store/i,
  /automaticFollowups/i,
  /自动(?:化|复检|更新|通知)/i,
  /扫描(?:器|逻辑)?|误报|阻断条件/i,
  /false[\s-]+positive|@mention|recheck|follow[\s-]?up|workflow/i,
]

function requiredString(value, name, maximum = 65_000) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) throw new Error(`${name} is invalid`)
  return value
}

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} is invalid`)
  return value
}

function array(value) {
  return Array.isArray(value) ? value : []
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function isDshStoreProblem(body) {
  const text = String(body ?? '')
  return STORE_PROBLEM_PATTERNS.some(pattern => pattern.test(text))
}

function safeUrl(value) {
  requiredString(value, 'URL', 2_000)
  if (!/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\/|#|$)/.test(value)) throw new Error('GitHub URL is invalid')
  return value
}

function canonicalIssue(value) {
  return {
    number: integer(value?.number, 'issue number'),
    title: requiredString(value?.title ?? '', 'issue title', 256),
    url: safeUrl(value?.url ?? value?.html_url),
    body: typeof value?.body === 'string' ? value.body : '',
    author: value?.author && {
      id: integer(value.author.id, 'issue author id'),
      login: requiredString(value.author.login, 'issue author login', 40),
      nodeId: requiredString(value.author.node_id, 'issue author node id', 256),
    },
  }
}

function noticeRepositoryKey(body) {
  const match = /<!--\s*dsh-author-notice:v1\s+key=([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})\b/.exec(String(body ?? ''))
  return match?.[1] ?? null
}

function notificationTarget(issue, notificationTargets) {
  if (notificationTargets === null) return issue.author ?? null
  const key = noticeRepositoryKey(issue.body)
  if (!key || !notificationTargets || typeof notificationTargets !== 'object' || Array.isArray(notificationTargets)) return null
  const target = notificationTargets[key]
    ?? Object.entries(notificationTargets).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase())?.[1]
  return target?.type === 'User' && Number.isSafeInteger(target.id)
    && typeof target.login === 'string' && typeof target.node_id === 'string'
    ? { id: target.id, login: target.login, nodeId: target.node_id }
    : null
}

function commentTime(comment) {
  const value = Date.parse(comment?.updated_at ?? comment?.created_at ?? '')
  return Number.isFinite(value) ? value : 0
}

function isHumanAuthorComment(comment, recipient) {
  const user = comment?.user
  return user?.type === 'User'
    && Number(user.id) === recipient?.id
    && String(user.node_id) === recipient?.nodeId
}

function excerpt(body) {
  return String(body ?? '')
    .replace(/\r?\n/g, ' ')
    .replaceAll('@', '＠')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360)
}

export function validateAuthorFeedback(value) {
  if (value?.schemaVersion !== 1 || value?.source?.repository !== 'AI-Scarlett/DSH-Store') {
    throw new Error('author feedback source is invalid')
  }
  requiredString(value.observedAt, 'observedAt', 64)
  if (!Array.isArray(value.items) || value.items.length > MAX_ITEMS) throw new Error('author feedback items are invalid')
  const seen = new Set()
  for (const item of value.items) {
    integer(item.issueNumber, 'feedback issue number')
    integer(item.commentId, 'feedback comment id')
    if (seen.has(item.commentId)) throw new Error('duplicate feedback comment')
    seen.add(item.commentId)
    safeUrl(item.issueUrl); safeUrl(item.commentUrl)
    integer(item.author?.id, 'feedback author id')
    requiredString(item.author?.login, 'feedback author login', 40)
    requiredString(item.author?.nodeId, 'feedback author node id', 256)
    if (item.category !== 'dsh-store-problem' || item.needsManualReview !== true) throw new Error('feedback category is invalid')
    requiredString(item.bodySha256, 'feedback body hash', 64)
    if (!/^[0-9a-f]{64}$/.test(item.bodySha256)) throw new Error('feedback body hash is invalid')
    requiredString(item.excerpt, 'feedback excerpt', 400)
  }
  if (value.summary?.storeProblems !== value.items.length || value.summary?.manualReview !== value.items.length) {
    throw new Error('author feedback summary is invalid')
  }
  return value
}

export async function collectAuthorFeedback({ github, repository = 'AI-Scarlett/DSH-Store', issues, observedAt, notificationTargets = null }) {
  if (repository.toLowerCase() !== 'ai-scarlett/dsh-store') throw new Error('feedback authority must be AI-Scarlett/DSH-Store')
  if (!Array.isArray(issues) || issues.length > MAX_ISSUES) throw new Error('managed issue snapshot is invalid')
  const items = []
  for (const rawIssue of issues) {
    const issue = canonicalIssue(rawIssue)
    const recipient = notificationTarget(issue, notificationTargets)
    if (!recipient) continue
    const comments = await github.paginate(`/repos/${repository}/issues/${issue.number}/comments`)
    if (comments.length > MAX_COMMENT_PAGES * 100) throw new Error('author feedback comment bound exceeded')
    const latest = comments
      .filter(comment => isHumanAuthorComment(comment, recipient) && String(comment.body ?? '').trim() && isDshStoreProblem(comment.body))
      .sort((left, right) => commentTime(left) - commentTime(right) || Number(left.id) - Number(right.id))
      .at(-1)
    if (!latest) continue
    const author = latest.user
    const body = String(latest.body)
    items.push({
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueUrl: issue.url,
      author: { id: integer(author.id, 'comment author id'), login: requiredString(author.login, 'comment author login', 40), nodeId: requiredString(author.node_id, 'comment author node id', 256) },
      commentId: integer(latest.id, 'feedback comment id'),
      commentUrl: safeUrl(latest.html_url),
      createdAt: requiredString(latest.updated_at ?? latest.created_at, 'feedback timestamp', 64),
      bodySha256: sha256(body),
      category: 'dsh-store-problem',
      needsManualReview: true,
      excerpt: excerpt(body),
    })
  }
  items.sort((left, right) => left.commentId - right.commentId)
  const result = {
    schemaVersion: 1,
    observedAt: requiredString(observedAt ?? new Date().toISOString(), 'observedAt', 64),
    source: { repository, managedLabel: 'author-action-required', identity: 'issue-author-immutable-user-id' },
    items,
    summary: { storeProblems: items.length, manualReview: items.length },
  }
  return validateAuthorFeedback(result)
}

export function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!flag.startsWith('--')) throw new Error(`invalid argument: ${flag}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    const key = flag.slice(2)
    if (Object.hasOwn(args, key)) throw new Error(`duplicate argument: ${flag}`)
    args[key] = value
    index += 1
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.issues || !args.output) throw new Error('--issues and --output are required')
  const issues = JSON.parse(await readFile(resolve(args.issues), 'utf8'))
  const notificationTargets = args['notification-targets']
    ? JSON.parse(await readFile(resolve(args['notification-targets']), 'utf8'))
    : null
  const feedback = await collectAuthorFeedback({
    github: githubClient(process.env.GITHUB_TOKEN),
    issues,
    observedAt: args['observed-at'],
    notificationTargets,
  })
  await writeFile(resolve(args.output), `${JSON.stringify(feedback, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  process.stdout.write(`AUTHOR_FEEDBACK_OK store_problems=${feedback.summary.storeProblems} manual_review=${feedback.summary.manualReview}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
