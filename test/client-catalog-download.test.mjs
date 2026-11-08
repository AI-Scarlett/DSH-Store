// Regression coverage for the DSH STORE Desktop marketplace panel failure
// (the panel reported the generic DESKTOP_OPERATION_FAILED instead of the real
// cause of the Catalog download).
//
// Two defects shipped together in src/client.js:
//   1. `desktopErrorCode` treated any truthy `error.code` as a code. A browser
//      DOMException carries a legacy *numeric* code (AbortError is 20), so an
//      abort was reported as the generic DESKTOP_OPERATION_FAILED and the real
//      cause was hidden.
//   2. The Catalog document download had a fixed 12 s budget, but the published
//      registry/catalog.json is ~1.9 MB raw (~247 KB gzip) and needs ~12.4 s on
//      a slow link, so the download aborted and surfaced defect 1.
//
// The current bundle downloads the Catalog per delivery source
// (`fetchDesktopCatalogSource`) and lets `fetchDesktopCatalogDocument` fall
// through to the next source when a failure is recoverable, so the coverage
// below pins the per-source behaviour, the fall-through and the download guard
// that bounds every attempt.
//
// src/client.js is a browser bundle whose internals live in a closure, so the
// relevant source slices are evaluated with node:vm against injected globals
// instead of being imported.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

const CATALOG_URL = 'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/catalog.json'

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
const DESKTOP_PIECES = {
  // The delivery sources of the Catalog document. They are read from the
  // bundle so the test never pins a URL that the bundle moved on from.
  catalogSources: slice('const DESKTOP_CATALOG_URL = ', 'const DESKTOP_CATALOG_MAX_BYTES = '),
  desktopFailure: slice('function desktopFailure(', 'function desktopErrorCodeString('),
  // `desktopErrorCodeString` is followed by the download guard, so this slice
  // carries both implementations.
  desktopErrorCodeString: slice('function desktopErrorCodeString(', 'function withDesktopTimeout('),
  fetchDesktopCatalogSource: slice('async function fetchDesktopCatalogSource(', 'async function fetchDesktopCatalogDocument('),
  fetchDesktopCatalogDocument: slice('async function fetchDesktopCatalogDocument(', 'function desktopExactObjectKeys('),
  desktopErrorCode: slice('function desktopErrorCode(', 'function DesktopStorePanel('),
}

function loadDesktopApi(overrides = {}) {
  for (const [name, piece] of Object.entries(DESKTOP_PIECES)) {
    assert.ok(piece, `src/client.js must still ship the ${name} implementation`)
  }
  const sandbox = {
    window: { setTimeout, clearTimeout },
    fetch: () => { throw new Error('unexpected fetch call') },
    AbortController,
    TextDecoder,
    TextEncoder,
    URL,
    // The slice is evaluated in its own V8 context, so the host constructors
    // are injected to keep `instanceof` and deep-equality assertions on the
    // values the slice produces meaningful to the host realm.
    Error,
    JSON,
    Uint8Array,
    DESKTOP_CATALOG_MAX_BYTES: 4 * 1024 * 1024,
    DESKTOP_CATALOG_DOWNLOAD_TIMEOUT_MS: 90_000,
    DESKTOP_DOWNLOAD_STALL_MS: 30_000,
    ...overrides,
  }
  const context = vm.createContext(sandbox)
  return vm.runInContext(
    `(() => {\n${Object.values(DESKTOP_PIECES).join('\n')}\n`
    + '; return { desktopErrorCode, desktopErrorCodeString, createDesktopDownloadGuard,'
    + ' fetchDesktopCatalogDocument, fetchDesktopCatalogSource, DESKTOP_CATALOG_SOURCES }\n})()',
    context,
    { filename: 'src/client.js' },
  )
}

const delay = ms => new Promise(resolve => { setTimeout(resolve, ms) })

