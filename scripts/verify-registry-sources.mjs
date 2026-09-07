import { loadCatalogFromFiles, verifyCatalogEntry } from '../src/catalog.mjs'

const catalog = await loadCatalogFromFiles()
for (const entry of catalog.entries.filter(item => item.status === 'approved')) {
  await verifyCatalogEntry(entry)
  process.stdout.write(`SOURCE_OK ${entry.packageName} ${entry.commit}\n`)
}
