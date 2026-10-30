import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { resolveHostOptions } from '../src/index.mjs'
import { createRuntimeStatus } from '../src/runtime.mjs'
import {
  handleExecuteRequest, handleGuardianExecuteRequest, handleGuardianPlanRequest,
  handleGuardianRequest, handleInventoryRequest, handlePlanRequest,
  handleRestartExecuteRequest, handleRestartPlanRequest, handleRuntimeRequest,
} from '../src/panel.mjs'

function request(body = {}, intent = null) {
  const req = Readable.from([JSON.stringify(body)])
  req.method = 'POST'
  req.headers = {
    host: '127.0.0.1:40000', origin: 'http://127.0.0.1:40000',
    'content-type': 'application/json',
    ...(intent ? { 'x-dsh-safe-intent': intent } : {}),
  }
  return req
}

function response() {
  return {
    status: null, body: '',
    writeHead(status) { this.status = status },
    end(value = '') { this.body += String(value) },
  }
}

test('official Desktop context binds inventory to Desktop and disables Store mutations', () => {
  const ctx = { profileContext: { name: 'desktop', home: '/disposable/dsh-home', installAnchor: '/disposable/runtime/package.json' } }
  const options = resolveHostOptions(ctx, { defaultProfile: 'web', dshHome: '/wrong-home', mutationsEnabled: true })
  assert.equal(options.defaultProfile, 'desktop')
  assert.equal(options.dshHome, ctx.profileContext.home)
  assert.equal(options.dshManifestPath, ctx.profileContext.installAnchor)
  assert.equal(options.mutationsEnabled, false)
  assert.equal(options.desktopMode, true)
  assert.equal(options.dshCliPath, null)
  const runtime = createRuntimeStatus({ profile: 'desktop', desktopMode: true, restartCommand: [] })
  assert.equal(runtime.restartSupported, false)
  assert.equal(runtime.restartMode, 'official-desktop')
  assert.deepEqual(runtime.restartCommand, [])
})

test('Desktop rejects every Store write endpoint before calling a mutation service', async () => {
  const forbidden = () => { throw new Error('mutation service must not run') }
  const options = {
    desktopMode: true,
    operationService: { createPlan: forbidden, start: forbidden },
    restartService: { createPlan: forbidden, execute: forbidden },
    guardianService: { createInstallPlan: forbidden, executeInstall: forbidden },
  }
  const endpoints = [
    [handlePlanRequest, 'plan'], [handleExecuteRequest, 'execute'],
    [handleRestartPlanRequest, 'restart-plan'], [handleRestartExecuteRequest, 'restart-execute'],
    [handleGuardianPlanRequest, 'guardian-plan'], [handleGuardianExecuteRequest, 'guardian-execute'],
  ]
  for (const [handler, intent] of endpoints) {
    const res = response()
    await handler(request({ profile: 'web' }, intent), res, options)
    assert.equal(res.status, 409)
    assert.equal(JSON.parse(res.body).error.code, 'DESKTOP_MUTATION_UNSUPPORTED')
  }
})

test('Desktop inventory reads its own Profile and refuses a forged Web Profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-store-desktop-'))
  try {
    const dir = join(root, 'profiles', 'desktop')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'fixture-desktop', dependencies: {}, dsh: { profile: { bundles: [] } },
    }))
    const options = { desktopMode: true, defaultProfile: 'desktop', dshHome: root }
    const ok = response()
    await handleInventoryRequest(request(), ok, options)
    assert.equal(ok.status, 200)
    assert.equal(JSON.parse(ok.body).value.profile, 'desktop')
    const denied = response()
    await handleInventoryRequest(request({ profile: 'web' }), denied, options)
    assert.equal(denied.status, 409)
    const runtime = response()
    await handleRuntimeRequest(request({ profile: 'web' }), runtime, {
      ...options, runtimeStatus: createRuntimeStatus({ profile: 'desktop', desktopMode: true }),
    })
    assert.equal(JSON.parse(runtime.body).error.code, 'DESKTOP_PROFILE_MISMATCH')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Desktop Guardian status reports official ownership without probing launchd', async () => {
  const res = response()
  await handleGuardianRequest(request(), res, { desktopMode: true, guardianService: { status: () => { throw new Error('must not probe') } } })
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.body).value.errorCode, 'OFFICIAL_DESKTOP_OWNS_HOST')
})

