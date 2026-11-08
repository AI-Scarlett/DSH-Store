// Regression coverage for the DSH STORE Desktop "官网完整目录" (official site
// plugin directory) that would not load ("加载不出来").
//
// Two defects shipped together in src/client.js:
//   1. The panel fetched the official discovery index with `cache: 'no-store'`,
//      so the browser HTTP cache was bypassed on EVERY page load even though
//      raw.githubusercontent.com serves `cache-control: max-age=300` plus an
//      ETag. The published index is ~10.4 MB raw (~2.56 MB gzip) and takes
//      ~2 minutes on a slow link, so every visit paid the full download again.
//   2. While that download ran, the panel rendered an EMPTY plugin list, so a
//      slow-but-healthy load read as "cannot load".
//
// The fix lets the discovery and candidate directories use the normal HTTP
// cache (`cache: 'default'`) while the two digest-pinned documents — the
// Catalog index (sha256 pinned by the freshly read Catalog) and the ranking
// snapshot (the index HTML pins the sha256 of data.json) — keep
// `cache: 'no-store'`: a cached copy of either could disagree with the
// document it is verified against and fail the integrity check.
//
// src/client.js is a browser bundle whose internals live in a closure, so the
// relevant source slices are evaluated with node:vm against injected globals
// instead of being imported.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

// Node exposes the WebCrypto digest the shipped integrity checks rely on.
assert.ok(globalThis.crypto?.subtle?.digest, 'this test needs globalThis.crypto.subtle')

function slice(startMarker, endMarker) {
  const start = clientSource.indexOf(startMarker)
  if (start < 0) return null
  const end = clientSource.indexOf(endMarker, start + startMarker.length)
  if (end <= start) return null
  return clientSource.slice(start, end)
}

// The shipped implementations, extracted verbatim from the real bundle. A
// missing slice means the fix was reverted, so it is reported per test instead
// of crashing the whole file at import time.
const SOURCE_PIECES = [
  ['desktopConstants', 'const DESKTOP_CATALOG_MAX_ENTRIES =', 'const DESKTOP_DISCOVERY_CATEGORY_LABELS'],
  ['desktopCommit', 'const DESKTOP_COMMIT = ', 'const DESKTOP_INSTALL_SCRIPTS = '],
  ['desktopFailure', 'function desktopFailure(', 'function desktopErrorCodeString('],
  ['desktopErrorCodeString', 'function desktopErrorCodeString(', 'function createDesktopDownloadGuard('],
  ['createDesktopDownloadGuard', 'function createDesktopDownloadGuard(', 'function withDesktopTimeout('],
  ['desktopExactObjectKeys', 'function desktopExactObjectKeys(', 'function desktopBoundedString('],
  ['desktopBoundedString', 'function desktopBoundedString(', 'function desktopSafeRepositoryUrl('],
  ['desktopSafeRepositoryUrl', 'function desktopSafeRepositoryUrl(', 'function validateDesktopDiscoveryIndex('],
  ['validateDesktopDiscoveryIndex', 'function validateDesktopDiscoveryIndex(', 'function validateDesktopCandidateRegistry('],
  ['validateDesktopCandidateRegistry', 'function validateDesktopCandidateRegistry(', 'function validateDesktopRankingSnapshot('],
  ['validateDesktopRankingSnapshot', 'function validateDesktopRankingSnapshot(', 'function desktopRankingEntries('],
  ['desktopErrorCode', 'function desktopErrorCode(', 'function DesktopStorePanel('],
  ['fetchDesktopDirectoryDocument', 'async function fetchDesktopDirectoryDocument(', 'async function fetchDesktopBoundedText('],
  ['fetchDesktopBoundedText', 'async function fetchDesktopBoundedText(', 'async function fetchDesktopRankingSnapshot('],
  ['fetchDesktopRankingSnapshot', 'async function fetchDesktopRankingSnapshot(', 'async function fetchDesktopCatalogIndex('],
  ['fetchDesktopCatalogIndex', 'async function fetchDesktopCatalogIndex(', 'async function fetchDesktopHostDirectory('],
  ['fetchDesktopHostDirectory', 'async function fetchDesktopHostDirectory(', 'async function fetchDesktopDirectorySnapshot('],
  ['fetchDesktopDirectorySnapshot', 'async function fetchDesktopDirectorySnapshot(', 'function desktopDirectoryCategories('],
]

