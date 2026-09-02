import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const requestedPort = Number.parseInt(process.env.DSH_MARKETPLACE_PORT || '4173', 10)
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 4173
const host = '127.0.0.1'
const marketplaceRoot = resolve(root, 'marketplace')
const marketplaceIndex = resolve(marketplaceRoot, 'index.html')
const registryRoot = resolve(root, 'registry')
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
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
])

function safePath(urlPath) {
  let pathname
  try { pathname = new URL(urlPath, 'http://127.0.0.1').pathname } catch { return null }
  if (pathname === '/' || pathname === '/marketplace' || pathname === '/marketplace/') return marketplaceIndex
  if (pathname.startsWith('/registry/')) {
    const target = resolve(registryRoot, pathname.slice('/registry/'.length))
    const scoped = relative(registryRoot, target)
    if (!scoped || scoped.startsWith('..') || isAbsolute(scoped)) return null
    return target
  }
  if (!pathname.startsWith('/marketplace/')) return null
  const requested = pathname.endsWith('/') ? `${pathname}index.html` : pathname
  const target = resolve(marketplaceRoot, requested.slice('/marketplace/'.length))
  const scoped = relative(marketplaceRoot, target)
  if (!scoped || scoped.startsWith('..') || isAbsolute(scoped)) return null
  return target
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' })
    response.end('Method Not Allowed')
    return
  }

  const target = safePath(request.url || '/')
  if (!target) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Bad Request')
    return
  }

  try {
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
