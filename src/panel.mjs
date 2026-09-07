import { buildMarketplaceSnapshot, paginateMarketplaceSnapshot, selectMarketplaceIndexEntries } from './catalog.mjs'
import { checkProfileHealth } from './health.mjs'
import { readProfileInventory, validateProfileName } from './inventory.mjs'
import { readMarketplaceProvenance } from './provenance.mjs'

export const ROUTE_PATH = '/api2/dsh-safe-plugin-manager/inventory'
export const MARKET_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/market'
export const HEALTH_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/health'
export const SOURCE_UPDATE_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/source-update'
export const DSH_VERSION_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/dsh-version'
export const PLAN_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/plan'
export const EXECUTE_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/execute'
export const RUNTIME_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/runtime'
export const RESTART_PLAN_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/restart/plan'
export const RESTART_EXECUTE_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/restart/execute'
export const GUARDIAN_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/guardian'
export const GUARDIAN_PLAN_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/guardian/plan'
export const GUARDIAN_EXECUTE_ROUTE_PATH = '/api2/dsh-safe-plugin-manager/guardian/execute'
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

function assertIntent(req, expected) {
  if (header(req, 'x-dsh-safe-intent') !== expected) {
    throw new HttpError(403, `missing ${expected} operation intent`)
  }
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

async function handleJsonRequest(req, res, callback, intent = null) {
  try {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { allow: 'POST' })
      return
    }
    assertSameOrigin(req)
    if (intent !== null) assertIntent(req, intent)
    const body = await readJsonBody(req)
    const value = await callback(body)
    sendJson(res, 200, { ok: true, value })
  } catch (error) {
    const known = typeof error?.code === 'string' && error.code !== ''
    const status = Number.isInteger(error?.status) ? error.status : known ? 409 : 500
    sendJson(res, status, {
      ok: false,
      error: {
        code: known ? error.code : status === 500 ? 'MANAGER_REQUEST_FAILED' : 'REQUEST_REJECTED',
        message: String(error?.message || error),
      },
    })
  }
}

export function handleMarketRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, async body => {
    const profile = validateProfileName(body.profile ?? options.defaultProfile ?? 'web')
    const inventory = await readProfileInventory({ dshHome: options.dshHome, profile })
    const view = body.view ?? 'market'
    // Load the small index first. With the split Catalog format only the
    // requested page's detail files are hydrated; v1 services remain fully
    // compatible for older fixtures and during a staged rollout.
    const catalogIndex = typeof options.catalogService.loadIndex === 'function'
      ? await options.catalogService.loadIndex({ force: body.refresh === true })
      : await options.catalogService.load({ force: body.refresh === true })
    const candidateRegistry = view === 'candidates'
      ? await (options.candidateService?.load({ force: body.refresh === true }) ?? Promise.resolve(null))
      : null
    const managedPackages = await readMarketplaceProvenance(options.dshHome, profile)
    const dshVersion = options.dshVersionService?.peek?.() ?? null
    if (catalogIndex.schemaVersion === 2 && view !== 'candidates') {
      const selection = selectMarketplaceIndexEntries(catalogIndex, {
        view, query: body.query, category: body.category, featuredOnly: body.featuredOnly === true,
        page: body.page, pageSize: body.pageSize, inventory,
      })
      try {
        const details = await options.catalogService.loadDetails(selection.entries.map(entry => entry.id), { index: catalogIndex })
        const snapshot = buildMarketplaceSnapshot({ ...catalogIndex, schemaVersion: 1, entries: details }, inventory, '', {
          managedPackages, candidateRegistry, dshVersion, catalogPackageNames: catalogIndex.entries.map(entry => entry.packageName),
        })
        const byId = new Map(snapshot.entries.map(entry => [entry.id, entry]))
        return {
          ...snapshot,
          entries: selection.entries.map(entry => byId.get(entry.id)).filter(Boolean),
          candidates: [],
          catalogPackageNames: catalogIndex.entries.map(entry => entry.packageName),
          filters: { categoryIds: selection.categoryIds, featuredOnly: selection.pagination.featuredOnly },
          pagination: selection.pagination,
        }
      } catch (error) {
        // A page must never combine a remote index with bundled detail files.
        // Ask the service for one complete atomic generation; it may return the
        // bundled bridge/index/details set after the remote detail failure.
        if (typeof options.catalogService.load !== 'function') throw error
        const fallback = await options.catalogService.load()
        if (fallback.source?.kind !== 'bundled') throw error
        const snapshot = buildMarketplaceSnapshot(fallback, inventory, '', {
          managedPackages, candidateRegistry, dshVersion,
        })
        return paginateMarketplaceSnapshot(snapshot, {
          view, query: body.query, category: body.category, featuredOnly: body.featuredOnly === true,
          page: body.page, pageSize: body.pageSize,
          catalogPackageNames: fallback.entries.map(entry => entry.packageName),
        })
      }
    }
    const catalog = catalogIndex.schemaVersion === 2
      ? { ...catalogIndex, schemaVersion: 1, entries: [] }
      : catalogIndex
    const snapshot = buildMarketplaceSnapshot(catalog, inventory, '', { managedPackages, candidateRegistry, dshVersion })
    return paginateMarketplaceSnapshot(snapshot, {
      view,
      query: body.query,
      category: body.category,
      featuredOnly: body.featuredOnly === true,
      includeRejected: view === 'candidates',
      page: body.page,
      pageSize: body.pageSize,
      catalogPackageNames: catalogIndex.entries?.map(entry => entry.packageName),
    })
  })
}

