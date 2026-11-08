import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createDiscoveryService, DEFAULT_DISCOVERY_SOURCES } from '../src/discovery.mjs'
import { DIRECTORY_ROUTE_PATH, handleDirectoryRequest, registerManagerRoutes } from '../src/panel.mjs'

function entry(index = 0) {
  return {
    sourceIndex: index,
    sourceId: `example/demo-${index}`,
    alias: `@example/demo-${index}`,
    name: `Demo ${index}`,
    description: 'bounded discovery fixture',
    stars: index,
    categories: ['ai'],
    kind: 'dsh-plugin',
    repositoryUrl: `https://github.com/example/demo-${index}`,
    detailUrl: `https://www.dsh.so/artifact/demo-${index}/`,
  }
}

function document(count = 1) {
  const entries = Array.from({ length: count }, (_, index) => entry(index))
  return {
    schemaVersion: 1,
    source: {
      name: 'dsh.so public discovery index',
      url: 'https://www.dsh.so/plugins-index.json',
      generatedAt: '2026-11-02T00:31:49.941Z',
      recordCount: entries.length,
      license: { spdx: 'CC-BY-4.0', attribution: 'dsh.so — DSH Developer Hub (https://www.dsh.so)' },
    },
    entries,
  }
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function getRequest(method = 'GET') {
  const req = Readable.from([])
  req.method = method
  req.headers = { host: '127.0.0.1:3080' }
  return req
}

function response() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(value = '') { this.body += String(value) },
  }
}

async function fixture() {
  return mkdtemp(join(tmpdir(), 'dsh-discovery-'))
}

