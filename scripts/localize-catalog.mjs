#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCatalogLocalization, localizeCatalogEntry } from '../src/catalog-localization.mjs'
import { compareCatalogEntries, validateCatalog } from '../src/catalog.mjs'

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
const sha256 = data => createHash('sha256').update(data).digest('hex')

const original = await readFile(catalogPath)
const originalSha = sha256(original)
const document = JSON.parse(original.toString('utf8'))
validateCatalog(document)
document.entries = document.entries.map(entry => localizeCatalogEntry(entry, document.registry.categories)).sort(compareCatalogEntries)
assertCatalogLocalization(document)
validateCatalog(document)
const output = Buffer.from(`${JSON.stringify(document, null, 2)}\n`)

if (!write) {
  process.stdout.write(`CATALOG_LOCALIZATION_READY entries=${document.entries.length} changed=${sha256(output) !== originalSha}\n`)
  process.exit(0)
}
if (expectedSha !== originalSha) throw new Error('localization precondition hash mismatch')
if (!backupPath || !isAbsolute(backupPath) || !relative(root, resolve(backupPath)).startsWith('..')) {
  throw new Error('--backup must be an absolute path outside the repository')
}
await copyFile(catalogPath, backupPath)
const temporary = `${catalogPath}.tmp-${process.pid}`
try {
  await writeFile(temporary, output, { flag: 'wx', mode: 0o644 })
  await rename(temporary, catalogPath)
} catch (error) {
  await writeFile(catalogPath, original)
  throw error
}
process.stdout.write(`CATALOG_LOCALIZATION_OK entries=${document.entries.length} before=${originalSha} after=${sha256(output)} backup=${backupPath}\n`)
