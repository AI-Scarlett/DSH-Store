import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createNativeMarketIndex } from '../src/native-market-index.mjs'
import { loadCatalogFromFiles } from '../src/catalog.mjs'

// Execute only the pinned official format validator, never any listed plugin.
const { parseMarketIndex, marketInstallTarget } = await import(pathToFileURL(resolve(process.argv[2])).href)
const catalog = await loadCatalogFromFiles()
const input = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : createNativeMarketIndex(catalog)
const index = parseMarketIndex(input, 'https://dsh.store/plugin-market.json')
for (const plugin of index.plugins) {
  for (const version of plugin.versions) {
    const target = marketInstallTarget(plugin.name, version)
    if (!target.spec.includes(version.source.commit)) throw new Error('Official install target lost the fixed Commit')
  }
}
console.log(`OFFICIAL_NATIVE_MARKET_OK plugins=${index.plugins.length}`)
