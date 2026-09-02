#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCatalogLocalization, localizeCatalogEntry } from '../src/catalog-localization.mjs'
import { compareCatalogEntries, loadCatalogFromFiles, splitCatalogDocument } from '../src/catalog.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const catalogPath = resolve(root, 'registry/catalog.json')
const args = process.argv.slice(2)
const value = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}
const write = args.includes('--write')
const expectedSha = value('--expected-catalog-sha')
const backupPath = value('--backup')
const detailsBackupPath = value('--details-backup')
const sha256 = data => createHash('sha256').update(data).digest('hex')
const detailsPath = resolve(root, 'registry/catalog/details')

const original = await readFile(catalogPath)
const originalSha = sha256(original)
const document = await loadCatalogFromFiles({ indexUrl: new URL('../registry/catalog.json', import.meta.url) })
document.entries = document.entries.map(entry => localizeCatalogEntry(entry, document.registry.categories)).sort(compareCatalogEntries)
assertCatalogLocalization(document)
const split = splitCatalogDocument(document, { detailsPath: document.registry.detailsPath })
const output = Buffer.from(`${JSON.stringify(split.index, null, 2)}\n`)

if (!write) {
  process.stdout.write(`CATALOG_LOCALIZATION_READY entries=${document.entries.length} changed=${sha256(output) !== originalSha}\n`)
  process.exit(0)
}
if (expectedSha !== originalSha) throw new Error('localization precondition hash mismatch')
if (!backupPath || !isAbsolute(backupPath) || !relative(root, resolve(backupPath)).startsWith('..')) {
  throw new Error('--backup must be an absolute path outside the repository')
}
if (!detailsBackupPath || !isAbsolute(detailsBackupPath) || !relative(root, resolve(detailsBackupPath)).startsWith('..')) {
  throw new Error('--details-backup must be an absolute path outside the repository')
}
await copyFile(catalogPath, backupPath)
await rm(detailsBackupPath, { recursive: true, force: true })
await cp(detailsPath, detailsBackupPath, { recursive: true, force: true })
try {
  await mkdir(detailsPath, { recursive: true })
  const expected = new Set()
  for (const detail of split.details) {
    const target = resolve(root, 'registry', detail.path)
    expected.add(target)
    const temporary = `${target}.tmp-${process.pid}`
    await writeFile(temporary, `${JSON.stringify(detail.entry, null, 2)}\n`, { flag: 'wx', mode: 0o644 })
    await rename(temporary, target)
  }
  for (const name of await readdir(detailsPath)) {
    const target = resolve(detailsPath, name)
    if (!expected.has(target)) await rm(target, { recursive: true, force: true })
  }
  const temporary = `${catalogPath}.tmp-${process.pid}`
  await writeFile(temporary, output, { flag: 'wx', mode: 0o644 })
  await rename(temporary, catalogPath)
} catch (error) {
  await writeFile(catalogPath, original)
  await rm(detailsPath, { recursive: true, force: true })
  await mkdir(resolve(detailsPath, '..'), { recursive: true })
  await cp(detailsBackupPath, detailsPath, { recursive: true, force: true })
  throw error
}
process.stdout.write(`CATALOG_LOCALIZATION_OK entries=${document.entries.length} details=${split.details.length} before=${originalSha} after=${sha256(output)} backup=${backupPath}\n`)
