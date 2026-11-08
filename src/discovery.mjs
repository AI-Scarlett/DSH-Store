import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// The published discovery document is roughly 10 MiB raw. Downloading it in
// the browser costs minutes on a slow link, so the host keeps one bounded,
// integrity-checked copy on disk and serves it over localhost in milliseconds.
export const DEFAULT_DISCOVERY_SOURCES = [
  { id: 'raw-github', url: 'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/discovery-index.json' },
  { id: 'github-pages', url: 'https://ai-scarlett.github.io/DSH-Store/registry/discovery-index.json' },
]
export const MAX_DISCOVERY_BYTES = 32 * 1024 * 1024
export const MAX_DISCOVERY_RECORDS = 50_000
export const MAX_DISCOVERY_CACHE_BYTES = 48 * 1024 * 1024
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 240_000
export const DEFAULT_DISCOVERY_TTL_MS = 6 * 60 * 60_000
export const DISCOVERY_CACHE_DIRECTORY = 'dsh-safe-plugin-manager'
export const DISCOVERY_CACHE_FILE = 'discovery-cache.json'
export const DISCOVERY_ERROR_CODES = [
  'DESKTOP_DIRECTORY_UNAVAILABLE',
  'DESKTOP_DIRECTORY_TIMEOUT',
  'DESKTOP_DIRECTORY_INVALID',
]

function discoveryError(code, message) {
  return Object.assign(new Error(message), { code })
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalBytes(document) {
  return Buffer.from(JSON.stringify(document), 'utf8')
}

function normalizeSources(value) {
  const list = Array.isArray(value) ? value : DEFAULT_DISCOVERY_SOURCES
  const sources = []
  for (const item of list) {
    const url = typeof item === 'string' ? item : item?.url
    const id = typeof item === 'string' ? null : item?.id
    if (typeof url !== 'string' || !url.startsWith('https://')) continue
    sources.push({ id: typeof id === 'string' && id.trim() !== '' ? id : url, url })
  }
  return sources
}

// The host is a transport, not the schema authority: the browser validates the
// document with its own validator. This check only rejects bytes that are
// obviously not the published discovery index, so a broken mirror can never be
// cached or served.
export function validateDiscoveryDocument(document) {
  if (!isPlainObject(document)) throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory document must be an object')
  if (document.schemaVersion !== 1) throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory schemaVersion must be 1')
  const source = document.source
  if (!isPlainObject(source)) throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory source must be an object')
  if (typeof source.name !== 'string' || source.name.trim() === '') {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory source name must be a non-empty string')
  }
  if (typeof source.url !== 'string' || source.url.trim() === '') {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory source url must be a non-empty string')
  }
  if (typeof source.generatedAt !== 'string' || !Number.isFinite(Date.parse(source.generatedAt))) {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory generatedAt must be a parseable date-time')
  }
  if (!Number.isSafeInteger(source.recordCount)) {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory recordCount must be a safe integer')
  }
  const license = source.license
  if (!isPlainObject(license)) throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory license must be an object')
  if (typeof license.spdx !== 'string' || license.spdx.trim() === '') {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory license spdx must be a non-empty string')
  }
  if (typeof license.attribution !== 'string' || license.attribution.trim() === '') {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory license attribution must be a non-empty string')
  }
  if (!Array.isArray(document.entries)) throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory entries must be an array')
  if (document.entries.length === 0) throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory entries must not be empty')
  if (document.entries.length > MAX_DISCOVERY_RECORDS) {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory exceeds the record bound')
  }
  if (document.entries.length !== source.recordCount) {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory recordCount must match the entry count')
  }
  return document
}

function parseDocument(bytes) {
  let document
  try {
    document = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory document is not valid JSON')
  }
  return validateDiscoveryDocument(document)
}

// The response body is never buffered without a bound: the declared length is
// rejected up front and the decoded stream is aborted as soon as it exceeds
// the budget.
async function readBoundedBody(response, maxBytes) {
  const declared = Number(response?.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory response exceeds the byte bound')
  }
  const reader = response?.body?.getReader?.()
  if (reader) {
    const chunks = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
        size += chunk.length
        if (size > maxBytes) {
          try { await reader.cancel() } catch { /* The stream is discarded either way. */ }
          throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory response exceeds the byte bound')
        }
        chunks.push(chunk)
      }
    } finally {
      try { reader.releaseLock?.() } catch { /* Releasing a finished reader is best effort. */ }
    }
    return Buffer.concat(chunks)
  }
  const text = await response.text()
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length > maxBytes) {
    throw discoveryError('DESKTOP_DIRECTORY_INVALID', 'discovery directory response exceeds the byte bound')
  }
  return bytes
}