const PIECES = Object.fromEntries(SOURCE_PIECES.map(([name, start, end]) => [name, slice(start, end)]))

function loadDesktopApi(overrides = {}) {
  for (const [name] of SOURCE_PIECES) {
    assert.ok(PIECES[name], `src/client.js must still ship the ${name} implementation`)
  }
  const sandbox = {
    window: { setTimeout, clearTimeout, crypto: globalThis.crypto },
    ROUTES: { directory: '/api2/dsh-safe-plugin-manager/directory' },
    fetch: () => { throw new Error('unexpected fetch call') },
    AbortController,
    TextDecoder,
    TextEncoder,
    URL,
    // The slices are evaluated in their own V8 context, so the host
    // constructors are injected to keep `instanceof` and deep-equality
    // assertions on the values the slices produce meaningful to the host realm.
    Error,
    JSON,
    Uint8Array,
    ...overrides,
  }
  const context = vm.createContext(sandbox)
  return vm.runInContext(
    `(() => {\n${SOURCE_PIECES.map(([name]) => PIECES[name]).join('\n')}\n`
    + '; return { fetchDesktopDirectoryDocument, fetchDesktopCatalogIndex, fetchDesktopHostDirectory, fetchDesktopDirectorySnapshot,'
    + ' fetchDesktopRankingSnapshot, DESKTOP_DIRECTORY_SOURCES, DESKTOP_DISCOVERY_MAX_BYTES }\n})()',
    context,
    { filename: 'src/client.js' },
  )
}

function createResponse(body, url) {
  if (body && typeof body === 'object' && 'ok' in body) return body
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const chunk = new TextEncoder().encode(text)
  let delivered = false
  return {
    ok: true, status: 200, url, headers: { get: () => null },
    text: async () => text,
    json: async () => JSON.parse(text),
    body: { getReader: () => ({
      async read() {
        if (delivered) return { done: true, value: undefined }
        delivered = true
        return { done: false, value: chunk }
      },
      releaseLock() {},
    }) },
  }
}

// A fetch stub that records the cache policy of every call and answers with a
// minimal but acceptable response.
function createRecordingFetch(responder) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, cache: init?.cache })
    return createResponse(await responder(url), url)
  }
  fetch.calls = calls
  return fetch
}

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function callsFor(calls, sources) {
  const urls = new Set(sources.map(source => source.url))
  return calls.filter(call => urls.has(call.url))
}

const CATALOG_INDEX_DOCUMENT = {
  schemaVersion: 2,
  catalogType: 'index',
  registry: {
    repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store',
    updatedAt: '2026-01-01T00:00:00.000Z',
    detailsPath: 'catalog/details',
  },
  entries: [{
    id: 'demo-plugin', nameZh: 'Demo Plugin', nameEn: 'Demo Plugin', packageName: 'demo-plugin',
    version: '1.0.0', featured: false, order: 0, repositoryUrl: 'https://github.com/AI-Scarlett/demo-plugin',
    detailPath: 'catalog/details/demo-plugin', status: 'approved', categories: ['developer'], searchTerms: ['demo'],
  }],
}