const desktopCatalogUrl = 'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/catalog.json'
const desktopCommit = 'a'.repeat(40)

function desktopEntry({ id, packageName, commit, compatibility = 'compatible', profiles = ['desktop'] }) {
  return {
    id, name: id === 'dsh-safe-plugin-manager' ? '安全插件商城（DSH-Store）' : `Name ${id}`,
    packageName, description: `Description for ${id}`,
    repositoryUrl: `https://github.com/acme/${id}`, commit, version: '1.2.3',
    source: { provenance: 'github-commit', updatedAt: '2026-10-30T00:00:00Z' },
    installPath: null, manifestPath: 'package.json', entryIds: [id], categories: ['tools'],
    searchTerms: [id], status: 'approved',
    compatibility: { dshReleases: { '0.2.2-alpha.2': compatibility }, profiles },
    details: {
      license: 'MIT', externalDependencies: [],
      permissions: { level: 'low', files: 'none', network: 'none', commands: 'none', credentials: ['none'] },
    },
    risk: { installScripts: [] },
  }
}

function desktopCatalog(entries) {
  return {
    schemaVersion: 1,
    registry: {
      repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store',
      categories: { tools: '工具' }, updatedAt: '2026-10-30T00:00:00Z',
    },
    entries,
  }
}

function createDesktopHarness({ catalog, installed = [], responseFactory } = {}) {
  const sourcePromise = readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const settingsRegistrations = []
  const injections = []
  const requests = []
  const timerCallbacks = []
  const calls = { listBundles: 0, inspect: [], installBundle: [], waitForInstall: [] }
  const componentRecords = new Map()
  let activeComponent = null
  let panel
  let installedBundles = installed
  let nextTimer = 0

  const recordFor = component => {
    if (!componentRecords.has(component)) componentRecords.set(component, { states: [], refs: [], effects: [], cursor: 0 })
    return componentRecords.get(component)
  }
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const values = children.length === 1 ? children[0] : children
      return { type, props: { ...(props || {}), ...(children.length ? { children: values } : {}) }, children }
    },
    useCallback(callback) { activeComponent.cursor++; return callback },
    useEffect(effect) {
      const record = activeComponent
      const index = record.cursor++
      if (!record.effects[index]) record.effects[index] = { effect, cleanup: null, ran: false }
    },
    useMemo(factory) { activeComponent.cursor++; return factory() },
    useRef(initial) {
      const record = activeComponent
      const index = record.cursor++
      if (!(index in record.refs)) record.refs[index] = { current: initial }
      return record.refs[index]
    },
    useState(initial) {
      const record = activeComponent
      const index = record.cursor++
      if (!(index in record.states)) record.states[index] = typeof initial === 'function' ? initial() : initial
      return [record.states[index], value => { record.states[index] = typeof value === 'function' ? value(record.states[index]) : value }]
    },
  }
  const Modal = props => React.createElement('div', { role: 'dialog' }, props.children, props.footer)
  const withComponent = (component, props = {}) => {
    const previous = activeComponent
    const record = recordFor(component)
    record.cursor = 0
    activeComponent = record
    try { return component(props) } finally { activeComponent = previous }
  }
  const resolveTree = value => {
    if (Array.isArray(value)) return value.map(resolveTree)
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'type')) return value
    if (typeof value.type === 'function') return resolveTree(withComponent(value.type, value.props))
    return { type: value.type, props: value.props, children: resolveTree(value.children) }
  }
  const manager = {
    async listBundles() {
      calls.listBundles++
      return [
        { name: 'dsh.desktop-runtime', official: true, installTarget: { version: '0.2.2-alpha.2' }, installed: true },
        ...installedBundles,
      ]
    },
    async inspect(spec) { calls.inspect.push(spec); return { status: 'accepted', kind: 'git' } },
    async installBundle(spec, options) {
      calls.installBundle.push({ spec, options })
      installedBundles = [...installedBundles, { name: '@acme/dsh-installable', official: false, installed: true }]
      return { application: 'applied', changed: true, stage: 'install', target: spec }
    },
    async waitForInstall(requestId) { calls.waitForInstall.push(requestId); return null },
  }
  const fetch = async (url, options) => {
    requests.push({ url, options })
    if (responseFactory) return responseFactory()
    const bytes = new TextEncoder().encode(JSON.stringify(catalog))
    let offset = 0
    return {
      ok: true, url,
      headers: { get: name => name === 'content-length' ? String(bytes.byteLength) : null },
      body: { getReader: () => ({
        async read() {
          if (offset >= bytes.byteLength) return { done: true }
          const value = bytes.subarray(offset, Math.min(offset + 4096, bytes.byteLength))
          offset += value.byteLength
          return { done: false, value }
        },
        async cancel() {}, releaseLock() {},
      }) },
    }
  }
  const window = {
    location: { protocol: 'dsh-app:', origin: 'dsh-app://app', href: 'dsh-app://app/settings' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    setTimeout: callback => { timerCallbacks.push(callback); return ++nextTimer },
    clearTimeout: () => {},
    __ModuleLoader__: { load({ factory }) {
      const plugin = factory(name => name === 'react' ? React : ({ Modal }))
      plugin.apply({
        remote: { pluginManager: manager },
        inject(paths, callback) { injections.push(paths); callback() },
        slots: {
          inject(slot, register) { settingsRegistrations.push({ slot }); register() },
          register(metadata, component) { settingsRegistrations.at(-1).metadata = metadata; panel = component },
        },
      })
    } },
  }
  const ready = sourcePromise.then(source => runInNewContext(source, {
    window, fetch, URL, AbortController, TextDecoder, TextEncoder, Uint8Array,
  }))
  const render = async () => {
    await ready
    return resolveTree(withComponent(panel))
  }
  const runEffects = async component => {
    await ready
    const effects = recordFor(component).effects
    for (const record of effects) {
      if (!record || record.ran) continue
      record.ran = true
      record.cleanup = record.effect()
    }
  }
  return { ready, render, runEffects,
    getComponent: name => [...componentRecords.keys()].find(component => component.name === name),
    settingsRegistrations, injections, requests, calls, timerCallbacks,
    setInstalled: value => { installedBundles = value } }
}