export function handleHealthRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, async body => {
    const profile = validateProfileName(body.profile ?? options.defaultProfile ?? 'web')
    const catalog = await options.catalogService.load({ force: body.refresh === true })
    return checkProfileHealth({
      dshHome: options.dshHome,
      profile,
      runner: options.runner,
      catalog,
      permissionDecisions: body.permissionDecisions,
    })
  })
}

export function handleSourceUpdateRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, async body => {
    const profile = validateProfileName(body.profile ?? options.defaultProfile ?? 'web')
    const inventory = await readProfileInventory({ dshHome: options.dshHome, profile })
    const catalog = await options.catalogService.load({ force: body.refresh === true })
    const entry = catalog.entries.find(item => item.id === body.pluginId) ?? null
    if (!entry) throw Object.assign(new Error('plugin is not present in the GitHub registry'), { code: 'NOT_IN_REGISTRY' })
    const installed = inventory.plugins.find(item => item.packageName === entry.packageName) ?? null
    return options.sourceUpdateService.inspect(entry, installed)
  })
}

export function handleDshVersionRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, body => options.dshVersionService.inspect({ force: body.refresh === true }))
}

export function handlePlanRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, body => options.operationService.createPlan(body), 'plan')
}

export function handleExecuteRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, body => options.operationService.execute(body), 'execute')
}

export function handleRuntimeRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, async body => {
    const profile = validateProfileName(body.profile ?? options.defaultProfile ?? 'web')
    if (!options.runtimeStatus || options.runtimeStatus.profile !== profile) {
      throw Object.assign(new Error('runtime status is unavailable for this Profile'), { code: 'RUNTIME_STATUS_UNAVAILABLE' })
    }
    return options.runtimeStatus
  })
}

export function handleRestartPlanRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, body => options.restartService.createPlan(body), 'restart-plan')
}

export function handleRestartExecuteRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, body => options.restartService.execute(body), 'restart-execute')
}

export function handleGuardianRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, () => options.guardianService.status())
}

export function handleGuardianPlanRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, body => options.guardianService.createInstallPlan(body), 'guardian-plan')
}

export function handleGuardianExecuteRequest(req, res, options = {}) {
  return handleJsonRequest(req, res, body => options.guardianService.executeInstall(body), 'guardian-execute')
}

export function registerInventoryRoute(webServer, options = {}) {
  return webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req, res) => handleInventoryRequest(req, res, options),
  })
}

export function registerManagerRoutes(webServer, options = {}) {
  const routes = [
    [ROUTE_PATH, (req, res) => handleInventoryRequest(req, res, options)],
    [MARKET_ROUTE_PATH, (req, res) => handleMarketRequest(req, res, options)],
    [HEALTH_ROUTE_PATH, (req, res) => handleHealthRequest(req, res, options)],
    [SOURCE_UPDATE_ROUTE_PATH, (req, res) => handleSourceUpdateRequest(req, res, options)],
    [DSH_VERSION_ROUTE_PATH, (req, res) => handleDshVersionRequest(req, res, options)],
    [PLAN_ROUTE_PATH, (req, res) => handlePlanRequest(req, res, options)],
    [EXECUTE_ROUTE_PATH, (req, res) => handleExecuteRequest(req, res, options)],
    [RUNTIME_ROUTE_PATH, (req, res) => handleRuntimeRequest(req, res, options)],
    [RESTART_PLAN_ROUTE_PATH, (req, res) => handleRestartPlanRequest(req, res, options)],
    [RESTART_EXECUTE_ROUTE_PATH, (req, res) => handleRestartExecuteRequest(req, res, options)],
    [GUARDIAN_ROUTE_PATH, (req, res) => handleGuardianRequest(req, res, options)],
    [GUARDIAN_PLAN_ROUTE_PATH, (req, res) => handleGuardianPlanRequest(req, res, options)],
    [GUARDIAN_EXECUTE_ROUTE_PATH, (req, res) => handleGuardianExecuteRequest(req, res, options)],
  ]
  const disposers = routes.map(([path, handler]) => webServer.register({ kind: 'exact', path, handler }))
  return () => {
    for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose()
  }
}
