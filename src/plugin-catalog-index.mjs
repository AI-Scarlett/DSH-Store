import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeCatalogEntry } from './ai-recommend.mjs'
import { searchCatalogCandidates, searchTokens, tokenize } from '../marketplace/lib/recommendation-search.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultSourceRoots = ['/opt/dsh-store-cn/current', '/opt/dsh-store/current']
const workerPath = resolve(projectRoot, 'scripts/plugin-catalog-sqlite-worker.py')
const permittedSiteHosts = new Set(['dsh.store', 'dsh-store.cn'])

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fullCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
}

function safeString(value, maximum = 4096) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function getCatalogEntries(data) {
  if (!data || !Array.isArray(data.entries) || data.entries.length === 0) {
    throw new Error('catalog-empty-or-invalid')
  }
  const ids = new Set()
  const entries = data.entries.map(normalizeCatalogEntry)
  for (const entry of entries) {
    const id = safeString(entry.id || entry.packageName || entry.name, 256)
    const packageName = safeString(entry.packageName || entry.name || id, 512)
    if (!id || !packageName || ids.has(id)) throw new Error('catalog-entry-identity-invalid')
    ids.add(id)
  }
  return entries
}

async function readRegularFile(root, relativePath) {
  const target = resolve(root, relativePath)
  const scoped = relative(root, target)
  if (!scoped || scoped.startsWith('..') || isAbsolute(scoped)) throw new Error('catalog-path-invalid')
  const metadata = await lstat(target)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('catalog-file-type-invalid')
  return readFile(target)
}

export async function loadVerifiedCatalogRelease(sourcePath) {
  const sourceRoot = resolve(sourcePath)
  const releaseRoot = await realpath(sourceRoot)
  const releasesDirectory = (await realpath(resolve(dirname(sourceRoot), 'releases'))) + sep
  if (!releaseRoot.startsWith(releasesDirectory)) throw new Error('catalog-release-path-invalid')

  const [manifestBytes, buildBytes, catalogBytes] = await Promise.all([
    readRegularFile(releaseRoot, 'release-manifest.json'),
    readRegularFile(releaseRoot, 'build-manifest.json'),
    readRegularFile(releaseRoot, 'registry/catalog.json'),
  ])
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const build = JSON.parse(buildBytes.toString('utf8'))
  const catalogFile = manifest?.files?.['registry/catalog.json']
  const buildFile = manifest?.files?.['build-manifest.json']
  const sourceCommit = manifest?.sourceCommit
  const generatedAt = manifest?.generatedAt
  const generatedTime = Date.parse(generatedAt)
  const siteOrigin = new URL(build?.siteOrigin)

  if (manifest?.schemaVersion !== 1 || !fullCommit(sourceCommit)
      || build?.schemaVersion !== 1 || build?.sourceCommit !== sourceCommit
      || !Number.isFinite(generatedTime) || Date.parse(build?.generatedAt) !== generatedTime
      || siteOrigin.protocol !== 'https:' || !permittedSiteHosts.has(siteOrigin.hostname)
      || (siteOrigin.pathname !== '/' && siteOrigin.pathname !== '')
      || !catalogFile || !/^[a-f0-9]{64}$/.test(catalogFile.sha256)
      || catalogFile.size !== catalogBytes.byteLength || sha256(catalogBytes) !== catalogFile.sha256
      || !buildFile || !/^[a-f0-9]{64}$/.test(buildFile.sha256)
      || buildFile.size !== buildBytes.byteLength || sha256(buildBytes) !== buildFile.sha256) {
    throw new Error('catalog-release-integrity-invalid')
  }

  const entries = getCatalogEntries(JSON.parse(catalogBytes.toString('utf8')))
  return {
    entries,
    sourceCommit,
    catalogSha256: catalogFile.sha256,
    generatedAt,
    sourceKind: 'verified-release',
  }
}

async function loadWorkspaceCatalog(catalogPath) {
  const target = resolve(catalogPath)
  const bytes = await readFile(target)
  const entries = getCatalogEntries(JSON.parse(bytes.toString('utf8')))
  return {
    entries,
    sourceCommit: null,
    catalogSha256: sha256(bytes),
    generatedAt: null,
    sourceKind: 'workspace-catalog',
  }
}

async function defaultDatabaseOptions() {
  const productionDirectory = '/var/lib/dsh-model-service'
  try {
    await access(productionDirectory, fsConstants.W_OK)
    return {
      databasePath: join(productionDirectory, 'plugin-catalog.sqlite3'),
      requireVerifiedRelease: true,
    }
  } catch {
    return {
      databasePath: resolve(projectRoot, '.local/plugin-catalog.sqlite3'),
      requireVerifiedRelease: false,
    }
  }
}

class SqliteWorker {
  #process = null
  #nextId = 1
  #buffer = ''
  #pending = new Map()
  #starting = null
  #exited = null