function desktopNodes(tree) {
  const result = []
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    result.push(value)
    visit(value.children)
  }
  visit(tree)
  return result
}

function desktopText(tree) {
  const output = []
  const visit = value => {
    if (typeof value === 'string' || typeof value === 'number') { output.push(String(value)); return }
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (value && typeof value === 'object') visit(value.children)
  }
  visit(tree)
  return output.join(' ')
}

async function waitForDesktopTree(harness, predicate) {
  let tree
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(resolve => setImmediate(resolve))
    tree = await harness.render()
    if (predicate(tree)) return tree
  }
  return tree
}

test('official Desktop registers DSH-Store as a separate Settings section and loads the Catalog', async () => {
  const entry = desktopEntry({ id: 'dsh-installed', packageName: '@acme/dsh-installed', commit: 'b'.repeat(40) })
  const harness = createDesktopHarness({
    catalog: desktopCatalog([
      entry,
      desktopEntry({ id: 'dsh-installable', packageName: '@acme/dsh-installable', commit: desktopCommit }),
      desktopEntry({ id: 'dsh-incompatible', packageName: '@acme/dsh-incompatible', commit: 'c'.repeat(40), compatibility: 'incompatible' }),
      desktopEntry({ id: 'dsh-unknown', packageName: '@acme/dsh-unknown', commit: 'e'.repeat(40), compatibility: 'unknown' }),
      desktopEntry({ id: 'dsh-web-only', packageName: '@acme/dsh-web-only', commit: 'f'.repeat(40), profiles: ['web'] }),
      desktopEntry({ id: 'dsh-safe-plugin-manager', packageName: 'dsh-safe-plugin-manager', commit: 'd'.repeat(40), profiles: ['web'] }),
    ]),
    installed: [{ name: '@acme/dsh-installed', official: false, installed: true }],
  })
  await harness.ready
  assert.equal(harness.settingsRegistrations.length, 1)
  assert.equal(harness.settingsRegistrations[0].slot, 'settings.section')
  assert.equal(harness.settingsRegistrations[0].metadata.id, 'dsh-store')
  assert.equal(harness.settingsRegistrations[0].metadata.label(), 'DSH-Store')
  assert.equal(JSON.stringify(harness.injections[0]), '["remote","remote.pluginManager"]')

  const initial = await harness.render()
  const desktopPanel = harness.getComponent('DesktopStorePanel')
  assert.equal(typeof desktopPanel, 'function')
  await harness.runEffects(desktopPanel)
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Name dsh-installable'))
  const text = desktopText(tree)
  assert.match(text, /DSH-Store/)
  assert.match(text, /Name dsh-installed.*已安装|已安装.*Name dsh-installed/)
  assert.match(text, /不兼容 DSH 0\.2\.2-alpha\.2/)
  assert.match(text, /当前 DSH 兼容性未确认/)
  assert.match(text, /声明支持 Desktop 4 个/)
  assert.match(text, /Catalog 未声明支持 Desktop/)
  assert.ok(desktopNodes(initial).length > 0)
  assert.equal(harness.calls.listBundles, 1)
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.requests[0].url, desktopCatalogUrl)
  assert.equal(harness.requests[0].options.redirect, 'error')
  assert.equal(desktopNodes(tree).some(node => node.type === 'button' && node.children?.includes('安装')), true)
  const installedCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('@acme/dsh-installed'))
  const incompatibleCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('@acme/dsh-incompatible'))
  const unknownCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('@acme/dsh-unknown'))
  const webOnlyCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('@acme/dsh-web-only'))
  assert.ok(installedCard)
  assert.ok(incompatibleCard)
  assert.ok(unknownCard)
  assert.ok(webOnlyCard)
  assert.equal(desktopNodes(installedCard).some(node => node.type === 'button' && node.children?.includes('安装')), false)
  assert.equal(desktopNodes(incompatibleCard).some(node => node.type === 'button' && node.children?.includes('安装')), false)
  assert.equal(desktopNodes(unknownCard).some(node => node.type === 'button' && node.children?.includes('安装')), false)
  assert.equal(desktopNodes(webOnlyCard).some(node => node.type === 'button' && node.children?.includes('安装')), false)
})