// A browser-like fetch: it never resolves and rejects with the numeric
// DOMException a real browser raises when the abort signal fires.
function createAbortingFetch() {
  return (url, init) => new Promise((_resolve, reject) => {
    const signal = init && init.signal
    if (!signal) { reject(new Error('the catalog fetch must pass an abort signal')); return }
    if (signal.aborted) { reject(new DOMException('The operation was aborted.', 'AbortError')); return }
    signal.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }, { once: true })
  })
}

function createCatalogResponse(body, url = CATALOG_URL) {
  const chunk = new TextEncoder().encode(body)
  let delivered = false
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        async read() {
          if (delivered) return { done: true, value: undefined }
          delivered = true
          return { done: false, value: chunk }
        },
        releaseLock() {},
      }),
    },
  }
}

// A fetch stub that records every call and answers through `responder`. The
// responder may return a body string or a complete response object.
function createRecordingFetch(responder) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, cache: init?.cache })
    const answer = await responder(url, init)
    if (answer && typeof answer === 'object' && 'ok' in answer) return answer
    return createCatalogResponse(String(answer), url)
  }
  fetch.calls = calls
  return fetch
}

function readConstant(name) {
  const match = new RegExp(`const ${name} = ([0-9_]+)`).exec(clientSource)
  assert.ok(match, `src/client.js must declare ${name}`)
  return Number(match[1].replaceAll('_', ''))
}

test('desktopErrorCode skips the numeric legacy code of an aborted DOMException', () => {
  const { desktopErrorCode, desktopErrorCodeString } = loadDesktopApi()

  const abortError = new DOMException('The user aborted a request.', 'AbortError')
  assert.equal(abortError.code, 20, 'a DOMException carries the legacy numeric AbortError code')
  assert.equal(typeof abortError.code, 'number')

  const fromAbort = desktopErrorCode(abortError)
  assert.equal(typeof fromAbort, 'string', 'a reported code must always be a string')
  assert.notEqual(fromAbort, 20, 'the numeric legacy code must never be reported as a code')
  // The DOMException message is prose, not a code shape, so the generic
  // fallback is the documented last resort — but never the number 20.
  assert.equal(fromAbort, 'DESKTOP_OPERATION_FAILED')

  // The regression itself: a numeric code used to shadow the real string code.
  assert.equal(desktopErrorCode({ code: 20, message: 'DESKTOP_CATALOG_TIMEOUT' }), 'DESKTOP_CATALOG_TIMEOUT')
  assert.equal(desktopErrorCode({ code: 'DESKTOP_CATALOG_STALLED' }), 'DESKTOP_CATALOG_STALLED')
  assert.equal(desktopErrorCode({ code: 20, message: 'The operation was aborted.' }), 'DESKTOP_OPERATION_FAILED')
  assert.equal(desktopErrorCode({ code: 20 }), 'DESKTOP_OPERATION_FAILED')
  assert.equal(desktopErrorCode(new Error('boom boom')), 'DESKTOP_OPERATION_FAILED')
  assert.equal(desktopErrorCode(undefined), 'DESKTOP_OPERATION_FAILED')
  assert.equal(desktopErrorCode({ problem: 'DESKTOP_CATALOG_HTTP_FAILED' }), 'DESKTOP_CATALOG_HTTP_FAILED')
  assert.equal(desktopErrorCode({ error: { code: 'DESKTOP_CATALOG_EMPTY' } }), 'DESKTOP_CATALOG_EMPTY')
})

test('desktopErrorCodeString only accepts the documented string code shape', () => {
  const { desktopErrorCodeString } = loadDesktopApi()
  assert.equal(desktopErrorCodeString(20), null)
  assert.equal(desktopErrorCodeString('DESKTOP_X'), 'DESKTOP_X')
  assert.equal(desktopErrorCodeString('DESKTOP_CATALOG_TIMEOUT'), 'DESKTOP_CATALOG_TIMEOUT')
  assert.equal(desktopErrorCodeString('The operation was aborted.'), null)
  assert.equal(desktopErrorCodeString('boom boom'), null)
  assert.equal(desktopErrorCodeString(undefined), null)
  assert.equal(desktopErrorCodeString(''), null)
})

