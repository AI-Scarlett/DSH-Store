#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubClient } from './author-contact-http.mjs'
import { humanIdentity, requireRepository } from './author-contact-state.mjs'

const AUTHOR_NOTICE_KEY_PATTERN = /<!--\s*dsh-author-notice:v1\s+key=([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})\b/

// A personal owner is authoritative. A shared organization or contribution is
// not proof of a single responsible maintainer: leave it unresolved.
export async function resolveTargets(request, key) {
  requireRepository(key)
  try {
    const repository = await request(`/repos/${key}`)
    if (String(repository.full_name).toLowerCase() !== key.toLowerCase()) return null
    const owner = humanIdentity(repository.owner)
    if (!owner) return null
    const account = humanIdentity(await request(`/user/${owner.id}`))
    return account?.id === owner.id && account.node_id === owner.node_id ? account : null
  } catch (error) {
    if ([404, 410, 451].includes(error.status)) return null
    throw error
  }
}

export function repositoryKeysFromIssues(issues) {
  if (!Array.isArray(issues) || issues.length > 500) throw new Error('managed issue snapshot is invalid')
  const keys = new Set()
  for (const issue of issues) {
    const key = AUTHOR_NOTICE_KEY_PATTERN.exec(String(issue?.body ?? ''))?.[1]
    if (key) {
      requireRepository(key)
      keys.add(key)
    }
  }
  return [...keys].sort()
}

async function main() {
  const options = {}
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i + 1]) throw new Error('invalid argument')
    options[args[i].slice(2)] = args[i + 1]
  }
  if (!options.plan || !options.output) throw new Error('--plan and --output required')
  const plan = JSON.parse(await readFile(resolve(options.plan), 'utf8'))
  if (!Array.isArray(plan.contactRepositoryKeys) || plan.contactRepositoryKeys.length > 2500) throw new Error('invalid preliminary plan')
  const issueKeys = options.issues
    ? repositoryKeysFromIssues(JSON.parse(await readFile(resolve(options.issues), 'utf8')))
    : []
  const keys = [...new Set([...plan.contactRepositoryKeys, ...issueKeys])].sort()
  if (keys.length > 2500) throw new Error('author target repository bound exceeded')
  const github = githubClient(process.env.GITHUB_TOKEN)
  const entries = []
  for (let i = 0; i < keys.length; i += 6) {
    entries.push(...await Promise.all(keys.slice(i, i + 6).map(async key => [key, await resolveTargets(path => github.request('GET', path), key)])))
  }
  await writeFile(resolve(options.output), JSON.stringify(Object.fromEntries(entries), null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  process.stdout.write(`AUTHOR_NOTICE_TARGETS_OK repositories=${keys.length} verifiedPeople=${entries.filter(([, value]) => value).length}\n`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