test('official Desktop requires the full package and Commit confirmation before using the DSH installer', async () => {
  const harness = createDesktopHarness({
    catalog: desktopCatalog([desktopEntry({ id: 'dsh-installable', packageName: '@acme/dsh-installable', commit: desktopCommit })]),
  })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Name dsh-installable'))
  const installButton = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('安装'))
  assert.ok(installButton)
  installButton.props.onClick()
  tree = await harness.render()
  const expected = `INSTALL @acme/dsh-installable ${desktopCommit}`
  assert.ok(desktopText(tree).includes(expected))
  let confirmationInput = desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === expected)
  assert.ok(confirmationInput)
  let confirmButton = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  assert.equal(confirmButton.props.disabled, true)
  confirmationInput.props.onChange({ target: { value: `INSTALL @acme/dsh-installable ${desktopCommit.slice(0, 12)}` } })
  tree = await harness.render()
  confirmButton = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  assert.equal(confirmButton.props.disabled, true)
  assert.equal(harness.calls.installBundle.length, 0)

  confirmationInput = desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === expected)
  confirmationInput.props.onChange({ target: { value: expected } })
  tree = await harness.render()
  confirmButton = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  assert.equal(confirmButton.props.disabled, false)
  await confirmButton.props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方安装器已完成'))
  assert.equal(harness.calls.inspect.length, 1)
  assert.equal(harness.calls.inspect[0], `git+https://github.com/acme/dsh-installable.git#${desktopCommit}`)
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.installBundle[0].spec, harness.calls.inspect[0])
  assert.equal(harness.calls.installBundle[0].options.enabled, true)
  assert.equal(harness.calls.installBundle[0].options.requestId, '11111111-1111-4111-8111-111111111111')
  assert.equal(Object.hasOwn(harness.calls.installBundle[0].options, 'approvedBuilds'), false)
  assert.equal(harness.calls.waitForInstall.length, 0)
  assert.equal(harness.requests.every(item => item.url === desktopCatalogUrl), true)
  assert.match(desktopText(tree), /已安装/)
})