const DISCOVERY_DOCUMENT = {
  schemaVersion: 1,
  source: {
    name: 'dsh.so public discovery index', url: 'https://www.dsh.so/plugins-index.json',
    generatedAt: '2026-01-01T00:00:00.000Z', recordCount: 1,
    license: { spdx: 'CC-BY-4.0', attribution: 'dsh.so — DSH Developer Hub (https://www.dsh.so)' },
  },
  entries: [{
    sourceIndex: 0, sourceId: 'demo', alias: 'demo', name: 'Demo Plugin', description: 'demo plugin',
    stars: 12, categories: ['developer'], kind: 'plugin',
    repositoryUrl: 'https://github.com/AI-Scarlett/demo-plugin', detailUrl: 'https://www.dsh.so/artifact/demo/',
  }],
}

const CANDIDATE_DOCUMENT = {
  schemaVersion: 1,
  registry: {
    repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store',
    trustBoundary: { installActionsDisabled: true, catalogPromotionRequired: true, unknownIsNotVerified: true },
  },
  entries: [{
    id: 'demo-candidate', name: 'Demo Candidate', description: 'demo candidate',
    repositoryUrl: 'https://github.com/AI-Scarlett/demo-plugin', status: 'discovered',
    latestCommit: 'a'.repeat(40), topics: ['demo'],
  }],
}

const RANKING_DOCUMENT = {
  schemaVersion: 4,
  sourceCommit: 'a'.repeat(40),
  catalogUpdatedAt: '2026-01-01T00:00:00.000Z',
  candidatesUpdatedAt: '2026-01-01T00:00:00.000Z',
  starsObservedAt: '2026-01-01T00:00:00.000Z',
  weeklyStarsObservedAt: '2026-01-01T00:00:00.000Z',
  categories: [{ id: 'developer', zh: 'Developer', en: 'Developer' }],
  entries: [{
    id: 'demo-plugin', nameZh: 'Demo Plugin', nameEn: 'Demo Plugin', version: '1.0.0',
    repositoryUrl: 'https://github.com/AI-Scarlett/demo-plugin', description: 'demo plugin',
    categories: ['developer'], listingStatus: 'listed', listingReason: null, source: 'catalog',
    reviewStatus: 'approved', stars: 10, weeklyStars: 5, weeklySnapshotMember: true, weeklyCategories: ['developer'],
  }],
}

// The Catalog pins the index size and sha256, so the fixture must carry the
// digest of the very body the stub serves.
async function createCatalogFixture(document, body) {
  return {
    registry: {
      repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store',
      updatedAt: document.registry.updatedAt,
      indexPath: 'catalog-index.json',
      indexSha256: await sha256Hex(body),
      indexBytes: new TextEncoder().encode(body).byteLength,
      indexEntryCount: document.entries.length,
    },
    directoryEntries: document.entries.map(entry => ({ id: entry.id })),
  }
}

function createDirectoryResponder(catalogIndexBody) {
  return (url) => {
    if (url.endsWith('catalog-index.json')) return catalogIndexBody
    if (url.endsWith('discovery-index.json')) return JSON.stringify(DISCOVERY_DOCUMENT)
    if (url.endsWith('candidates.json')) return JSON.stringify(CANDIDATE_DOCUMENT)
    throw new Error(`unexpected fetch: ${url}`)
  }
}

function readNumericConstant(name) {
  const match = new RegExp(`const ${name} = ([^\\n]+)`).exec(clientSource)
  assert.ok(match, `src/client.js must declare ${name}`)
  const value = vm.runInNewContext(`(${match[1].replace(/\/\/.*$/, '').trim()})`)
  assert.equal(typeof value, 'number', `${name} must be a number`)
  return value
}

test('fetchDesktopDirectoryDocument keeps the no-store default for callers that do not opt in', async () => {
  const fetch = createRecordingFetch(() => { throw new Error('offline') })
  const { fetchDesktopDirectoryDocument, DESKTOP_DIRECTORY_SOURCES } = loadDesktopApi({ fetch })
  await assert.rejects(fetchDesktopDirectoryDocument(DESKTOP_DIRECTORY_SOURCES.discovery, {
    maxBytes: 1024, timeoutMs: 5_000, errorCode: 'DESKTOP_DISCOVERY',
  }))
  assert.ok(fetch.calls.length > 0, 'the directory document must be fetched')
  for (const call of fetch.calls) {
    assert.equal(call.cache, 'no-store', 'an unconfigured directory fetch must not use the HTTP cache')
  }
})

