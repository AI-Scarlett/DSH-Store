import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
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
import { MAX_RANKING_SNAPSHOT_BYTES, rankingCurationChoices, validateRankingSnapshot } from '../marketplace/rankings/model.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const requestedPort = Number.parseInt(process.env.DSH_MARKETPLACE_PORT || '4173', 10)
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 4173
const host = '127.0.0.1'
const marketplaceRoot = resolve(root, 'marketplace')
const marketplaceIndex = resolve(marketplaceRoot, 'index.html')
const registryRoot = resolve(root, 'registry')
const rankingCurationPath = resolve(process.env.DSH_RANKING_CURATION_PATH || '/var/lib/dsh-store/ranking-curation.json')
const rankingReleasePath = resolve(process.env.DSH_STORE_RELEASE_DIR || '/opt/dsh-store/current')
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

class RankingCurationError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

const RANKING_BOARDS = ['recommended', 'essential']
const ownKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...expected].sort().join(',')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function readReleaseFile(releaseRoot, relativePath, maxBytes) {
  if (typeof relativePath !== 'string' || relativePath.startsWith('/') || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe release path')
  }
  let target = releaseRoot
  const parts = relativePath.split('/')
  for (let index = 0; index < parts.length; index++) {
    target = join(target, parts[index])
    const info = await lstat(target)
    if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory())) throw new Error('Unsafe release artifact')
    if (index === parts.length - 1 && (!info.isFile() || info.size > maxBytes)) throw new Error('Invalid release artifact size')
  }
  return readFile(target)
}

async function loadVerifiedRankingSnapshot() {
  const releaseRoot = await realpath(rankingReleasePath)
  const manifestBytes = await readReleaseFile(releaseRoot, 'release-manifest.json', 4 * 1024 * 1024)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (manifest?.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit || '')
    || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw new Error('Invalid storefront release manifest')

  const dataPath = 'marketplace/rankings/data.json'
  const htmlPath = 'marketplace/rankings/index.html'
  const dataRecord = manifest.files[dataPath]
  const htmlRecord = manifest.files[htmlPath]
  for (const record of [dataRecord, htmlRecord]) {
    if (!record || !/^[a-f0-9]{64}$/.test(record.sha256 || '') || !Number.isSafeInteger(record.size) || record.size < 0) {
      throw new Error('Ranking artifacts are missing from the release manifest')
    }
  }
  if (dataRecord.size > MAX_RANKING_SNAPSHOT_BYTES || htmlRecord.size > 512 * 1024) throw new Error('Ranking artifact exceeds its bound')
  const [dataBytes, htmlBytes] = await Promise.all([
    readReleaseFile(releaseRoot, dataPath, MAX_RANKING_SNAPSHOT_BYTES),
    readReleaseFile(releaseRoot, htmlPath, 512 * 1024),
  ])
  if (dataBytes.length !== dataRecord.size || sha256(dataBytes) !== dataRecord.sha256
    || htmlBytes.length !== htmlRecord.size || sha256(htmlBytes) !== htmlRecord.sha256) throw new Error('Ranking artifact hash mismatch')
  const html = htmlBytes.toString('utf8')
  const pinnedDigest = html.match(/<meta\s+name=["']dsh-rankings-sha256["']\s+content=["']([a-f0-9]{64})["']/i)?.[1]
  if (!pinnedDigest || pinnedDigest !== dataRecord.sha256) throw new Error('Ranking snapshot digest mismatch')
  const snapshot = validateRankingSnapshot(JSON.parse(dataBytes.toString('utf8')))
  if (snapshot.sourceCommit !== manifest.sourceCommit) throw new Error('Ranking source Commit mismatch')
  return snapshot
}

function validateStoredCuration(value) {
  if (!ownKeys(value, ['schemaVersion', 'revision', 'updatedAt', 'sourceCommit', 'boards'])
    || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
    || !/^[a-f0-9]{40}$/.test(value.sourceCommit || '') || !ownKeys(value.boards, RANKING_BOARDS)) throw new Error('Invalid ranking curation state')
  for (const type of RANKING_BOARDS) {
    const board = value.boards[type]
    if (!ownKeys(board, ['mode', 'ids']) || !['auto', 'manual'].includes(board.mode)
      || !Array.isArray(board.ids) || board.ids.length > 30
      || board.ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id))
      || new Set(board.ids).size !== board.ids.length || (board.mode === 'auto' && board.ids.length !== 0)) {
      throw new Error('Invalid ranking curation board')
    }
  }
  return value
}