test('official Desktop fails closed for malformed Catalog data and oversized response headers', async () => {
  const malformed = desktopEntry({ id: 'bad-entry', packageName: '@acme/bad-entry', commit: desktopCommit })
  malformed.categories = 'tools'
  const malformedHarness = createDesktopHarness({ catalog: desktopCatalog([malformed]) })
  await malformedHarness.ready
  await malformedHarness.render()
  await malformedHarness.runEffects(malformedHarness.getComponent('DesktopStorePanel'))
  const malformedTree = await waitForDesktopTree(malformedHarness, value => desktopText(value).includes('CATALOG_ENTRY_0_CATEGORIES_INVALID'))
  assert.match(desktopText(malformedTree), /CATALOG_ENTRY_0_CATEGORIES_INVALID/)
  assert.equal(desktopNodes(malformedTree).some(node => node.type === 'button' && node.children?.includes('安装')), false)

  const missingProfiles = desktopEntry({ id: 'missing-profiles', packageName: '@acme/missing-profiles', commit: desktopCommit })
  missingProfiles.compatibility.profiles = null
  const missingProfilesHarness = createDesktopHarness({ catalog: desktopCatalog([missingProfiles]) })
  await missingProfilesHarness.ready
  await missingProfilesHarness.render()
  await missingProfilesHarness.runEffects(missingProfilesHarness.getComponent('DesktopStorePanel'))
  const profilesTree = await waitForDesktopTree(missingProfilesHarness, value => desktopText(value).includes('CATALOG_ENTRY_0_PROFILES_INVALID'))
  assert.match(desktopText(profilesTree), /CATALOG_ENTRY_0_PROFILES_INVALID/)
  assert.equal(desktopNodes(profilesTree).some(node => node.type === 'button' && node.children?.includes('安装')), false)

  const oversizedHarness = createDesktopHarness({
    responseFactory: async () => ({ ok: true, url: desktopCatalogUrl,
      headers: { get: name => name === 'content-length' ? String(4 * 1024 * 1024 + 1) : null },
      body: { getReader: () => { throw new Error('must reject before reading') } },
    }),
  })
  await oversizedHarness.ready
  await oversizedHarness.render()
  await oversizedHarness.runEffects(oversizedHarness.getComponent('DesktopStorePanel'))
  const oversizedTree = await waitForDesktopTree(oversizedHarness, value => desktopText(value).includes('DESKTOP_CATALOG_TOO_LARGE'))
  assert.match(desktopText(oversizedTree), /DESKTOP_CATALOG_TOO_LARGE/)
  assert.equal(oversizedHarness.calls.listBundles, 1)
  assert.equal(desktopNodes(oversizedTree).some(node => node.type === 'button' && node.children?.includes('安装')), false)
})

test('current trusted Registry Catalog is accepted by the Desktop reader', async () => {
  const catalog = JSON.parse(await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8'))
  const expectedApproved = catalog.entries.filter(entry => entry.status === 'approved').length
  const harness = createDesktopHarness({ catalog })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes(`已审核插件 ${expectedApproved} 个`))
  assert.match(desktopText(tree), new RegExp(`已审核插件 ${expectedApproved} 个`))
  const expectedDesktop = catalog.entries.filter(entry => entry.status === 'approved' && entry.compatibility.profiles.includes('desktop')).length
  assert.match(desktopText(tree), new RegExp(`声明支持 Desktop ${expectedDesktop} 个`))
  assert.equal(harness.requests[0].url, desktopCatalogUrl)
})
