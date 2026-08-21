const host = process.env.INDEXNOW_HOST || 'dsh.store'
const key = 'f54dc5a289b1a7c4b8245b705b9988fb'
const keyLocation = `https://${host}/${key}.txt`
const defaultUrls = [
  `https://${host}/`,
  `https://${host}/plugins/`,
  `https://${host}/build/`,
  `https://${host}/faq/`,
  `https://${host}/about/`,
]

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