test('the desktop download guard aborts at the hard ceiling', async () => {
  const { createDesktopDownloadGuard } = loadDesktopApi()
  const controller = new AbortController()
  // The ceiling is deliberately tiny so the test stays fast; the wait below
  // is long enough that a slow machine cannot miss the timer.
  const guard = createDesktopDownloadGuard(controller, { maxWaitMs: 20, stallMs: 10_000 })
  await delay(150)
  assert.equal(guard.state.reason, 'TIMEOUT')
  assert.equal(controller.signal.aborted, true)
  guard.stop()
})

test('the desktop download guard aborts when the link stalls', async () => {
  const { createDesktopDownloadGuard } = loadDesktopApi()
  const controller = new AbortController()
  // The stall window is tiny and the ceiling far away, so only the stall
  // guard can fire.
  const guard = createDesktopDownloadGuard(controller, { maxWaitMs: 10_000, stallMs: 20 })
  await delay(150)
  assert.equal(guard.state.reason, 'STALLED')
  assert.equal(controller.signal.aborted, true)
  guard.stop()
})

test('progress keeps the desktop download guard alive', async () => {
  const { createDesktopDownloadGuard } = loadDesktopApi()
  const controller = new AbortController()
  // The progress interval is far below the stall window and the whole run far
  // below the ceiling, so a slow machine cannot trip either guard.
  const guard = createDesktopDownloadGuard(controller, { maxWaitMs: 10_000, stallMs: 1_000 })
  for (let index = 0; index < 5; index += 1) {
    await delay(30)
    guard.progress(1024)
  }
  assert.equal(guard.state.reason, null)
  assert.equal(controller.signal.aborted, false)
  guard.stop()
})

test('stopping the desktop download guard disarms both timers', async () => {
  const { createDesktopDownloadGuard } = loadDesktopApi()
  const controller = new AbortController()
  const guard = createDesktopDownloadGuard(controller, { maxWaitMs: 20, stallMs: 20 })
  guard.stop()
  await delay(150)
  assert.equal(guard.state.reason, null)
  assert.equal(controller.signal.aborted, false)
})

test('the desktop download guard accumulates the downloaded bytes', () => {
  const { createDesktopDownloadGuard } = loadDesktopApi()
  const controller = new AbortController()
  const guard = createDesktopDownloadGuard(controller, { maxWaitMs: 10_000, stallMs: 10_000 })
  guard.progress(1024)
  guard.progress(512)
  assert.equal(guard.state.bytes, 1536)
  assert.equal(guard.state.reason, null)
  guard.stop()
})

test('fetchDesktopCatalogDocument reports a timeout code instead of a raw DOMException', async () => {
  const { fetchDesktopCatalogDocument } = loadDesktopApi({
    fetch: createAbortingFetch(),
    DESKTOP_CATALOG_DOWNLOAD_TIMEOUT_MS: 20,
    DESKTOP_DOWNLOAD_STALL_MS: 10_000,
  })
  await assert.rejects(fetchDesktopCatalogDocument(), error => {
    assert.ok(error instanceof Error, 'the failure must be a real Error, not a raw DOMException')
    assert.ok(!(error instanceof DOMException), 'the raw DOMException must not leak out')
    assert.equal(error.code, 'DESKTOP_CATALOG_TIMEOUT')
    assert.notEqual(error.code, 'DESKTOP_OPERATION_FAILED')
    return true
  })
})

test('fetchDesktopCatalogDocument reports a stall code instead of a raw DOMException', async () => {
  const { fetchDesktopCatalogDocument } = loadDesktopApi({
    fetch: createAbortingFetch(),
    DESKTOP_CATALOG_DOWNLOAD_TIMEOUT_MS: 10_000,
    DESKTOP_DOWNLOAD_STALL_MS: 20,
  })
  await assert.rejects(fetchDesktopCatalogDocument(), error => {
    assert.ok(error instanceof Error, 'the failure must be a real Error, not a raw DOMException')
    assert.ok(!(error instanceof DOMException), 'the raw DOMException must not leak out')
    assert.equal(error.code, 'DESKTOP_CATALOG_STALLED')
    assert.notEqual(error.code, 'DESKTOP_OPERATION_FAILED')
    return true
  })
})

