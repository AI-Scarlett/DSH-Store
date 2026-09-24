#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubClient } from './author-contact-http.mjs'
import { humanIdentity, requireRepository } from './author-contact-state.mjs'

const AUTHOR_NOTICE_KEY_PATTERN = /<!--\s*dsh-author-notice:v1\s+key=([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})\b/

// A personal owner is authoritative. A shared organization or contribution is
// not proof of a single responsible maintainer: leave it unresolved.
export async function resolveTargets(request, key, accountCache = null) {
  requireRepository(key)
  try {
    const repository = await request(`/repos/${key}`)
    if (String(repository.full_name).toLowerCase() !== key.toLowerCase()) return null
    const owner = humanIdentity(repository.owner)
    if (!owner) return null
    let account
    if (accountCache && accountCache.has(owner.id)) {
      account = accountCache.get(owner.id)
    } else {
      account = humanIdentity(await request(`/user/${owner.id}`))
      if (accountCache) accountCache.set(owner.id, account)
    }
    return account?.id === owner.id && account.node_id === owner.node_id ? account : null
  } catch (error) {
    if ([404, 410, 451].includes(error.status)) return null
    throw error
  }
}

export function repositoryKeysFromIssues(issues) {
  if (!Array.isArray(issues) || issues.length > 2500) throw new Error('managed issue snapshot is invalid')
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
  if (plan.schemaVersion !== 0 || plan.mode !== 'identity-resolution-only'
    || !Array.isArray(plan.actions) || plan.actions.length !== 0) {
    throw new Error('invalid identity-only preliminary plan')
  }
  if (!Array.isArray(plan.contactRepositoryKeys) || plan.contactRepositoryKeys.length > 2500) throw new Error('invalid preliminary plan')
  const issueKeys = options.issues
    ? repositoryKeysFromIssues(JSON.parse(await readFile(resolve(options.issues), 'utf8')))
    : []
  const keys = [...new Set([...plan.contactRepositoryKeys, ...issueKeys])].sort()
  if (keys.length > 2500) throw new Error('author target repository bound exceeded')
  const knownTargets = new Map()
  if (options['contact-state']) {
    try {
      const contactSnapshot = JSON.parse(await readFile(resolve(options['contact-state']), 'utf8'))
      const contacts = contactSnapshot?.state?.contacts ?? {}
      for (const contact of Object.values(contacts)) {
        const identity = humanIdentity({ id: contact.userId, node_id: contact.nodeId, login: contact.logins?.[0], type: 'User' })
        if (!identity) continue
        for (const res of Object.values(contact.reservations ?? {})) {
          if (res?.key) knownTargets.set(String(res.key).toLowerCase(), identity)
        }
      }
    } catch {
      // optional contact-state cache read failure falls back to live resolution
    }
  }

  const github = githubClient(process.env.GITHUB_TOKEN)
  const accountCache = new Map()
  const entries = []
  const unresolved = []
  for (const key of keys) {
    const cached = knownTargets.get(key.toLowerCase())
    if (cached) {
      entries.push([key, cached])
    } else {
      unresolved.push(key)
    }
  }

  for (let i = 0; i < unresolved.length; i += 4) {
    entries.push(...await Promise.all(unresolved.slice(i, i + 4).map(async key => [key, await resolveTargets(path => github.request('GET', path), key, accountCache)])))
    if (i + 4 < unresolved.length) await new Promise(done => setTimeout(done, 50))
  }
  entries.sort(([left], [right]) => left.localeCompare(right, 'en'))
  await writeFile(resolve(options.output), JSON.stringify(Object.fromEntries(entries), null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  process.stdout.write(`AUTHOR_NOTICE_TARGETS_OK repositories=${keys.length} verifiedPeople=${entries.filter(([, value]) => value).length}\n`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
