import { readProfileInventory, validateProfileName } from './inventory.mjs'

export const ROUTE_PATH = '/api2/dsh-safe-plugin-manager/inventory'
const MAX_BODY_BYTES = 16 * 1024

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function header(req, name) {
  const value = req?.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

function assertSameOrigin(req) {
  const host = header(req, 'host')
  const origin = header(req, 'origin')
  if (typeof host !== 'string' || host === '') throw new HttpError(400, 'missing Host header')
  if (typeof origin !== 'string' || origin === '') return
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    throw new HttpError(403, 'invalid Origin header')
  }
  if (originHost !== host) throw new HttpError(403, 'cross-origin request denied')
}

async function readJsonBody(req) {
  const contentType = header(req, 'content-type')
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'content-type must be application/json')
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += value.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large')
    chunks.push(value)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('body must be an object')
    return body
  } catch (error) {
    throw new HttpError(400, `invalid JSON body: ${String(error?.message || error)}`)
  }
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  res.end(JSON.stringify(payload))
}

export async function handleInventoryRequest(req, res, options = {}) {
  try {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { allow: 'POST' })
      return
    }
    assertSameOrigin(req)
    const body = await readJsonBody(req)
    const profile = validateProfileName(body.profile ?? options.defaultProfile ?? 'web')
    const value = await readProfileInventory({ dshHome: options.dshHome, profile })
    sendJson(res, 200, { ok: true, value })
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500
    const code = status === 500 ? 'INVENTORY_FAILED' : 'REQUEST_REJECTED'
    sendJson(res, status, { ok: false, error: { code, message: String(error?.message || error) } })
  }
}

export function registerInventoryRoute(webServer, options = {}) {
  return webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req, res) => handleInventoryRequest(req, res, options),
  })
}