  constructor(databasePath, options = {}) {
    this.databasePath = resolve(databasePath)
    this.python = options.python || process.env.PLUGIN_CATALOG_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    this.script = options.workerPath || workerPath
  }

  async start() {
    if (this.#starting) return this.#starting
    this.#starting = (async () => {
      await mkdir(dirname(this.databasePath), { recursive: true, mode: 0o700 })
      if (process.platform !== 'win32') {
        const directory = await stat(dirname(this.databasePath))
        if ((directory.mode & 0o077) !== 0) throw new Error('catalog-database-directory-permissions-invalid')
      }

      this.#process = spawn(this.python, [this.script, this.databasePath], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      })
      this.#exited = new Promise(resolveExit => this.#process.once('exit', (code, signal) => resolveExit({ code, signal })))
      this.#process.stdout.setEncoding('utf8')
      this.#process.stdout.on('data', chunk => this.#onData(chunk))
      this.#process.once('error', () => this.#rejectPending(new Error('catalog-database-worker-unavailable')))
      this.#process.once('exit', code => {
        if (code !== 0) this.#rejectPending(new Error('catalog-database-worker-exited'))
      })
      await this.request({ action: 'init' })
    })().catch(error => {
      this.#starting = null
      throw error
    })
    return this.#starting
  }

  #onData(chunk) {
    this.#buffer += chunk
    while (true) {
      const newline = this.#buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.#buffer.slice(0, newline)
      this.#buffer = this.#buffer.slice(newline + 1)
      let response
      try { response = JSON.parse(line) } catch {
        this.#rejectPending(new Error('catalog-database-worker-response-invalid'))
        continue
      }
      const pending = this.#pending.get(response.id)
      if (!pending) continue
      clearTimeout(pending.timer)
      this.#pending.delete(response.id)
      if (response.ok) pending.resolve(response.result)
      else pending.reject(new Error(response.error || 'catalog-database-operation-failed'))
    }
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  request(payload) {
    if (!this.#process || this.#process.exitCode !== null) {
      return Promise.reject(new Error('catalog-database-worker-not-running'))
    }
    const id = this.#nextId++
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        rejectRequest(new Error('catalog-database-worker-timeout'))
      }, 30000)
      this.#pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
      this.#process.stdin.write(JSON.stringify({ ...payload, id }) + '\n', error => {
        if (!error) return
        clearTimeout(timer)
        this.#pending.delete(id)
        rejectRequest(new Error('catalog-database-worker-write-failed'))
      })
    })
  }

  async close() {
    if (!this.#process) return
    const child = this.#process
    try { await this.request({ action: 'close' }) } catch {}
    child.stdin.end()
    const exited = await Promise.race([
      this.#exited,
      new Promise(resolveExit => setTimeout(() => resolveExit(null), 2000)),
    ])
    if (!exited && child.exitCode === null) child.kill('SIGTERM')
    this.#process = null
    this.#starting = null
  }
}

function toIndexRecord(entry) {
  const packageName = safeString(entry.packageName || entry.name || entry.id, 512)
  const displayName = safeString(entry.displayName || entry.nameZh || entry.nameEn || packageName, 512)
  const aliases = [...new Set([entry.alias, entry.nameZh, entry.nameEn].map(value => safeString(value, 256)).filter(Boolean))]
  const purpose = safeString(entry.description, 4096)
  const terms = Array.isArray(entry.searchTerms) ? entry.searchTerms.map(value => safeString(value, 256)).filter(Boolean) : []
  const categories = Array.isArray(entry.categories) ? entry.categories.map(value => safeString(value, 128)).filter(Boolean) : []
  const indexText = value => tokenize(value).join(' ')
  return {
    id: safeString(entry.id || packageName, 256),
    packageName,
    displayName,
    aliases: indexText(aliases.join(' ')),
    purpose: indexText(purpose),
    searchTerms: indexText(terms.join(' ')),
    categories: indexText(categories.join(' ')),
    status: safeString(entry.status, 64),
    commit: safeString(entry.commit, 128),
  }
}

export class PluginCatalogIndex {
  #worker = null
  #startPromise = null
  #refreshTimer = null
  #entriesById = new Map()
  #lastRefreshStatus = 'not-started'
  #lastCheckedAt = null
  #lastRefreshError = null

  constructor(options = {}) {
    this.databasePath = options.databasePath || process.env.PLUGIN_CATALOG_DB_PATH || null
    this.sourceRoots = options.sourceRoots || (process.env.PLUGIN_CATALOG_SOURCE_DIR
      ? [process.env.PLUGIN_CATALOG_SOURCE_DIR]
      : defaultSourceRoots)
    this.fallbackCatalogPath = options.fallbackCatalogPath || process.env.CATALOG_PATH || resolve(projectRoot, 'registry/catalog.json')
    this.requireVerifiedRelease = options.requireVerifiedRelease
    this.refreshIntervalMs = options.refreshIntervalMs ?? Number(process.env.PLUGIN_CATALOG_SYNC_INTERVAL_MS || 300000)
    this.workerOptions = options.workerOptions || {}
  }

