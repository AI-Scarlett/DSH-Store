#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { loadCatalogFromFiles, splitCatalogDocument, validateCatalog } from '../src/catalog.mjs'

const run = promisify(execFile)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const catalogPath = resolve(root, 'registry/catalog.json')
const catalogIndexPath = resolve(root, 'registry/catalog-index.json')
const catalogDetailsPath = resolve(root, 'registry/catalog/details')

function args(argv) {
  const result = {
    write: false, expectedSha: null, expectedIndexSha: null, observedAt: null,
    backup: null, indexBackup: null, detailsBackup: null, allowLocalSelf: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--write') result.write = true
    else if (value === '--allow-local-self') result.allowLocalSelf = true
    else if (value === '--expected-sha') result.expectedSha = argv[++index]
    else if (value === '--expected-index-sha') result.expectedIndexSha = argv[++index]
    else if (value === '--observed-at') result.observedAt = argv[++index]
    else if (value === '--backup') result.backup = argv[++index]
    else if (value === '--index-backup') result.indexBackup = argv[++index]
    else if (value === '--details-backup') result.detailsBackup = argv[++index]
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

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))

async function commitMetadata(entry, registryRepositoryUrl) {
  const { owner, repository } = githubParts(entry.repositoryUrl)
  const route = `repos/${owner}/${repository}/commits/${entry.commit}`
  let lastError = null
  for (const retryDelay of [0, 500, 1_500]) {
    if (retryDelay > 0) await delay(retryDelay)
    try {
      const { stdout } = await run('gh', ['api', route, '--cache', '1h', '--jq', '.commit.committer.date // .commit.author.date'], {
        encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 12_000,
      })
      return { updatedAt: iso(stdout.trim(), `${entry.id} commit date`), provenance: 'github-commit' }
    } catch (error) {
      lastError = error
    }
  }
  if (!options.allowLocalSelf || entry.repositoryUrl !== registryRepositoryUrl) throw lastError
  await run('git', ['cat-file', '-e', `${entry.commit}^{commit}`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 })
  const { stdout } = await run('git', ['show', '-s', '--format=%cI', entry.commit], {
    cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024,
  })
  return { updatedAt: iso(stdout.trim(), `${entry.id} local commit date`), provenance: 'unknown' }
}

const options = args(process.argv.slice(2))
const original = await readFile(catalogPath)
const originalIndex = await readFile(catalogIndexPath)
const originalSha = sha256(original)
const originalIndexSha = sha256(originalIndex)
if (!options.write) throw new Error('refusing to change the catalog without --write')
if (!/^[a-f0-9]{64}$/.test(options.expectedSha ?? '') || options.expectedSha !== originalSha
  || !/^[a-f0-9]{64}$/.test(options.expectedIndexSha ?? '') || options.expectedIndexSha !== originalIndexSha) {
  throw new Error(`catalog precondition hash mismatch: ${originalSha}`)
}
const backupPath = options.backup ? resolve(options.backup) : null
const indexBackupPath = options.indexBackup ? resolve(options.indexBackup) : null
const backupRelative = backupPath ? relative(root, backupPath) : ''
if (!options.backup || !isAbsolute(options.backup) || backupRelative === '' || (!backupRelative.startsWith('..') && !isAbsolute(backupRelative))) {
  throw new Error('--backup must be an explicit absolute file outside the repository')
}
const indexBackupRelative = indexBackupPath ? relative(root, indexBackupPath) : ''
if (!options.indexBackup || !isAbsolute(options.indexBackup) || indexBackupRelative === ''
  || (!indexBackupRelative.startsWith('..') && !isAbsolute(indexBackupRelative))) {
  throw new Error('--index-backup must be an explicit absolute file outside the repository')
}
const observedAt = iso(options.observedAt, '--observed-at')
const catalog = await loadCatalogFromFiles({ indexUrl: new URL('../registry/catalog.json', import.meta.url) })
const metadata = await mapLimit(catalog.entries, 4, entry => commitMetadata(entry, catalog.registry.repositoryUrl))
for (let index = 0; index < catalog.entries.length; index += 1) {
  catalog.entries[index].source = { ...metadata[index], observedAt }
}
catalog.registry.updatedAt = observedAt
validateCatalog(catalog)
const split = splitCatalogDocument(catalog, { detailsPath: catalog.registry.detailsPath })
const serialized = `${JSON.stringify(split.bridge, null, 2)}\n`
const serializedIndex = `${JSON.stringify(split.index, null, 2)}\n`
await copyFile(catalogPath, backupPath)
await copyFile(catalogIndexPath, indexBackupPath)
if (!options.detailsBackup || !isAbsolute(options.detailsBackup) || !relative(root, resolve(options.detailsBackup)).startsWith('..')) {
  throw new Error('--details-backup must be an explicit absolute directory outside the repository')
}
await rm(options.detailsBackup, { recursive: true, force: true })
await cp(catalogDetailsPath, options.detailsBackup, { recursive: true, force: true })
try {
  await mkdir(catalogDetailsPath, { recursive: true })
  const expected = new Set()
  for (const detail of split.details) {
    const target = resolve(root, 'registry', detail.path)
    expected.add(target)
    const detailTemporary = `${target}.tmp-${process.pid}`
    await writeFile(detailTemporary, `${JSON.stringify(detail.entry, null, 2)}\n`, { flag: 'wx', mode: 0o644 })
    await rename(detailTemporary, target)
  }
  for (const name of await readdir(catalogDetailsPath)) {
    const target = resolve(catalogDetailsPath, name)
    if (!expected.has(target)) await rm(target, { recursive: true, force: true })
  }
  const indexTemporary = `${catalogIndexPath}.tmp-${process.pid}`
  await writeFile(indexTemporary, serializedIndex, { flag: 'wx', mode: 0o644 })
  await rename(indexTemporary, catalogIndexPath)
  const bridgeTemporary = `${catalogPath}.tmp-${process.pid}`
  await writeFile(bridgeTemporary, serialized, { flag: 'wx', mode: 0o644 })
  await rename(bridgeTemporary, catalogPath)
} catch (error) {
  await writeFile(catalogPath, original)
  await writeFile(catalogIndexPath, originalIndex)
  await rm(catalogDetailsPath, { recursive: true, force: true })
  await mkdir(resolve(catalogDetailsPath, '..'), { recursive: true })
  await cp(options.detailsBackup, catalogDetailsPath, { recursive: true, force: true })
  throw error
}
console.log(`CATALOG_SOURCE_METADATA_OK entries=${catalog.entries.length} details=${split.details.length} bridgeBefore=${originalSha} bridgeAfter=${sha256(Buffer.from(serialized))} indexBefore=${originalIndexSha} indexAfter=${sha256(Buffer.from(serializedIndex))}`)
