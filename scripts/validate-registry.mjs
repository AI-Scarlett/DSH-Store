import { readFile } from 'node:fs/promises'
import { validateCatalog } from '../src/catalog.mjs'

const path = new URL('../registry/catalog.json', import.meta.url)
const catalog = validateCatalog(JSON.parse(await readFile(path, 'utf8')))
process.stdout.write(`REGISTRY_OK entries=${catalog.entries.length}\n`)
