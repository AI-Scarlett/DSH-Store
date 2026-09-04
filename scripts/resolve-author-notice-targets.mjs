#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_AUTHOR_NOTICE_ACTIONS } from './plan-author-notices.mjs'

const API_ROOT = 'https://api.github.com'

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error(`invalid argument: ${name}`)
    options[name.slice(2)] = value
    index += 1
  }
  return options
}

function githubClient(token) {
  if (typeof token !== 'string' || token.length < 1) throw new Error('GITHUB_TOKEN is required')
  return async function request(path, attempt = 1) {
    const response = await fetch(`${API_ROOT}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'dsh-store-author-target-resolver',
        'x-github-api-version': '2022-11-28',
      },
    })
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise(resolvePromise => setTimeout(resolvePromise, attempt * 1_000))
      return request(path, attempt + 1)
    }
    if (!response.ok) {
      const requestId = response.headers.get('x-github-request-id') ?? 'unknown'
      throw new Error(`GitHub API GET failed: HTTP ${response.status}, request ${requestId}`)
    }
    return response.json()
  }
}

function humanLogin(account, excluded) {
  const login = String(account?.login ?? '')
  if (account?.type !== 'User' || login === '' || login.toLowerCase() === excluded.toLowerCase()) return null
  if (/\[bot\]$|^(?:dependabot|github-actions)$/i.test(login)) return null
  return login
}

async function resolveTargets(request, key) {
  const repository = await request(`/repos/${key}`)
  const owner = String(repository?.owner?.login ?? '')
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) throw new Error(`repository owner is invalid for ${key}`)
  if (repository.owner.type === 'User') return [owner]

  const commits = await request(`/repos/${key}/commits?per_page=20`)
  const commitAuthor = Array.isArray(commits)
    ? commits.map(commit => humanLogin(commit.author, owner)).find(Boolean)
    : null
  if (commitAuthor) return [commitAuthor]

  const contributors = await request(`/repos/${key}/contributors?per_page=20&anon=0`)
  const contributor = Array.isArray(contributors)
    ? contributors.map(item => humanLogin(item, owner)).find(Boolean)
    : null
  return [contributor ?? owner]
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.plan || !options.output) throw new Error('--plan and --output are required')
  const plan = JSON.parse(await readFile(resolve(options.plan), 'utf8'))
  if (plan?.schemaVersion !== 1 || !Array.isArray(plan.actions) || plan.actions.length > MAX_AUTHOR_NOTICE_ACTIONS) {
    throw new Error('preliminary author notice plan is invalid')
  }
  const keys = [...new Set(plan.actions.filter(action => action.type !== 'close').map(action => {
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(String(action.key ?? ''))) throw new Error('action repository key is invalid')
    return action.key
  }))].sort()
  const request = githubClient(process.env.GITHUB_TOKEN)
  const entries = []
  for (let index = 0; index < keys.length; index += 6) {
    const batch = keys.slice(index, index + 6)
    entries.push(...await Promise.all(batch.map(async key => [key, await resolveTargets(request, key)])))
  }
  const targets = Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right, 'en')))
  await writeFile(resolve(options.output), `${JSON.stringify(targets, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  process.stdout.write(`AUTHOR_NOTICE_TARGETS_OK repositories=${keys.length}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
