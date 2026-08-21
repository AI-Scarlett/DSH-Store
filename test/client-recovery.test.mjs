import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const CHANNEL_NAME = 'dsh-safe-plugin-manager:boot-recovery:v1'
const TAB_BOOT_KEY = 'dsh-safe-plugin-manager:tab-boot:v1'
const NAVIGATED_BOOT_KEY = 'dsh-safe-plugin-manager:last-recovered-boot:v1'

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)) }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

class FakeClock {
  constructor() {
    this.now = 0
    this.nextId = 1
    this.timers = new Map()
  }

  setTimeout = (callback, delay = 0) => {
    const id = this.nextId++
    this.timers.set(id, { at: this.now + Number(delay), callback })
    return id
  }

  clearTimeout = id => { this.timers.delete(id) }

  async runNext() {
    const next = [...this.timers.entries()].sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
    assert.ok(next, 'expected a scheduled recovery check')
    const [id, timer] = next
    this.timers.delete(id)
    this.now = timer.at
    await timer.callback()
  }

  async run(count) {
    for (let index = 0; index < count; index += 1) await this.runNext()
  }
}

function createBroadcastChannelClass() {
  const groups = new Map()
  return class BroadcastChannelMock {
    constructor(name) {
      this.name = name
      this.listeners = new Set()
      if (!groups.has(name)) groups.set(name, new Set())
      groups.get(name).add(this)
    }

    addEventListener(type, listener) {
      if (type === 'message') this.listeners.add(listener)
    }

    removeEventListener(type, listener) {
      if (type === 'message') this.listeners.delete(listener)
    }

    postMessage(data) {
      for (const peer of groups.get(this.name) || []) {
        if (peer === this) continue
        for (const listener of peer.listeners) listener({ data })
      }
    }

    close() { groups.get(this.name)?.delete(this) }
  }
}

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, value }),
  }
}

function htmlResponse(ready) {
  return {
    ok: ready,
    status: ready ? 200 : 503,
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
    text: async () => ready ? '<!doctype html><html><body>DSH</body></html>' : 'unavailable',
  }
}

function createRuntimeState() {
  return {
    bootId: 'boot-old-0001',
    guardianState: 'healthy',
    guardianAvailable: true,
    rootReady: true,
    runtimeFailures: 0,
  }
}

function createFetch(state) {
  return async input => {
    const url = String(input)
    if (url === '/api2/dsh-safe-plugin-manager/runtime') {
      if (state.runtimeFailures > 0) {
        state.runtimeFailures -= 1
        throw new TypeError('transient disconnect')
      }
      return jsonResponse({ schemaVersion: 1, bootId: state.bootId, profile: 'web' })
    }
    if (url === '/api2/dsh-safe-plugin-manager/guardian') {
      return jsonResponse({
        schemaVersion: 1,
        available: state.guardianAvailable,
        state: state.guardianState,
        owner: 'guardian',
        heartbeatFresh: true,
        profile: 'web',
        health: { bootId: state.bootId },
      })
    }
    if (url.startsWith('http://127.0.0.1:3080/?dshBootProbe=')) return htmlResponse(state.rootReady)
    throw new Error(`unexpected fetch: ${url}`)
  }
}

function loadClient({ state, BroadcastChannel, initialSession = {} }) {
  const clock = new FakeClock()
  const sessionStorage = new MemoryStorage(initialSession)
  const localStorage = new MemoryStorage()
  const replacements = []
  const onlineListeners = new Set()
  let descriptor = null
  const location = {
    href: 'http://127.0.0.1:3080/?fresh=test',
    origin: 'http://127.0.0.1:3080',
    replace(value) {
      replacements.push(value)
      this.href = value
    },
  }
  const window = {
    __ModuleLoader__: { load(value) { descriptor = value } },
    sessionStorage,
    localStorage,
    location,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    AbortController,
    BroadcastChannel,
    addEventListener(type, listener) { if (type === 'online') onlineListeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'online') onlineListeners.delete(listener) },
  }
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: () => null,
    useCallback: value => value,
    useEffect: () => {},
    useMemo: value => value(),
    useRef: value => ({ current: value }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
  }
  const fetch = createFetch(state)
  const context = vm.createContext({
    window,
    fetch,
    URL,
    Date: { now: () => clock.now },
    console,
  })
  vm.runInContext(clientSource, context, { filename: 'src/client.js' })
  assert.ok(descriptor)
  const plugin = descriptor.factory(name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Modal: () => null }
    throw new Error(`unexpected require: ${name}`)
  })
  const disposers = []
  plugin.apply({
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    slots: { inject: () => () => {}, register: () => () => {} },
  })
  return {
    clock,
    sessionStorage,
    replacements,
    close() { for (const dispose of disposers.reverse()) dispose() },
  }
}