export function createDiscoveryService(options = {}) {
  const dshHome = typeof options.dshHome === 'string' && options.dshHome.trim() !== '' ? options.dshHome : null
  const sources = normalizeSources(options.sources)
  const request = typeof options.fetchImpl === 'function'
    ? options.fetchImpl
    : (typeof options.fetch === 'function' ? options.fetch : globalThis.fetch)
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : MAX_DISCOVERY_BYTES
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_DISCOVERY_TIMEOUT_MS
  const ttlMs = Number.isInteger(options.ttlMs) && options.ttlMs >= 0 ? options.ttlMs : DEFAULT_DISCOVERY_TTL_MS
  const cachePath = typeof options.cachePath === 'string' && options.cachePath.trim() !== ''
    ? options.cachePath
    : (dshHome === null ? null : join(dshHome, DISCOVERY_CACHE_DIRECTORY, DISCOVERY_CACHE_FILE))
  const logger = options.logger ?? null
  let memory = null
  let pending = null

  // Only a short status line is ever logged: no document body, no credentials
  // and no absolute filesystem path.
  function status(message) {
    try {
      if (typeof logger === 'function') logger(message)
      else logger?.info?.(message)
    } catch { /* Logging must never break a directory request. */ }
  }

  async function readCache() {
    if (cachePath === null) return null
    try {
      const metadata = await stat(cachePath)
      if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_DISCOVERY_CACHE_BYTES) return null
      const record = JSON.parse(await readFile(cachePath, 'utf8'))
      if (!isPlainObject(record) || record.schemaVersion !== 1) return null
      if (!Number.isFinite(record.cachedAt) || record.cachedAt <= 0) return null
      if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) return null
      if (!isPlainObject(record.source) || typeof record.source.id !== 'string' || typeof record.source.url !== 'string') return null
      const document = validateDiscoveryDocument(record.document)
      const bytes = canonicalBytes(document)
      // A truncated or tampered cache file is a miss, never a served document.
      if (sha256Hex(bytes) !== record.sha256) return null
      if (record.bytes !== bytes.length) return null
      return {
        document,
        bytes: bytes.length,
        cachedAt: record.cachedAt,
        source: { id: record.source.id, url: record.source.url, fetchedAt: record.source.fetchedAt ?? null },
      }
    } catch {
      return null
    }
  }

  async function writeCache(entry) {
    if (cachePath === null) return
    try {
      const bytes = canonicalBytes(entry.document)
      const content = JSON.stringify({
        schemaVersion: 1,
        cachedAt: entry.cachedAt,
        source: entry.source,
        sha256: sha256Hex(bytes),
        bytes: bytes.length,
        document: entry.document,
      })
      if (Buffer.byteLength(content) > MAX_DISCOVERY_CACHE_BYTES) return
      await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 })
      const temporary = join(dirname(cachePath), `.discovery-${process.pid}-${Date.now()}.tmp`)
      await writeFile(temporary, content, { mode: 0o600 })
      await rename(temporary, cachePath)
    } catch { /* The cache is an optimisation; a failed write is not fatal. */ }
  }

  async function fetchSource(source, budget) {
    const controller = new AbortController()
    let timer = null
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(discoveryError('DESKTOP_DIRECTORY_TIMEOUT', 'discovery directory fetch exceeded its budget'))
      }, budget)
    })
    try {
      const response = await Promise.race([
        Promise.resolve(request(source.url, {
          headers: { accept: 'application/json', 'user-agent': 'dsh-safe-plugin-manager' },
          signal: controller.signal,
        })),
        timeout,
      ])
      const ok = response?.ok === true
        || (response?.ok === undefined && Number.isInteger(response?.status) && response.status >= 200 && response.status < 300)
      if (!ok) {
        const status = Number.isInteger(response?.status) ? response.status : null
        throw discoveryError('DESKTOP_DIRECTORY_UNAVAILABLE', `discovery directory source returned HTTP ${status ?? 'error'}`)
      }
      return await Promise.race([readBoundedBody(response, maxBytes), timeout])
    } catch (error) {
      if (DISCOVERY_ERROR_CODES.includes(error?.code)) throw error
      if (error?.name === 'AbortError') throw discoveryError('DESKTOP_DIRECTORY_TIMEOUT', 'discovery directory fetch exceeded its budget')
      throw discoveryError('DESKTOP_DIRECTORY_UNAVAILABLE', 'discovery directory source is unavailable')
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  async function fetchDocument() {
    if (typeof request !== 'function') throw discoveryError('DESKTOP_DIRECTORY_UNAVAILABLE', 'discovery directory fetch is unavailable')
    if (sources.length === 0) throw discoveryError('DESKTOP_DIRECTORY_UNAVAILABLE', 'discovery directory has no source')
    // The timeout budget covers every source, so a cold host never blocks the
    // browser for longer than the documented limit.
    const deadline = Date.now() + timeoutMs
    let lastError = null
    for (const source of sources) {
      const budget = deadline - Date.now()
      if (budget <= 0) {
        lastError = discoveryError('DESKTOP_DIRECTORY_TIMEOUT', 'discovery directory fetch exceeded its budget')
        break
      }
      try {
        const bytes = await fetchSource(source, budget)
        const document = parseDocument(bytes)
        return {
          document,
          bytes: bytes.length,
          cachedAt: Date.now(),
          source: { id: source.id, url: source.url, fetchedAt: new Date().toISOString() },
        }
      } catch (error) {
        // A malformed publication is a defect, not a transport failure: it is
        // never cached and never replaced by a second mirror.
        if (error?.code === 'DESKTOP_DIRECTORY_INVALID') throw error
        lastError = error
      }
    }
    throw lastError ?? discoveryError('DESKTOP_DIRECTORY_UNAVAILABLE', 'discovery directory is unavailable')
  }

  async function refresh() {
    const cached = await readCache()
    if (cached && Date.now() - cached.cachedAt < ttlMs) {
      memory = cached
      status(`discovery directory cache hit (bytes=${cached.bytes}, source=${cached.source.id})`)
      return { document: cached.document, source: { ...cached.source, kind: 'cache' }, fromCache: true }
    }
    try {
      const fetched = await fetchDocument()
      await writeCache(fetched)
      memory = { document: fetched.document, bytes: fetched.bytes, cachedAt: fetched.cachedAt, source: fetched.source }
      status(`discovery directory fetched (bytes=${fetched.bytes}, source=${fetched.source.id})`)
      return { document: fetched.document, source: { ...fetched.source, kind: 'remote' }, fromCache: false }
    } catch (error) {
      const failure = DISCOVERY_ERROR_CODES.includes(error?.code)
        ? error
        : discoveryError('DESKTOP_DIRECTORY_UNAVAILABLE', 'discovery directory is unavailable')
      // An outdated but intact cache still answers a transport outage. A
      // malformed publication never replaces a known good document.
      if (failure.code !== 'DESKTOP_DIRECTORY_INVALID' && cached) {
        memory = cached
        status(`discovery directory stale cache served (bytes=${cached.bytes}, source=${cached.source.id})`)
        return { document: cached.document, source: { ...cached.source, kind: 'cache', stale: true }, fromCache: true }
      }
      status(`discovery directory unavailable (code=${failure.code})`)
      throw failure
    }
  }

  async function load() {
    if (memory && Date.now() - memory.cachedAt < ttlMs) {
      status(`discovery directory cache hit (bytes=${memory.bytes}, source=${memory.source.id})`)
      return { document: memory.document, source: { ...memory.source, kind: 'cache' }, fromCache: true }
    }
    if (pending) return pending
    pending = refresh().finally(() => { pending = null })
    return pending
  }

  return { load, cachePath, sources }
}
