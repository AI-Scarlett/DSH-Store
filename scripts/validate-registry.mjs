import { assertCatalogLocalization } from '../src/catalog-localization.mjs'
import { assertLegacyCatalogCompatibility, loadCatalogFromFiles } from '../src/catalog.mjs'

const catalog = await loadCatalogFromFiles()
assertCatalogLocalization(catalog)
assertLegacyCatalogCompatibility(catalog)
process.stdout.write(`REGISTRY_OK entries=${catalog.entries.length}\n`)