test('fetchDesktopDirectoryDocument honours an explicit cacheMode', async () => {
  const fetch = createRecordingFetch(() => { throw new Error('offline') })
  const { fetchDesktopDirectoryDocument, DESKTOP_DIRECTORY_SOURCES } = loadDesktopApi({ fetch })
  await assert.rejects(fetchDesktopDirectoryDocument(DESKTOP_DIRECTORY_SOURCES.discovery, {
    maxBytes: 1024, timeoutMs: 5_000, errorCode: 'DESKTOP_DISCOVERY', cacheMode: 'default',
  }))
  assert.ok(fetch.calls.length > 0, 'the directory document must be fetched')
  for (const call of fetch.calls) {
    assert.equal(call.cache, 'default', 'the opt-in cache policy must reach the fetch call')
  }
})

test('the discovery directory fetch is served from the browser HTTP cache', async () => {
  const catalogIndexBody = JSON.stringify(CATALOG_INDEX_DOCUMENT)
  const catalog = await createCatalogFixture(CATALOG_INDEX_DOCUMENT, catalogIndexBody)
  const fetch = createRecordingFetch(createDirectoryResponder(catalogIndexBody))
  const { fetchDesktopDirectorySnapshot, DESKTOP_DIRECTORY_SOURCES } = loadDesktopApi({ fetch })
  const snapshot = await fetchDesktopDirectorySnapshot(catalog)
  assert.equal(snapshot.discovery.entries.length, 1)
  const discoveryCalls = callsFor(fetch.calls, DESKTOP_DIRECTORY_SOURCES.discovery)
  assert.ok(discoveryCalls.length > 0, 'the discovery index must be fetched')
  for (const call of discoveryCalls) {
    assert.equal(call.cache, 'default', 'the discovery index is immutable per generation and must use the HTTP cache')
  }
})

test('the candidate directory fetch is served from the browser HTTP cache', async () => {
  const catalogIndexBody = JSON.stringify(CATALOG_INDEX_DOCUMENT)
  const catalog = await createCatalogFixture(CATALOG_INDEX_DOCUMENT, catalogIndexBody)
  const fetch = createRecordingFetch(createDirectoryResponder(catalogIndexBody))
  const { fetchDesktopDirectorySnapshot, DESKTOP_DIRECTORY_SOURCES } = loadDesktopApi({ fetch })
  const snapshot = await fetchDesktopDirectorySnapshot(catalog)
  assert.equal(snapshot.candidates.length, 1)
  const candidateCalls = callsFor(fetch.calls, DESKTOP_DIRECTORY_SOURCES.candidates)
  assert.ok(candidateCalls.length > 0, 'the candidate registry must be fetched')
  for (const call of candidateCalls) {
    assert.equal(call.cache, 'default', 'the candidate registry must use the HTTP cache')
  }
})

test('the catalog-index fetch stays uncached because it is sha256-pinned to the fresh Catalog', async () => {
  const catalogIndexBody = JSON.stringify(CATALOG_INDEX_DOCUMENT)
  const catalog = await createCatalogFixture(CATALOG_INDEX_DOCUMENT, catalogIndexBody)
  const fetch = createRecordingFetch(() => catalogIndexBody)
  const { fetchDesktopCatalogIndex, DESKTOP_DIRECTORY_SOURCES } = loadDesktopApi({ fetch })
  const entries = await fetchDesktopCatalogIndex(catalog)
  assert.equal(entries.length, 1, 'the pinned catalog index must pass the sha256 check')
  const indexCalls = callsFor(fetch.calls, DESKTOP_DIRECTORY_SOURCES.catalogIndex)
  assert.ok(indexCalls.length > 0, 'the catalog index must be fetched')
  for (const call of indexCalls) {
    assert.equal(call.cache, 'no-store',
      'the catalog index is verified against the sha256 the fresh Catalog pins, so a cached copy must never be used')
  }
})