async function ensureRankingCurationDirectory() {
  const directory = dirname(rankingCurationPath)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
    || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Ranking curation directory is not private')
  return directory
}

async function readRankingCuration() {
  await ensureRankingCurationDirectory()
  let info
  try { info = await lstat(rankingCurationPath) } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, revision: 0, updatedAt: null, sourceCommit: null,
      boards: { recommended: { mode: 'auto', ids: [] }, essential: { mode: 'auto', ids: [] } } }
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
    || (typeof process.getuid === 'function' && info.uid !== process.getuid()) || info.size > 16 * 1024) throw new Error('Ranking curation state is not a private regular file')
  return validateStoredCuration(JSON.parse((await readFile(rankingCurationPath, 'utf8'))))
}

async function writeRankingFileAtomic(path, bytes) {
  const directory = dirname(path)
  const tempPath = join(directory, `.${path.split('/').at(-1)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`)
  let handle
  try {
    handle = await open(tempPath, 'wx', 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(tempPath, path)
    const directoryHandle = await open(directory, 'r')
    try { await directoryHandle.sync() } finally { await directoryHandle.close() }
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await unlink(tempPath).catch(() => {})
    throw error
  }
}

async function withRankingCurationLock(callback) {
  await ensureRankingCurationDirectory()
  const lockPath = `${rankingCurationPath}.lock`
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) } catch (error) {
    if (error.code === 'EEXIST') throw new RankingCurationError(409, '榜单配置正在被其他请求保存，请稍后重试')
    throw error
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    await lock.sync()
    return await callback()
  } finally {
    await lock.close().catch(() => {})
    await unlink(lockPath).catch(() => {})
  }
}

function curationChoicesView(snapshot, type) {
  const choices = rankingCurationChoices(snapshot, type)
  return {
    minimumManualEntries: choices.minimumManualEntries,
    officialSlots: choices.officialSlots,
    entries: choices.eligible.map((entry, index) => ({
      id: entry.id,
      nameZh: entry.nameZh,
      nameEn: entry.nameEn,
      repositoryUrl: entry.repositoryUrl,
      stars: Number.isSafeInteger(entry.stars) ? entry.stars : null,
      listingStatus: entry.listingStatus,
      reviewStatus: entry.reviewStatus,
      officialToolPick: Boolean(entry.officialToolPick),
      rank: index + 1,
    })),
  }
}

function adminCurationView(snapshot, stored) {
  return {
    ok: true,
    sourceCommit: snapshot.sourceCommit,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
    stale: Boolean(stored.sourceCommit && stored.sourceCommit !== snapshot.sourceCommit),
    boards: stored.boards,
    choices: Object.fromEntries(RANKING_BOARDS.map(type => [type, curationChoicesView(snapshot, type)])),
  }
}

function publicCurationView(snapshot, stored) {
  const sameSource = stored.sourceCommit === snapshot.sourceCommit
  const boards = Object.fromEntries(RANKING_BOARDS.map(type => {
    const board = sameSource ? stored.boards[type] : { mode: 'auto', ids: [] }
    const choices = rankingCurationChoices(snapshot, type)
    const selectableIds = new Set(choices.selectable.map(entry => entry.id))
    const valid = board.mode === 'auto' || (board.mode === 'manual' && board.ids.length >= choices.minimumManualEntries
      && board.ids.every(id => selectableIds.has(id)))
    return [type, valid ? board : { mode: 'auto', ids: [] }]
  }))
  return { ok: true, sourceCommit: snapshot.sourceCommit, boards }
}

