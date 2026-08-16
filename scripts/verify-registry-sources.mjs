import { readFile } from 'node:fs/promises'
import { validateCatalog, verifyCatalogEntry } from '../src/catalog.mjs'

const path = new URL('../registry/catalog.json', import.meta.url)
const catalog = validateCatalog(JSON.parse(await readFile(path, 'utf8')))
for (const entry of catalog.entries.filter(item => item.status === 'approved')) {
  await verifyCatalogEntry(entry)
  process.stdout.write(`SOURCE_OK ${entry.packageName} ${entry.commit}\n`)
}
