#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { validateCatalog } from '../src/catalog.mjs'

const run = promisify(execFile)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const catalogPath = resolve(root, 'registry/catalog.json')

function args(argv) {
  const result = { write: false, expectedSha: null, observedAt: null, backup: null, allowLocalSelf: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--write') result.write = true
    else if (value === '--allow-local-self') result.allowLocalSelf = true
    else if (value === '--expected-sha') result.expectedSha = argv[++index]
    else if (value === '--observed-at') result.observedAt = argv[++index]
    else if (value === '--backup') result.backup = argv[++index]
    else throw new Error(`unknown argument: ${value}`)
  }
  return result
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function githubParts(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(url)
  if (!match) throw new Error(`unsupported repository URL: ${url}`)
  return { owner: match[1], repository: match[2] }
}

function iso(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO date-time`)
  return new Date(value).toISOString()
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

async function commitMetadata(entry, registryRepositoryUrl) {
  const { owner, repository } = githubParts(entry.repositoryUrl)
  const route = `repos/${owner}/${repository}/commits/${entry.commit}`
  try {
    const { stdout } = await run('gh', ['api', route, '--jq', '.commit.committer.date // .commit.author.date'], {
      encoding: 'utf8', maxBuffer: 1024 * 1024,
    })
    return { updatedAt: iso(stdout.trim(), `${entry.id} commit date`), provenance: 'github-commit' }
  } catch (error) {
    if (!options.allowLocalSelf || entry.repositoryUrl !== registryRepositoryUrl) throw error
    await run('git', ['cat-file', '-e', `${entry.commit}^{commit}`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 })
    const { stdout } = await run('git', ['show', '-s', '--format=%cI', entry.commit], {
      cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024,
    })
    return { updatedAt: iso(stdout.trim(), `${entry.id} local commit date`), provenance: 'unknown' }
  }
}

const options = args(process.argv.slice(2))
const original = await readFile(catalogPath)
const originalSha = sha256(original)
if (!options.write) throw new Error('refusing to change the catalog without --write')
if (!/^[a-f0-9]{64}$/.test(options.expectedSha ?? '') || options.expectedSha !== originalSha) {
  throw new Error(`catalog precondition hash mismatch: ${originalSha}`)
}
const backupPath = options.backup ? resolve(options.backup) : null
const backupRelative = backupPath ? relative(root, backupPath) : ''
if (!options.backup || !isAbsolute(options.backup) || backupRelative === '' || (!backupRelative.startsWith('..') && !isAbsolute(backupRelative))) {
  throw new Error('--backup must be an explicit absolute file outside the repository')
}
const observedAt = iso(options.observedAt, '--observed-at')
const catalog = JSON.parse(original.toString('utf8'))
const metadata = await mapLimit(catalog.entries, 4, entry => commitMetadata(entry, catalog.registry.repositoryUrl))
for (let index = 0; index < catalog.entries.length; index += 1) {
  catalog.entries[index].source = { ...metadata[index], observedAt }
}
catalog.registry.updatedAt = observedAt
validateCatalog(catalog)
const serialized = `${JSON.stringify(catalog, null, 2)}\n`
const temporary = `${catalogPath}.tmp-${process.pid}`
await copyFile(catalogPath, backupPath)
await writeFile(temporary, serialized, { flag: 'wx', mode: 0o644 })
await rename(temporary, catalogPath)
console.log(`CATALOG_SOURCE_METADATA_OK entries=${catalog.entries.length} before=${originalSha} after=${sha256(Buffer.from(serialized))}`)
