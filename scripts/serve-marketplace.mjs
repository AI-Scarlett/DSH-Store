import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadModelSettings,
  saveModelSettings,
  testEndpointConnection,
  toPublicView,
  verifyPassword,
} from '../src/ai-model-settings.mjs'
import { loadCatalogIndex, recommendPlugins } from '../src/ai-recommend.mjs'

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

async function readJsonBody(request, limit = 100000) {
  let bytes = 0
  const chunks = []
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > limit) throw new Error('Request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  return JSON.parse(text)
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Content-Type, Authorization, x-admin-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  })
  response.end(JSON.stringify(data))
}

const server = createServer(async (request, response) => {
  let pathname = '/'
  try {
    pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
  } catch {}

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Content-Type, Authorization, x-admin-token',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    })
    response.end()
    return
  }

  // --- API Endpoints ---
  if (pathname === '/api/ai/recommend') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method Not Allowed' })
      return
    }
    try {
      const body = await readJsonBody(request)
      const query = (body.query || body.message || '').trim()
      if (!query) {
        sendJson(response, 400, { ok: false, error: '缺少查询需求' })
        return
      }
      const settings = await loadModelSettings()
      const catalog = await loadCatalogIndex()
      const result = await recommendPlugins({ query, settings, catalog })
      sendJson(response, 200, result)
    } catch (err) {
      sendJson(response, 500, { ok: false, error: err.message })
    }
    return
  }

  if (pathname === '/api/admin/model-settings') {
    const authHeader = request.headers['authorization'] || ''
    const tokenHeader = request.headers['x-admin-token'] || ''
    const providedPass = tokenHeader || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '')

    if (request.method === 'GET') {
      try {
        const settings = await loadModelSettings()
        const pub = toPublicView(settings)
        sendJson(response, 200, { ok: true, settings: pub })
      } catch (err) {
        sendJson(response, 500, { ok: false, error: err.message })
      }
      return
    }

    if (request.method === 'POST') {
      try {
        const settings = await loadModelSettings()
        if (settings.adminPasswordHash && !verifyPassword(providedPass, settings.adminPasswordHash)) {
          sendJson(response, 401, { ok: false, error: '管理员口令不正确或未提供' })
          return
        }

        const body = await readJsonBody(request)
        const updated = await saveModelSettings(body)
        sendJson(response, 200, { ok: true, settings: toPublicView(updated), message: '配置已安全加密保存' })
      } catch (err) {
        sendJson(response, 500, { ok: false, error: err.message })
      }
      return
    }

    sendJson(response, 405, { error: 'Method Not Allowed' })
    return
  }

  if (pathname === '/api/admin/model-settings/test') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method Not Allowed' })
      return
    }
    try {
      const authHeader = request.headers['authorization'] || ''
      const tokenHeader = request.headers['x-admin-token'] || ''
      const providedPass = tokenHeader || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '')
      const settings = await loadModelSettings()
      if (settings.adminPasswordHash && !verifyPassword(providedPass, settings.adminPasswordHash)) {
        sendJson(response, 401, { ok: false, error: '管理员口令不正确或未提供' })
        return
      }

      const body = await readJsonBody(request)
      const slot = body.slot === 'backup' ? 'backup' : 'primary'
      const endpoint = body.endpoint || settings[slot]
      let apiKey = body.apiKey || ''
      if (!apiKey && slot === 'backup' && body.usePrimaryKey) {
        apiKey = body.primaryApiKey || ''
      }
      const testRes = await testEndpointConnection({ endpoint, apiKey })
      sendJson(response, 200, testRes)
    } catch (err) {
      sendJson(response, 500, { ok: false, error: err.message })
    }
    return
  }

  // --- Static Files ---
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