function normalizeCurationSubmission(body, snapshot) {
  if (!ownKeys(body, ['revision', 'sourceCommit', 'boards']) || !Number.isSafeInteger(body.revision) || body.revision < 0
    || !ownKeys(body.boards, RANKING_BOARDS)) {
    throw new RankingCurationError(400, '榜单配置格式无效，请检查后重试')
  }
  if (body.sourceCommit !== snapshot.sourceCommit) throw new RankingCurationError(409, '榜单快照已更新，请重新读取后再保存')
  const boards = {}
  for (const type of RANKING_BOARDS) {
    const board = body.boards[type]
    if (!ownKeys(board, ['mode', 'ids']) || !['auto', 'manual'].includes(board.mode) || !Array.isArray(board.ids)
      || board.ids.length > 30 || board.ids.some(id => typeof id !== 'string') || new Set(board.ids).size !== board.ids.length) {
      throw new RankingCurationError(400, `${type} 榜单配置格式无效`)
    }
    if (board.mode === 'auto') {
      if (board.ids.length) throw new RankingCurationError(400, `${type} 自动模式不接受手动条目`)
      boards[type] = { mode: 'auto', ids: [] }
      continue
    }
    const choices = rankingCurationChoices(snapshot, type)
    const eligibleIds = new Set(choices.selectable.map(entry => entry.id))
    if (board.ids.some(id => !eligibleIds.has(id))) throw new RankingCurationError(400, `${type} 榜单包含当前不可选或受保护的条目`)
    if (board.ids.length < choices.minimumManualEntries) throw new RankingCurationError(400, `${type} 榜单至少需要保留 ${choices.minimumManualEntries} 个普通条目，以保持官方展示位不变`)
    boards[type] = { mode: 'manual', ids: [...board.ids] }
  }
  return boards
}

async function saveRankingCuration(body, snapshot) {
  return withRankingCurationLock(async () => {
    const previous = await readRankingCuration()
    if (body?.revision !== previous.revision) throw new RankingCurationError(409, '榜单配置已被其他管理员更新，请重新读取后再保存')
    const boards = normalizeCurationSubmission(body, snapshot)
    const next = validateStoredCuration({
      schemaVersion: 1,
      revision: previous.revision + 1,
      updatedAt: new Date().toISOString(),
      sourceCommit: snapshot.sourceCommit,
      boards,
    })
    const nextBytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`)
    if (previous.revision > 0) {
      const previousBytes = await readFile(rankingCurationPath)
      await writeRankingFileAtomic(`${rankingCurationPath}.bak`, previousBytes)
    }
    await writeRankingFileAtomic(rankingCurationPath, nextBytes)
    return next
  })
}

const server = createServer(async (request, response) => {
  let pathname = '/'
  let search = ''
  try {
    const parsed = new URL(request.url || '/', 'http://127.0.0.1')
    pathname = parsed.pathname
    search = parsed.search || ''
  } catch {}

  if (/(%60|`)+$/.test(pathname)) {
    const cleaned = pathname.replace(/(%60|`)+$/, '') || '/'
    response.writeHead(302, { location: `${cleaned}${search}`, 'cache-control': 'no-store' })
    response.end()
    return
  }

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

  if (pathname === '/api/rankings/curation') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method Not Allowed' })
      return
    }
    try {
      const snapshot = await loadVerifiedRankingSnapshot()
      const stored = await readRankingCuration()
      sendJson(response, 200, publicCurationView(snapshot, stored))
    } catch {
      sendJson(response, 503, { ok: false, error: '榜单配置暂时不可用' })
    }
    return
  }

  if (pathname === '/api/admin/rankings') {
    let settings
    try { settings = await loadModelSettings() } catch {
      sendJson(response, 503, { ok: false, error: '管理服务暂时不可用' })
      return
    }
    if (!await authenticateAdmin(request, settings)) {
      sendJson(response, 401, { ok: false, error: '管理员未登录或登录已过期，请先登录' })
      return
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method Not Allowed' })
      return
    }
    try {
      const snapshot = await loadVerifiedRankingSnapshot()
      if (request.method === 'GET') {
        const stored = await readRankingCuration()
        sendJson(response, 200, adminCurationView(snapshot, stored))
        return
      }
      const body = await readJsonBody(request, 16 * 1024)
      const updated = await saveRankingCuration(body, snapshot)
      sendJson(response, 200, adminCurationView(snapshot, updated))
    } catch (error) {
      const statusCode = error instanceof RankingCurationError ? error.statusCode : 503
      const message = error instanceof RankingCurationError ? error.message : '榜单快照或服务器配置校验失败，无法保存'
      sendJson(response, statusCode, { ok: false, error: message })
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