test('boot recovery waits for Guardian healthy stability before replacing the page', async () => {
  const state = createRuntimeState()
  const BroadcastChannel = createBroadcastChannelClass()
  const tab = loadClient({ state, BroadcastChannel })
  await tab.clock.runNext()
  assert.equal(tab.sessionStorage.getItem(TAB_BOOT_KEY), 'boot-old-0001')

  state.bootId = 'boot-new-0002'
  state.guardianState = 'health-checking'
  await tab.clock.run(2)
  assert.deepEqual(tab.replacements, [])

  state.guardianState = 'healthy'
  await tab.clock.run(3)
  assert.equal(tab.replacements.length, 1)
  assert.match(tab.replacements[0], /dshBoot=boot-new-0002/)
  assert.match(tab.replacements[0], /recovered=1/)
  assert.equal(tab.sessionStorage.getItem(TAB_BOOT_KEY), 'boot-new-0002')
  assert.equal(tab.sessionStorage.getItem(NAVIGATED_BOOT_KEY), 'boot-new-0002')
  tab.close()
})

test('polling fallback survives transient disconnect on the same Boot ID without reloading', async () => {
  const state = createRuntimeState()
  const tab = loadClient({ state, BroadcastChannel: undefined })
  await tab.clock.runNext()
  state.runtimeFailures = 2
  await tab.clock.run(3)
  assert.deepEqual(tab.replacements, [])
  assert.equal(tab.sessionStorage.getItem(TAB_BOOT_KEY), 'boot-old-0001')
  tab.close()
})

test('the per-Boot loop guard accepts an already recovered Boot without another navigation', async () => {
  const state = createRuntimeState()
  state.bootId = 'boot-new-0002'
  const tab = loadClient({
    state,
    BroadcastChannel: createBroadcastChannelClass(),
    initialSession: {
      [TAB_BOOT_KEY]: 'boot-old-0001',
      [NAVIGATED_BOOT_KEY]: 'boot-new-0002',
    },
  })
  await tab.clock.run(3)
  assert.deepEqual(tab.replacements, [])
  assert.equal(tab.sessionStorage.getItem(TAB_BOOT_KEY), 'boot-new-0002')
  tab.close()
})

test('BroadcastChannel restart notice recovers every open tab', async () => {
  const state = createRuntimeState()
  const BroadcastChannel = createBroadcastChannelClass()
  const first = loadClient({ state, BroadcastChannel })
  const second = loadClient({ state, BroadcastChannel })
  await first.clock.runNext()
  await second.clock.runNext()

  state.bootId = 'boot-new-0002'
  const coordinator = new BroadcastChannel(CHANNEL_NAME)
  coordinator.postMessage({ schemaVersion: 1, type: 'restart-pending', previousBootId: 'boot-old-0001' })
  await first.clock.run(3)
  await second.clock.run(3)

  assert.equal(first.replacements.length, 1)
  assert.equal(second.replacements.length, 1)
  assert.match(first.replacements[0], /dshBoot=boot-new-0002/)
  assert.match(second.replacements[0], /dshBoot=boot-new-0002/)
  coordinator.close()
  first.close()
  second.close()
})

test('disposing the client Boot Guard removes scheduled checks', () => {
  const state = createRuntimeState()
  const tab = loadClient({ state, BroadcastChannel: createBroadcastChannelClass() })
  assert.ok(tab.clock.timers.size > 0)
  tab.close()
  assert.equal(tab.clock.timers.size, 0)
})
