import { readFile } from 'node:fs/promises'
import { assertCatalogLocalization } from '../src/catalog-localization.mjs'
import { assertLegacyCatalogCompatibility, validateCatalog } from '../src/catalog.mjs'

const path = new URL('../registry/catalog.json', import.meta.url)
const document = JSON.parse(await readFile(path, 'utf8'))
assertCatalogLocalization(document)
assertLegacyCatalogCompatibility(document)
const catalog = validateCatalog(document)
process.stdout.write(`REGISTRY_OK entries=${catalog.entries.length}\n`)
