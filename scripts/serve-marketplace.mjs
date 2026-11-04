import { timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  generateSessionToken,
  getEncryptionKey,
  loadModelSettings,
  saveModelSettings,
  testEndpointConnection,
  toPublicView,
  verifyPassword,
  verifySessionToken,
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
  let subPath = pathname
  if (pathname.startsWith('/marketplace/')) {
    subPath = subPath.slice('/marketplace/'.length)
  } else if (subPath.startsWith('/')) {
    subPath = subPath.slice(1)
  }
  const requested = subPath.endsWith('/') ? `${subPath}index.html` : subPath
  const target = resolve(marketplaceRoot, requested)
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

async function authenticateAdmin(request, settings) {
  const authHeader = request.headers['authorization'] || ''
  const tokenHeader = request.headers['x-admin-token'] || ''
  const token = tokenHeader || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '')
  if (!token) return false

  try {
    const sessionSecret = await getEncryptionKey()
    const session = verifySessionToken(token, sessionSecret)
    if (session && session.username === (settings.adminUsername || DEFAULT_ADMIN_USERNAME)) {
      return true
    }
  } catch {}

  if (settings.adminPasswordHash && verifyPassword(token, settings.adminPasswordHash)) {
    return true
  }
  return false
}

const server = createServer(async (request, response) => {
  let pathname = '/'
  let search = ''
  try {
    const parsed = new URL(request.url || '/', 'http://127.0.0.1')
    pathname = parsed.pathname
    search = parsed.search || ''
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

  if (pathname === '/api/ai/public-config') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method Not Allowed' })
      return
    }
    try {
      const settings = await loadModelSettings()
      sendJson(response, 200, {
        ok: true,
        promptPlaceholder: settings.promptPlaceholder,
        promptSuggestions: settings.promptSuggestions,
      })
    } catch (err) {
      sendJson(response, 500, { ok: false, error: err.message })
    }
    return
  }

  if (pathname === '/api/admin/login') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method Not Allowed' })
      return
    }
    try {
      const body = await readJsonBody(request)
      const username = (body.username || '').trim()
      const password = (body.password || '').trim()
      const settings = await loadModelSettings()
      const expectedUser = settings.adminUsername || DEFAULT_ADMIN_USERNAME
      const expectedHash = settings.adminPasswordHash

      const userMatches = username.length === expectedUser.length && timingSafeEqual(Buffer.from(username), Buffer.from(expectedUser))
      const passMatches = verifyPassword(password, expectedHash)

      if (!userMatches || !passMatches) {
        sendJson(response, 401, { ok: false, error: '管理员账号或密码不正确' })
        return
      }

      const sessionSecret = await getEncryptionKey()
      const token = generateSessionToken(expectedUser, sessionSecret)
      sendJson(response, 200, { ok: true, token, username: expectedUser })
    } catch (err) {
      sendJson(response, 500, { ok: false, error: err.message })
    }
    return
  }

  if (pathname === '/api/admin/model-settings') {
    const settings = await loadModelSettings()
    const isAuthed = await authenticateAdmin(request, settings)
    if (!isAuthed) {
      sendJson(response, 401, { ok: false, error: '管理员未登录或登录已过期，请先登录' })
      return
    }

    if (request.method === 'GET') {
      try {
        const pub = toPublicView(settings)
        sendJson(response, 200, { ok: true, settings: pub })
      } catch (err) {
        sendJson(response, 500, { ok: false, error: err.message })
      }
      return
    }

    if (request.method === 'POST') {
      try {
        const body = await readJsonBody(request)
        const updated = await saveModelSettings(body)
        const sessionSecret = await getEncryptionKey()
        const refreshedToken = generateSessionToken(updated.adminUsername || DEFAULT_ADMIN_USERNAME, sessionSecret)
        sendJson(response, 200, {
          ok: true,
          settings: toPublicView(updated),
          token: refreshedToken,
          message: '配置已安全加密保存',
        })
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
      const settings = await loadModelSettings()
      const isAuthed = await authenticateAdmin(request, settings)
      if (!isAuthed) {
        sendJson(response, 401, { ok: false, error: '管理员未登录或登录已过期，请先登录' })
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

  // Route convenience redirects:
  if (pathname === '/' || pathname === '/marketplace') {
    response.writeHead(302, { location: `/marketplace/${search}`, 'cache-control': 'no-store' })
    response.end()
    return
  }
  if (pathname === '/admin' || pathname === '/admin/' || pathname === '/marketplace/admin') {
    response.writeHead(302, { location: `/marketplace/admin/${search}`, 'cache-control': 'no-store' })
    response.end()
    return
  }

  let target = safePath(request.url || '/')
  if (!target) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Bad Request')
    return
  }

  try {
    let fileInfo = await stat(target)
    if (fileInfo.isDirectory()) {
      if (!pathname.endsWith('/')) {
        response.writeHead(302, { location: `${pathname}/${search}`, 'cache-control': 'no-store' })
        response.end()
        return
      }
      const indexTarget = resolve(target, 'index.html')
      fileInfo = await stat(indexTarget)
      if (!fileInfo.isFile()) throw new Error('Not a file')
      target = indexTarget
    } else if (!fileInfo.isFile()) {
      throw new Error('Not a file')
    }
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
  console.log(`DSH model admin portal: http://${host}:${port}/marketplace/admin/`)
  console.log('Press Ctrl+C to stop.')
})
