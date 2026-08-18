import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const requestedPort = Number.parseInt(process.env.DSH_MARKETPLACE_PORT || '4173', 10)
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 4173
const host = '127.0.0.1'
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

function safePath(urlPath) {
  let decoded
  try { decoded = decodeURIComponent(urlPath.split('?')[0]) } catch { return null }
  const relative = decoded === '/' ? 'marketplace/index.html' : decoded.replace(/^\/+/, '')
  const target = resolve(root, relative)
  return target === root || target.startsWith(`${root}${sep}`) ? target : null
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' })
    response.end('Method Not Allowed')
    return
  }

  let target = safePath(request.url || '/')
  if (!target) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Bad Request')
    return
  }

  try {
    const info = await stat(target)
    if (info.isDirectory()) target = resolve(target, 'index.html')
    const fileInfo = await stat(target)
    if (!fileInfo.isFile()) throw new Error('Not a file')
    response.writeHead(200, {
      'content-length': fileInfo.size,
      'content-type': mimeTypes.get(extname(target).toLowerCase()) || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    if (request.method === 'HEAD') response.end()
    else createReadStream(target).pipe(response)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not Found')
  }
})

server.listen(port, host, () => {
  console.log(`DSH plugin marketplace: http://${host}:${port}/marketplace/`)
  console.log('Press Ctrl+C to stop.')
})
