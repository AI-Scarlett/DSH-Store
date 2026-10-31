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
  const moduleDependencies = []
  const requests = []
  const timerCallbacks = []
  const calls = { listBundles: 0, inspect: [], installBundle: [], removeBundle: [], setBundleEnabled: [], waitForInstall: [] }
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
  const Modal = props => React.createElement('div', { role: 'dialog', 'aria-label': props.title }, props.title, props.children, props.footer)
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
      const entry = catalog.entries.find(item => spec.startsWith(`git+${item.repositoryUrl}.git#`))
      installedBundles = [...installedBundles.filter(bundle => bundle.name !== entry?.packageName), {
        name: entry?.packageName || '@acme/dsh-installable', official: false, installed: true,
        removable: true, enabled: options.enabled, version: entry?.version, source: spec,
      }]
      return { application: 'applied', changed: true, stage: 'install', target: spec }
    },
    async removeBundle(name) {
      calls.removeBundle.push(name)
      installedBundles = installedBundles.filter(bundle => bundle.name !== name)
      return { application: 'applied', changed: true, stage: 'remove', target: name }
    },
    async setBundleEnabled(name, enabled) {
      calls.setBundleEnabled.push({ name, enabled })
      installedBundles = installedBundles.map(bundle => bundle.name === name ? { ...bundle, enabled } : bundle)
      return { application: 'applied', changed: true, stage: 'enable', target: name, enabled }
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
      moduleDependencies.push(...plugin.inject)
      const declaredDependencies = new Set(plugin.inject)
      plugin.apply({
        ...(declaredDependencies.has('remote') && declaredDependencies.has('remote.pluginManager')
          ? { remote: { pluginManager: manager } } : {}),
        inject(paths, callback) {
          injections.push(paths)
          if (paths.every(path => declaredDependencies.has(path))) callback()
        },
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
    settingsRegistrations, injections, moduleDependencies, requests, calls, timerCallbacks,
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

test('official Desktop registers 插件商城 and loads the Catalog with search and category filters', async () => {
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
    installed: [{ name: '@acme/dsh-installed', official: false, installed: true, removable: true, enabled: true,
      version: '1.0.0', source: `git+https://github.com/acme/dsh-installed.git#${'b'.repeat(40)}` }],
  })
  await harness.ready
  assert.equal(harness.settingsRegistrations.length, 1)
  assert.equal(harness.settingsRegistrations[0].slot, 'settings.section')
  assert.equal(harness.settingsRegistrations[0].metadata.id, 'dsh-store')
  assert.equal(harness.settingsRegistrations[0].metadata.label(), '插件商城')
  assert.deepEqual(harness.moduleDependencies, ['slots', 'remote', 'remote.pluginManager'])
  assert.equal(JSON.stringify(harness.injections[0]), '["remote","remote.pluginManager"]')

  const initial = await harness.render()
  const desktopPanel = harness.getComponent('DesktopStorePanel')
  assert.equal(typeof desktopPanel, 'function')
  await harness.runEffects(desktopPanel)
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Name dsh-installable'))
  const text = desktopText(tree)
  assert.match(text, /DSH-Store/)
  assert.match(text, /插件商城（DSH-Store）/)
  assert.match(text, /DSH Desktop 客户端：已声明适配/)
  assert.match(text, /DSH Desktop 客户端：未声明适配/)
  assert.match(text, /Name dsh-installed.*已启动|已启动.*Name dsh-installed/)
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
  for (const label of ['关闭', '卸载', '查看详情']) {
    assert.equal(desktopNodes(installedCard).some(node => node.type === 'button' && node.children?.includes(label)), true, `${label} is available for a matching installed third-party bundle`)
  }
  assert.equal(desktopNodes(installedCard).some(node => node.type === 'button' && node.children?.includes('安装')), false)
  assert.equal(desktopNodes(incompatibleCard).some(node => node.type === 'button' && node.children?.includes('安装')), false)
  assert.equal(desktopNodes(unknownCard).some(node => node.type === 'button' && node.children?.includes('安装')), false)
  assert.equal(desktopNodes(webOnlyCard).some(node => node.type === 'button' && node.children?.includes('安装')), false)
  const storeCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('dsh-safe-plugin-manager'))
  assert.ok(storeCard)
  assert.equal(desktopNodes(storeCard).some(node => node.type === 'button' && ['启动', '关闭', '卸载'].some(label => node.children?.includes(label))), false)

  const detailButton = desktopNodes(installedCard).find(node => node.type === 'button' && node.children?.includes('查看详情'))
  detailButton.props.onClick()
  const detailTree = await harness.render()
  assert.match(desktopText(detailTree), /Name dsh-installed · 插件详情/)
  assert.match(desktopText(detailTree), /GitHub 仓库：https:\/\/github\.com\/acme\/dsh-installed/)
  assert.match(desktopText(detailTree), /权限 low/)

  const search = desktopNodes(detailTree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索插件')
  assert.ok(search)
  search.props.onChange({ target: { value: 'dsh-web-only' } })
  const searchedTree = await harness.render()
  assert.equal(desktopNodes(searchedTree).filter(node => node.type === 'article').length, 1)
  assert.match(desktopText(searchedTree), /Name dsh-web-only/)
  assert.ok(desktopNodes(searchedTree).some(node => node.type === 'select' && node.props['aria-label'] === '按分类筛选'))
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
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方插件管理器已完成安装'))
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

test('official Desktop shows a disabled install action and reason when current DSH compatibility is unknown', async () => {
  const entry = desktopEntry({ id: 'dsh-unknown', packageName: '@acme/dsh-unknown', commit: desktopCommit, compatibility: 'unknown' })
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]) })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  const details = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('查看详情'))
  details.props.onClick()
  tree = await harness.render()
  assert.match(desktopText(tree), /安装已禁用：当前 DSH 版本兼容性未确认/)
  const install = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('安装'))
  assert.ok(install)
  assert.equal(install.props.disabled, true)
  assert.match(install.props.title, /当前 DSH 版本兼容性未确认/)
  assert.equal(install.props.onClick, undefined)
  assert.equal(harness.calls.installBundle.length, 0)
  assert.equal(harness.calls.removeBundle.length, 0)
  assert.equal(harness.calls.setBundleEnabled.length, 0)
})