test('the ranking index and ranking data fetches stay uncached because they are digest-pinned to each other', async () => {
  const rankingBody = JSON.stringify(RANKING_DOCUMENT)
  const digest = await sha256Hex(rankingBody)
  const indexHtml = `<!doctype html><html><head><meta name="dsh-rankings-sha256" content="${digest}"></head><body></body></html>`
  const fetch = createRecordingFetch((url) => (url.endsWith('index.html') ? indexHtml : rankingBody))
  const { fetchDesktopRankingSnapshot, DESKTOP_DIRECTORY_SOURCES } = loadDesktopApi({ fetch })
  const snapshot = await fetchDesktopRankingSnapshot()
  assert.equal(snapshot.digest, digest, 'the ranking data must be cross-checked against the index HTML digest')
  const rankingSources = DESKTOP_DIRECTORY_SOURCES.rankings
  const indexCalls = callsFor(fetch.calls, rankingSources.map(source => source.index))
  const dataCalls = callsFor(fetch.calls, rankingSources.map(source => source.data))
  assert.ok(indexCalls.length > 0, 'the ranking index HTML must be fetched')
  assert.ok(dataCalls.length > 0, 'the ranking data JSON must be fetched')
  for (const call of [...indexCalls, ...dataCalls]) {
    assert.equal(call.cache, 'no-store',
      'the ranking index and its data must come from the same generation, so neither may be cached')
  }
})

test('the discovery size ceiling has headroom for the published index', () => {
  // The published discovery index is ~10.4 MB raw and grows every day, so the
  // ceiling must not sit just above the current size: it needs real headroom
  // or the panel starts rejecting a healthy index as it grows.
  const ceiling = readNumericConstant('DESKTOP_DISCOVERY_MAX_BYTES')
  assert.ok(ceiling >= 32 * 1024 * 1024,
    `DESKTOP_DISCOVERY_MAX_BYTES (${ceiling}) must leave headroom above the ~10.4 MB published index`)
})

test('the panel renders Catalog rows while the official directory is still loading', () => {
  // The panel is a React component bundled for the DSH host: a full render
  // test would need the host runtime (React hooks, the injected services, the
  // module loader) and would assert on rendered Chinese UI strings. The memo
  // is therefore extracted from the source and evaluated on its own: that
  // pins the documented contract — the loading state shows the Catalog rows
  // instead of an empty list — without timing or UI-text coupling.
  const memo = slice('const directoryRows = useMemo(', 'const rankingRowsByType = useMemo(')
  assert.ok(memo, 'src/client.js must still ship the directoryRows memo')

  const evaluate = ({ loadStatus, directoryStatus, snapshot, catalog }) => {
    const calls = []
    const context = vm.createContext({
      useMemo: factory => factory(),
      loadState: { status: loadStatus, catalog },
      directoryState: { status: directoryStatus, snapshot },
      createDesktopKnownDirectory: (receivedCatalog, receivedSnapshot) => {
        calls.push({ catalog: receivedCatalog, snapshot: receivedSnapshot })
        return [{ id: 'stub-directory-row' }]
      },
    })
    const rows = vm.runInContext(`(() => {\n${memo}\n; return directoryRows })()`, context, { filename: 'src/client.js' })
    return { rows, calls }
  }

  const catalog = { entries: [{ id: 'demo-plugin' }] }
  const loading = evaluate({ loadStatus: 'ready', directoryStatus: 'loading', snapshot: null, catalog })
  assert.ok(Array.isArray(loading.rows), 'the memo must produce a list')
  assert.ok(loading.rows.length > 0, 'the loading state must not render an empty plugin list')
  assert.equal(loading.calls.length, 1, 'the loading state must build the rows from the Catalog')
  assert.equal(loading.calls[0].snapshot.discovery.entries.length, 0,
    'the loading fallback must not pretend the directory already arrived')

  const ready = evaluate({
    loadStatus: 'ready', directoryStatus: 'ready', catalog,
    snapshot: { discovery: { entries: [{ id: 'demo-plugin' }] }, candidates: [] },
  })
  assert.ok(ready.rows.length > 0, 'the ready state must render the directory rows')
  assert.equal(ready.calls[0].snapshot.discovery.entries.length, 1,
    'the ready state must build the rows from the loaded directory')
})