  async #ensureWorker() {
    if (this.#worker) return
    if (!this.databasePath) {
      const defaults = await defaultDatabaseOptions()
      this.databasePath = defaults.databasePath
      if (this.requireVerifiedRelease === undefined) this.requireVerifiedRelease = defaults.requireVerifiedRelease
    }
    if (this.requireVerifiedRelease === undefined) {
      this.requireVerifiedRelease = this.databasePath.startsWith('/var/lib/dsh-model-service/')
    }
    this.#worker = new SqliteWorker(this.databasePath, this.workerOptions)
    await this.#worker.start()
  }

  async #loadCurrentSnapshot() {
    const validReleases = []
    for (const sourceRoot of this.sourceRoots) {
      try {
        validReleases.push(await loadVerifiedCatalogRelease(sourceRoot))
      } catch {
        // A stale or incomplete release is ignored while another verified local release is available.
      }
    }
    if (validReleases.length) {
      validReleases.sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt)
        || right.sourceCommit.localeCompare(left.sourceCommit))
      return validReleases[0]
    }
    if (this.requireVerifiedRelease) throw new Error('no-verified-catalog-release')
    return loadWorkspaceCatalog(this.fallbackCatalogPath)
  }

  async #refresh() {
    this.#lastCheckedAt = new Date().toISOString()
    const snapshot = await this.#loadCurrentSnapshot()
    const currentState = await this.#worker.request({ action: 'status' })
    if (currentState.state?.catalogSha256 === snapshot.catalogSha256) {
      this.#entriesById = new Map(snapshot.entries.map(entry => [entry.id || entry.packageName || entry.name, entry]))
      this.#lastRefreshStatus = 'current'
      this.#lastRefreshError = null
      return
    }

    const records = snapshot.entries.map(toIndexRecord)
    await this.#worker.request({
      action: 'replace',
      records,
      state: {
        sourceCommit: snapshot.sourceCommit,
        catalogSha256: snapshot.catalogSha256,
        syncedAt: new Date().toISOString(),
      },
    })
    this.#entriesById = new Map(snapshot.entries.map(entry => [entry.id || entry.packageName || entry.name, entry]))
    this.#lastRefreshStatus = 'synced'
    this.#lastRefreshError = null
  }

  async start() {
    if (this.#startPromise) return this.#startPromise
    this.#startPromise = (async () => {
      await this.#ensureWorker()
      try {
        await this.#refresh()
      } catch (error) {
        this.#lastRefreshStatus = 'failed'
        this.#lastRefreshError = error.message === 'no-verified-catalog-release'
          ? 'no-verified-catalog-release'
          : 'catalog-source-validation-failed'
        throw error
      }
      if (Number.isFinite(this.refreshIntervalMs) && this.refreshIntervalMs > 0) {
        this.#refreshTimer = setInterval(() => {
          void this.#refresh().catch(error => {
            this.#lastCheckedAt = new Date().toISOString()
            this.#lastRefreshStatus = 'failed'
            this.#lastRefreshError = error.message === 'no-verified-catalog-release'
              ? 'no-verified-catalog-release'
              : 'catalog-source-validation-failed'
          })
        }, this.refreshIntervalMs)
        this.#refreshTimer.unref?.()
      }
    })().catch(error => {
      this.#startPromise = null
      throw error
    })
    return this.#startPromise
  }

  async search(query, limit = 8) {
    await this.start()
    const tokens = searchTokens(query)
    const result = await this.#worker.request({ action: 'search', tokens, limit: 512 })
    const rows = result.ids.map(id => this.#entriesById.get(id)).filter(Boolean)
    return searchCatalogCandidates(query, rows, limit)
  }

  async status() {
    await this.start()
    const result = await this.#worker.request({ action: 'status' })
    const state = result.state
    return {
      backend: 'sqlite-fts5',
      entryCount: state?.entryCount || 0,
      sourceCommit: state?.sourceCommit || null,
      catalogSha256: state?.catalogSha256 || null,
      syncedAt: state?.syncedAt || null,
      lastCheckedAt: this.#lastCheckedAt,
      lastRefreshStatus: this.#lastRefreshStatus,
      lastRefreshError: this.#lastRefreshError,
    }
  }

  async close() {
    if (this.#refreshTimer) clearInterval(this.#refreshTimer)
    this.#refreshTimer = null
    await this.#worker?.close()
    this.#worker = null
    this.#startPromise = null
  }
}

let defaultIndex

export function getPluginCatalogIndex(options) {
  if (!defaultIndex) defaultIndex = new PluginCatalogIndex(options)
  return defaultIndex
}

export async function closePluginCatalogIndex() {
  await defaultIndex?.close()
  defaultIndex = null
}