test('official Desktop starts, closes, and uninstalls only the matching Catalog bundle through pluginManager', async () => {
  const entry = desktopEntry({ id: 'dsh-managed', packageName: '@acme/dsh-managed', commit: desktopCommit })
  const oldCommit = 'b'.repeat(40)
  const harness = createDesktopHarness({
    catalog: desktopCatalog([entry]),
    installed: [{ name: entry.packageName, official: false, installed: true, removable: true, enabled: true,
      version: '1.0.0', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }],
  })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Name dsh-managed'))
  const managedCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  assert.ok(managedCard)
  assert.equal(desktopNodes(managedCard).some(node => node.type === 'button' && node.children?.includes('更新')), false,
    'fixed GitHub Commit entries do not offer a registry-only update operation')

  const runConfirmed = async (buttonName, token, successText) => {
    const button = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes(buttonName))
    assert.ok(button, `${buttonName} button is available`)
    button.props.onClick()
    tree = await harness.render()
    assert.match(desktopText(tree), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const input = desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === token)
    assert.ok(input)
    input.props.onChange({ target: { value: token } })
    tree = await harness.render()
    const confirm = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并' + buttonName))
    assert.ok(confirm)
    await confirm.props.onClick()
    tree = await waitForDesktopTree(harness, value => desktopText(value).includes(successText))
  }

  await runConfirmed('关闭', `CLOSE ${entry.packageName} ${desktopCommit}`, 'DSH 官方插件管理器已完成关闭')
  assert.deepEqual(harness.calls.setBundleEnabled.at(-1), { name: entry.packageName, enabled: false })

  const finishClose = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('完成'))
  finishClose.props.onClick()
  tree = await harness.render()
  assert.ok(desktopNodes(tree).some(node => node.type === 'button' && node.children?.includes('启动')))
  await runConfirmed('启动', `START ${entry.packageName} ${desktopCommit}`, 'DSH 官方插件管理器已完成启动')
  assert.deepEqual(harness.calls.setBundleEnabled.at(-1), { name: entry.packageName, enabled: true })

  const finishStart = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('完成'))
  finishStart.props.onClick()
  tree = await harness.render()
  await runConfirmed('卸载', `REMOVE ${entry.packageName} ${desktopCommit}`, 'DSH 官方插件管理器已完成卸载')
  assert.deepEqual(harness.calls.removeBundle, [entry.packageName])
  assert.equal(harness.calls.installBundle.length, 0)
  assert.equal(harness.calls.setBundleEnabled.length, 2)
})

test('official Desktop hides lifecycle operations when an installed package source differs from the Catalog', async () => {
  const entry = desktopEntry({ id: 'dsh-source-mismatch', packageName: '@acme/dsh-source-mismatch', commit: desktopCommit })
  const harness = createDesktopHarness({
    catalog: desktopCatalog([entry]),
    installed: [{ name: entry.packageName, official: false, installed: true, removable: true, enabled: true,
      version: '1.0.0', source: `git+https://github.com/other-owner/other-repo.git#${'b'.repeat(40)}` }],
  })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Name dsh-source-mismatch'))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  assert.ok(card)
  assert.match(desktopText(card), /已安装来源与商城记录不一致/)
  assert.equal(desktopNodes(card).some(node => node.type === 'button'
    && ['安装', '启动', '关闭', '卸载'].some(label => node.children?.includes(label))), false)
  const details = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('查看详情'))
  details.props.onClick()
  const detailTree = await harness.render()
  assert.match(desktopText(detailTree), /来源与 Catalog 仓库不一致，商城不会管理/)
  for (const label of ['关闭', '卸载']) {
    const button = desktopNodes(detailTree).find(node => node.type === 'button' && node.children?.includes(label))
    assert.ok(button, label + ' remains visible in details')
    assert.equal(button.props.disabled, true)
    assert.equal(button.props.onClick, undefined)
  }
  assert.equal(harness.calls.installBundle.length, 0)
  assert.equal(harness.calls.removeBundle.length, 0)
  assert.equal(harness.calls.setBundleEnabled.length, 0)
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