test('fetchDesktopHostDirectory reads the cached directory document from the local host route', async () => {
  const discoveryBody = JSON.stringify(DISCOVERY_DOCUMENT)
  const fetch = createRecordingFetch((url) => {
    if (url.includes('/api2/dsh-safe-plugin-manager/directory')) {
      return discoveryBody
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  const { fetchDesktopHostDirectory } = loadDesktopApi({ fetch })
  const result = await fetchDesktopHostDirectory()
  assert.ok(result, 'host directory must return parsed result')
  assert.equal(result.source, 'DSH 宿主缓存')
  assert.equal(result.value.entries.length, 1)
  assert.equal(fetch.calls.length, 1)
  assert.equal(fetch.calls[0].cache, 'no-store')
})

test('fetchDesktopDirectorySnapshot prefers host directory and falls back when unavailable', async () => {
  const catalogIndexBody = JSON.stringify(CATALOG_INDEX_DOCUMENT)
  const catalog = await createCatalogFixture(CATALOG_INDEX_DOCUMENT, catalogIndexBody)
  const discoveryBody = JSON.stringify(DISCOVERY_DOCUMENT)

  // 1. Host route succeeds -> remote discovery is NOT called
  {
    const fetch = createRecordingFetch((url) => {
      if (url.includes('/api2/dsh-safe-plugin-manager/directory')) return discoveryBody
      return createDirectoryResponder(catalogIndexBody)(url)
    })
    const { fetchDesktopDirectorySnapshot, DESKTOP_DIRECTORY_SOURCES } = loadDesktopApi({ fetch })
    const snapshot = await fetchDesktopDirectorySnapshot(catalog)
    assert.equal(snapshot.source, 'DSH 宿主缓存')
    assert.equal(snapshot.discovery.entries.length, 1)
    const discoveryCalls = callsFor(fetch.calls, DESKTOP_DIRECTORY_SOURCES.discovery)
    assert.equal(discoveryCalls.length, 0, 'remote discovery must not be fetched when host cache answers')
  }

  // 2. Host route fails -> falls back to remote discovery with cache: 'default'
  {
    const fetch = createRecordingFetch((url) => {
      if (url.includes('/api2/dsh-safe-plugin-manager/directory')) {
        return {
          ok: false, status: 503, url, headers: { get: () => null },
          text: async () => '{"ok":false}', json: async () => ({ ok: false }),
        }
      }
      return createDirectoryResponder(catalogIndexBody)(url)
    })
    const { fetchDesktopDirectorySnapshot, DESKTOP_DIRECTORY_SOURCES } = loadDesktopApi({ fetch })
    const snapshot = await fetchDesktopDirectorySnapshot(catalog)
    assert.notEqual(snapshot.source, 'DSH 宿主缓存')
    assert.equal(snapshot.discovery.entries.length, 1)
    const discoveryCalls = callsFor(fetch.calls, DESKTOP_DIRECTORY_SOURCES.discovery)
    assert.ok(discoveryCalls.length > 0, 'remote discovery must be fetched when host fails')
    assert.equal(discoveryCalls[0].cache, 'default')
  }
})