test('fetchDesktopCatalogDocument still parses a catalog document', async () => {
  const document = {
    schemaVersion: 1,
    registry: { repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store', categories: {} },
    entries: [],
  }
  const { fetchDesktopCatalogDocument, DESKTOP_CATALOG_SOURCES } = loadDesktopApi({
    fetch: async (url) => createCatalogResponse(JSON.stringify(document), url),
  })
  const result = await fetchDesktopCatalogDocument()
  // The current bundle hands the caller both the document and the delivery
  // source that answered, so the panel can report which mirror served it.
  assert.deepEqual(result.document, document)
  assert.equal(result.deliverySource, DESKTOP_CATALOG_SOURCES[0].id)
})

test('fetchDesktopCatalogDocument falls through to the next source after a recoverable failure', async () => {
  const document = {
    schemaVersion: 1,
    registry: { repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store', categories: {} },
    entries: [],
  }
  let responder = () => { throw new Error('unexpected fetch') }
  const fetch = createRecordingFetch((url) => responder(url))
  const api = loadDesktopApi({ fetch })
  const [first, second] = api.DESKTOP_CATALOG_SOURCES
  assert.ok(first && second, 'the bundle must declare more than one Catalog delivery source')

  // The first mirror answers with an HTTP failure, which is recoverable, so
  // the document must be read from the second mirror instead of failing.
  responder = (url) => (url === first.url
    ? { ok: false, status: 503, url, headers: { get: () => null } }
    : JSON.stringify(document))

  const result = await api.fetchDesktopCatalogDocument()
  assert.deepEqual(result.document, document)
  assert.equal(result.deliverySource, second.id)
  assert.equal(fetch.calls.length, 2, 'the failed mirror must be retried on the next source')
  assert.equal(fetch.calls[0].url, first.url)
  assert.equal(fetch.calls[1].url, second.url)
  for (const call of fetch.calls) {
    assert.equal(call.cache, 'no-store', 'the fresh Catalog must never come from a stale HTTP cache entry')
  }
})

test('fetchDesktopCatalogDocument does not retry a failure that is not recoverable', async () => {
  let responder = () => { throw new Error('unexpected fetch') }
  const fetch = createRecordingFetch((url) => responder(url))
  const api = loadDesktopApi({ fetch })

  // A corrupt document is a hard failure: the second mirror would serve the
  // same corrupt document, so the download must fail immediately.
  responder = () => '{ not json'

  await assert.rejects(api.fetchDesktopCatalogDocument(), error => {
    assert.equal(error.code, 'DESKTOP_CATALOG_JSON_INVALID')
    return true
  })
  assert.equal(fetch.calls.length, 1, 'a corrupt document must not be retried on the next source')
})

test('the shipped download budgets are sized for the published documents', () => {
  // The Catalog document is ~247 KB gzip and the official discovery index
  // ~2.5 MB gzip. On a ~15-20 KB/s link the Catalog needs ~12-17 s and the
  // discovery index ~130-175 s, so a 12 s / 45 s budget aborts a healthy link.
  assert.ok(readConstant('DESKTOP_CATALOG_DOWNLOAD_TIMEOUT_MS') >= 60_000,
    'the catalog document download budget must outlast a slow but healthy link')
  assert.ok(readConstant('DESKTOP_DISCOVERY_TIMEOUT_MS') >= 180_000,
    'the discovery index download budget must outlast a slow but healthy link')
  assert.ok(readConstant('DESKTOP_DOWNLOAD_STALL_MS') >= 10_000,
    'the stall guard must tolerate a slow but healthy link')
})
