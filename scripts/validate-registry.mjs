import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCatalogLocalization } from '../src/catalog-localization.mjs'
import {
  assertLegacyCatalogCompatibility, loadCatalogFromFiles, MAX_CATALOG_DETAIL_RESPONSE_BYTES,
  MAX_CATALOG_INDEX_RESPONSE_BYTES, validateCatalog, validateCatalogBridgeIndex,
} from '../src/catalog.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const bridgeBytes = await readFile(resolve(root, 'registry/catalog.json'))
const indexBytes = await readFile(resolve(root, 'registry/catalog-index.json'))
if (bridgeBytes.length >= MAX_CATALOG_INDEX_RESPONSE_BYTES) throw new Error('legacy Catalog bridge exceeds the historical 2 MiB ceiling')
if (indexBytes.length >= MAX_CATALOG_INDEX_RESPONSE_BYTES) throw new Error('Catalog index exceeds the 2 MiB ceiling')
const bridge = validateCatalog(JSON.parse(bridgeBytes))
const index = validateCatalogBridgeIndex(bridge, JSON.parse(indexBytes), indexBytes)
const detailDirectory = resolve(root, 'registry/catalog/details')
const detailNames = (await readdir(detailDirectory)).filter(name => name.endsWith('.json'))
if (detailNames.length !== index.entries.length) throw new Error('Catalog detail file count does not match the index')
for (const name of detailNames) {
  const bytes = await readFile(resolve(detailDirectory, name))
  if (bytes.length > MAX_CATALOG_DETAIL_RESPONSE_BYTES) throw new Error(`Catalog detail exceeds the byte ceiling: ${name}`)
}
const catalog = await loadCatalogFromFiles()
assertCatalogLocalization(catalog)
assertLegacyCatalogCompatibility(catalog)
process.stdout.write(`REGISTRY_OK entries=${catalog.entries.length} bridgeBytes=${bridgeBytes.length} indexBytes=${indexBytes.length} details=${detailNames.length}\n`)
