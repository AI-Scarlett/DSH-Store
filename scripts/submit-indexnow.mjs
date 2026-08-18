import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const host = 'dsh.store'
const key = 'f54dc5a289b1a7c4b8245b705b9988fb'
const keyLocation = `https://${host}/${key}.txt`
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(await readFile(resolve(projectRoot, 'registry/catalog.json'), 'utf8'))
if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.entries)) {
  throw new Error('IndexNow requires a supported registry/catalog.json')
}

const primaryUrls = [
  `https://${host}/`,
  `https://${host}/plugins/`,
  `https://${host}/build/`,
  `https://${host}/faq/`,
  `https://${host}/about/`,
  `https://${host}/en/`,
  `https://${host}/en/plugins/`,
  `https://${host}/en/build/`,
  `https://${host}/en/faq/`,
  `https://${host}/en/about/`,
]
const pluginUrls = catalog.entries
  .filter(entry => entry.status !== 'unlisted')
  .map(entry => {
    const id = String(entry.id || '')
    if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(id)) throw new Error(`IndexNow entry id is unsafe: ${id}`)
    return `https://${host}/plugins/${id}/`
  })
const defaultUrls = [...primaryUrls, ...pluginUrls]

const requestedUrls = process.argv.slice(2)
const urlList = requestedUrls.length ? requestedUrls : defaultUrls

for (const value of urlList) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== host) {
    throw new Error(`IndexNow URL must use the canonical ${host} HTTPS host: ${value}`)
  }
}

const keyResponse = await fetch(keyLocation, { cache: 'no-store' })
if (!keyResponse.ok || (await keyResponse.text()).trim() !== key) {
  throw new Error(`IndexNow key verification failed: HTTP ${keyResponse.status}`)
}

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation, urlList }),
})

if (![200, 202].includes(response.status)) {
  throw new Error(`IndexNow submission failed closed: HTTP ${response.status}`)
}

console.log(`INDEXNOW_ACCEPTED status=${response.status} urls=${urlList.length}`)