test('discovery service caches a successful fetch and answers from the cache without a second request', async () => {
  const root = await fixture()
  try {
    let calls = 0
    const service = createDiscoveryService({
      dshHome: root,
      fetchImpl: async () => { calls += 1; return jsonResponse(document()) },
    })
    const first = await service.load()
    assert.equal(first.fromCache, false)
    assert.equal(first.document.schemaVersion, 1)
    assert.equal(first.document.entries.length, 1)
    assert.equal(first.source.id, 'raw-github')
    assert.equal(service.cachePath, join(root, 'dsh-safe-plugin-manager', 'discovery-cache.json'))

    const second = await service.load()
    assert.equal(second.fromCache, true)
    assert.equal(second.document.entries.length, 1)
    assert.equal(calls, 1)

    // A fresh host process reads the same bytes back from the disk cache.
    const restored = await createDiscoveryService({
      dshHome: root,
      fetchImpl: async () => { throw new TypeError('offline') },
    }).load()
    assert.equal(restored.fromCache, true)
    assert.equal(restored.document.entries[0].sourceId, 'example/demo-0')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('discovery cache is replaced atomically, records the stored digest, and treats a tampered file as a miss', async () => {
  const root = await fixture()
  try {
    const service = createDiscoveryService({ dshHome: root, fetchImpl: async () => jsonResponse(document(2)) })
    await service.load()
    const directory = join(root, 'dsh-safe-plugin-manager')
    const cachePath = join(directory, 'discovery-cache.json')
    // The temporary file is renamed into place, so no partial file is left behind.
    assert.deepEqual(await readdir(directory), ['discovery-cache.json'])

    const record = JSON.parse(await readFile(cachePath, 'utf8'))
    assert.equal(record.schemaVersion, 1)
    assert.equal(record.bytes, Buffer.byteLength(JSON.stringify(record.document), 'utf8'))
    assert.equal(
      createHash('sha256').update(Buffer.from(JSON.stringify(record.document), 'utf8')).digest('hex'),
      record.sha256,
    )
    assert.equal(Number.isFinite(record.cachedAt), true)

    // A tampered but still well formed cache file is never served.
    const tampered = { ...record, document: { ...record.document, entries: [{ ...record.document.entries[0], name: 'Tampered' }, record.document.entries[1]] } }
    await writeFile(cachePath, JSON.stringify(tampered), 'utf8')
    let calls = 0
    const restored = await createDiscoveryService({
      dshHome: root,
      fetchImpl: async () => { calls += 1; return jsonResponse(document(2)) },
    }).load()
    assert.equal(calls, 1)
    assert.equal(restored.fromCache, false)
    assert.equal(restored.document.entries[0].name, 'Demo 0')

    // A truncated cache file is a miss as well.
    await writeFile(cachePath, '{"schemaVersion":1', 'utf8')
    calls = 0
    const truncated = await createDiscoveryService({
      dshHome: root,
      fetchImpl: async () => { calls += 1; return jsonResponse(document(2)) },
    }).load()
    assert.equal(calls, 1)
    assert.equal(truncated.fromCache, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('discovery service falls through to the second source after a recoverable transport failure', async () => {
  const root = await fixture()
  try {
    const requested = []
    const service = createDiscoveryService({
      dshHome: root,
      fetchImpl: async url => {
        requested.push(url)
        if (requested.length === 1) throw new TypeError('network unreachable')
        return jsonResponse(document())
      },
    })
    const result = await service.load()
    assert.equal(requested.length, 2)
    assert.equal(requested[0], DEFAULT_DISCOVERY_SOURCES[0].url)
    assert.equal(requested[1], DEFAULT_DISCOVERY_SOURCES[1].url)
    assert.equal(result.source.id, 'github-pages')
    assert.equal(result.fromCache, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('discovery service rejects an oversized response and caches nothing', async () => {
  const root = await fixture()
  try {
    const service = createDiscoveryService({
      dshHome: root,
      maxBytes: 512,
      fetchImpl: async () => new Response('x'.repeat(4096), { status: 200 }),
    })
    await assert.rejects(() => service.load(), error => {
      assert.ok(['DESKTOP_DIRECTORY_INVALID', 'DESKTOP_DIRECTORY_TIMEOUT'].includes(error.code))
      assert.equal(error.code, 'DESKTOP_DIRECTORY_INVALID')
      return true
    })
    await assert.rejects(() => readFile(join(root, 'dsh-safe-plugin-manager', 'discovery-cache.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('discovery service rejects a structurally invalid document and caches nothing', async () => {
  const root = await fixture()
  try {
    const invalid = [
      { ...document(), source: { ...document().source, recordCount: 9 } },
      { ...document(), schemaVersion: 2 },
      { ...document(), entries: [] },
      { ...document(), source: { ...document().source, generatedAt: 'not-a-date' } },
    ]
    for (const value of invalid) {
      const service = createDiscoveryService({ dshHome: root, fetchImpl: async () => jsonResponse(value) })
      await assert.rejects(() => service.load(), error => {
        assert.equal(error.code, 'DESKTOP_DIRECTORY_INVALID')
        return true
      })
      await assert.rejects(() => readFile(join(root, 'dsh-safe-plugin-manager', 'discovery-cache.json')))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('discovery service reports a timeout when the upstream fetch exceeds its budget', async () => {
  const root = await fixture()
  try {
    const stalled = createDiscoveryService({
      dshHome: root,
      timeoutMs: 60,
      fetchImpl: () => new Promise(() => {}),
    })
    await assert.rejects(() => stalled.load(), error => {
      assert.equal(error.code, 'DESKTOP_DIRECTORY_TIMEOUT')
      return true
    })

    const aborted = createDiscoveryService({
      dshHome: root,
      timeoutMs: 60,
      fetchImpl: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) },
    })
    await assert.rejects(() => aborted.load(), error => {
      assert.equal(error.code, 'DESKTOP_DIRECTORY_TIMEOUT')
      return true
    })
    await assert.rejects(() => readFile(join(root, 'dsh-safe-plugin-manager', 'discovery-cache.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('discovery cache is fresh within the TTL and stale after it', async () => {
  const root = await fixture()
  try {
    let calls = 0
    const service = createDiscoveryService({
      dshHome: root,
      ttlMs: 60_000,
      fetchImpl: async () => { calls += 1; return jsonResponse(document()) },
    })
    await service.load()
    await service.load()
    assert.equal(calls, 1)

    const cachePath = join(root, 'dsh-safe-plugin-manager', 'discovery-cache.json')
    const record = JSON.parse(await readFile(cachePath, 'utf8'))
    await writeFile(cachePath, JSON.stringify({ ...record, cachedAt: Date.now() - 7 * 60 * 60_000 }), 'utf8')

    const stale = await createDiscoveryService({
      dshHome: root,
      ttlMs: 60_000,
      fetchImpl: async () => { calls += 1; return jsonResponse(document(3)) },
    }).load()
    assert.equal(calls, 2)
    assert.equal(stale.fromCache, false)
    assert.equal(stale.document.entries.length, 3)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('directory route answers with the discovery document and a bounded failure body', async () => {
  const root = await fixture()
  const empty = await fixture()
  try {
    const service = createDiscoveryService({ dshHome: root, fetchImpl: async () => jsonResponse(document()) })
    const res = response()
    await handleDirectoryRequest(getRequest(), res, { discoveryService: service })
    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'], /application\/json/)
    const payload = JSON.parse(res.body)
    // The document itself is returned, never a wrapper.
    assert.equal(payload.schemaVersion, 1)
    assert.equal(payload.source.recordCount, 1)
    assert.equal(payload.entries.length, 1)
    assert.equal(payload.ok, undefined)
    assert.equal(payload.value, undefined)

    const failing = createDiscoveryService({ dshHome: empty, fetchImpl: async () => { throw new TypeError('offline') } })
    const failure = response()
    await handleDirectoryRequest(getRequest(), failure, { discoveryService: failing })
    assert.equal(failure.status, 503)
    const error = JSON.parse(failure.body)
    assert.equal(error.ok, false)
    assert.equal(error.error.code, 'DESKTOP_DIRECTORY_UNAVAILABLE')
    assert.equal(typeof error.error.message, 'string')
    assert.equal(error.error.message.includes(empty), false)
    assert.equal(error.error.message.includes('TypeError'), false)
    assert.equal(error.error.message.includes('\n'), false)

    const missing = response()
    await handleDirectoryRequest(getRequest(), missing, {})
    assert.equal(missing.status, 503)
    assert.equal(JSON.parse(missing.body).error.code, 'DESKTOP_DIRECTORY_UNAVAILABLE')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(empty, { recursive: true, force: true })
  }
})

test('directory route only answers GET and HEAD requests', async () => {
  const root = await fixture()
  try {
    const service = createDiscoveryService({ dshHome: root, fetchImpl: async () => jsonResponse(document()) })
    const head = response()
    await handleDirectoryRequest(getRequest('HEAD'), head, { discoveryService: service })
    assert.equal(head.status, 200)

    const rejected = response()
    await handleDirectoryRequest(getRequest('POST'), rejected, { discoveryService: service })
    assert.equal(rejected.status, 405)
    assert.equal(rejected.headers.allow, 'GET, HEAD')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('manager routes publish the directory route under its documented path', async () => {
  const root = await fixture()
  try {
    const routes = []
    registerManagerRoutes({ register: route => routes.push(route) }, {
      connection: { requestRejection: () => undefined },
      discoveryService: createDiscoveryService({ dshHome: root, fetchImpl: async () => jsonResponse(document()) }),
    })
    const route = routes.find(item => item.path === DIRECTORY_ROUTE_PATH)
    assert.ok(route)
    assert.equal(DIRECTORY_ROUTE_PATH, '/api2/dsh-safe-plugin-manager/directory')
    const res = response()
    await route.handler(getRequest(), res)
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(res.body).entries.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
