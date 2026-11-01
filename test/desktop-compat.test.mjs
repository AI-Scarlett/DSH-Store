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

function desktopEntry({ id, packageName, commit, compatibility = 'compatible', profiles = ['desktop'], status = 'approved', statusReason,
  repositoryUrl = `https://github.com/acme/${id}`, source, installPath = null,
  manifestPath = installPath ? `${installPath}/package.json` : 'package.json', entryIds = [id] }) {
  return {
    id, name: id === 'dsh-safe-plugin-manager' ? '安全插件商城（DSH-Store）' : `Name ${id}`,
    packageName, description: `Description for ${id}`,
    repositoryUrl, commit, version: '1.2.3',
    source: source ?? { provenance: 'github-commit', updatedAt: '2026-10-30T00:00:00Z' },
    installPath, manifestPath, entryIds, categories: ['tools'],
    searchTerms: [id], status, ...(statusReason ? { statusReason } : {}),
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

function createDesktopHarness({ catalog, installed = [], responseFactory, desktopRuntimeVersion = '0.2.2-alpha.2',
  inspectResult, installResult, installedAfterInstallResult = null, inspectAvailable = true } = {}) {
  const sourcePromise = readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const settingsRegistrations = []
  const injections = []
  const moduleDependencies = []
  const requests = []
  const timerCallbacks = []
  const timerDelays = []
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
        ...(desktopRuntimeVersion ? [{ name: 'dsh.desktop-runtime', official: true,
          installTarget: { version: desktopRuntimeVersion }, installed: true }] : []),
        ...installedBundles,
      ]
    },
    async inspect(spec) {
      calls.inspect.push(spec)
      return typeof inspectResult === 'function' ? inspectResult(spec) : inspectResult ?? { status: 'accepted', kind: 'git' }
    },
    async installBundle(spec, options) {
      calls.installBundle.push({ spec, options })
      const requestedResult = typeof installResult === 'function' ? await installResult(spec, options) : installResult
      if (requestedResult) {
        if (Array.isArray(installedAfterInstallResult)) installedBundles = installedAfterInstallResult
        return requestedResult
      }
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
  if (!inspectAvailable) delete manager.inspect
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
    setTimeout: (callback, delay) => { timerCallbacks.push(callback); timerDelays.push(delay); return ++nextTimer },
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
  return { ready, render, runEffects, setInstalledBundles: value => { installedBundles = value },
    getComponent: name => [...componentRecords.keys()].find(component => component.name === name),
    settingsRegistrations, injections, moduleDependencies, requests, calls, timerCallbacks, timerDelays,
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
      desktopEntry({ id: 'build-dsh-plugin', packageName: 'dsh-build-plugin', commit: '9'.repeat(40), profiles: [], status: 'blocked',
        statusReason: 'Automatic policy blocked installation: fixed-source security warnings require review' }),
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
  assert.match(text, /安装由 DSH Desktop 校验/)
  assert.match(text, /客户端适配标识仅供参考；对来源固定/)
  assert.match(text, /Store 待复核/)
  assert.match(text, /4 声明适配 Desktop/)
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
  const blockedPluginCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('dsh-build-plugin'))
  assert.ok(installedCard)
  assert.ok(incompatibleCard)
  assert.ok(unknownCard)
  assert.ok(webOnlyCard)
  assert.ok(blockedPluginCard, 'Catalog-blocked plugins remain searchable and can be handed to DSH for a final check')
  assert.match(desktopText(blockedPluginCard), /Store 待复核 · DSH 可检查/)
  const blockedInstallCard = desktopNodes(blockedPluginCard).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
  assert.ok(blockedInstallCard)
  assert.equal(blockedInstallCard.props.disabled, false)
  assert.equal(typeof blockedInstallCard.props.onClick, 'function')
  for (const label of ['关闭', '卸载', '查看详情']) {
    assert.equal(desktopNodes(installedCard).some(node => node.type === 'button' && node.children?.includes(label)), true, `${label} is available for a matching installed third-party bundle`)
  }
  assert.equal(desktopNodes(installedCard).some(node => node.type === 'button' && node.children?.includes('安装')), false)
  for (const card of [incompatibleCard, unknownCard, webOnlyCard]) {
    const install = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('安装'))
    assert.ok(install, 'the official Desktop manager gets to decide install compatibility')
    assert.equal(install.props.disabled, false)
    assert.equal(typeof install.props.onClick, 'function')
  }
  const storeCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('dsh-safe-plugin-manager'))
  assert.ok(storeCard)
  assert.equal(desktopNodes(storeCard).some(node => node.type === 'button' && ['启动', '关闭', '卸载'].some(label => node.children?.includes(label))), false)

  const detailButton = desktopNodes(installedCard).find(node => node.type === 'button' && node.children?.includes('查看详情'))
  detailButton.props.onClick()
  const detailTree = await harness.render()
  assert.match(desktopText(detailTree), /Name dsh-installed · 插件详情/)
  assert.match(desktopText(detailTree), /GitHub 仓库：https:\/\/github\.com\/acme\/dsh-installed/)
  assert.match(desktopText(detailTree), /权限 low/)
  const installedDetailActions = desktopNodes(detailTree).find(node => node.props?.['aria-label'] === '插件操作')
  assert.ok(installedDetailActions)
  for (const label of ['安装', '启动', '关闭', '卸载']) {
    assert.equal(desktopNodes(installedDetailActions).some(node => node.type === 'button' && node.children?.includes(label)), true,
      `${label} remains visible in plugin details`)
  }
  assert.equal(desktopNodes(installedDetailActions).find(node => node.type === 'button' && node.children?.includes('安装')).props.disabled, true)
  assert.equal(desktopNodes(installedDetailActions).find(node => node.type === 'button' && node.children?.includes('卸载')).props.disabled, false)

  const unknownDetailButton = desktopNodes(unknownCard).find(node => node.type === 'button' && node.children?.includes('查看详情'))
  unknownDetailButton.props.onClick()
  const unknownDetailTree = await harness.render()
  const unknownDetailActions = desktopNodes(unknownDetailTree).find(node => node.props?.['aria-label'] === '插件操作')
  assert.ok(unknownDetailActions)
  const blockedInstall = desktopNodes(unknownDetailActions).find(node => node.type === 'button' && node.children?.includes('安装'))
  assert.ok(blockedInstall)
  assert.equal(blockedInstall.props.disabled, false)
  assert.equal(typeof blockedInstall.props.onClick, 'function')
  for (const label of ['启动', '关闭', '卸载']) {
    const button = desktopNodes(unknownDetailActions).find(node => node.type === 'button' && node.children?.includes(label))
    assert.ok(button, `${label} remains visible in plugin details`)
    assert.equal(button.props.disabled, true)
    assert.equal(button.props.title, '当前 Profile 尚未安装此插件。')
  }
  assert.doesNotMatch(desktopText(unknownDetailTree), /安装已禁用/)

  const search = desktopNodes(detailTree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索插件')
  assert.ok(search)
  search.props.onChange({ target: { value: 'build-dsh-plugin' } })
  const blockedSearchTree = await harness.render()
  const searchResults = desktopNodes(blockedSearchTree).filter(node => node.type === 'article')
  assert.equal(searchResults.length, 1)
  assert.match(desktopText(searchResults[0]), /dsh-build-plugin/)
  assert.ok(desktopNodes(blockedSearchTree).some(node => node.type === 'button' && node.children?.includes('Store 待复核 · 1')))
  const blockedDetailsButton = desktopNodes(searchResults[0]).find(node => node.type === 'button' && node.children?.includes('查看详情'))
  blockedDetailsButton.props.onClick()
  const blockedDetailsTree = await harness.render()
  assert.match(desktopText(blockedDetailsTree), /Catalog 审核原因：Automatic policy blocked installation/)
  const blockedDetailActions = desktopNodes(blockedDetailsTree).find(node => node.props?.['aria-label'] === '插件操作')
  assert.equal(desktopNodes(blockedDetailActions).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装')).props.disabled, false)
  const clearBlockedSearch = desktopNodes(blockedDetailsTree).find(node => node.type === 'button' && node.children?.includes('清除筛选'))
  clearBlockedSearch.props.onClick()
  const resetTree = await harness.render()
  const resetSearch = desktopNodes(resetTree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索插件')
  resetSearch.props.onChange({ target: { value: 'dsh-web-only' } })
  const searchedTree = await harness.render()
  assert.equal(desktopNodes(searchedTree).filter(node => node.type === 'article').length, 1)
  assert.match(desktopText(searchedTree), /Name dsh-web-only/)
  assert.ok(desktopNodes(searchedTree).some(node => node.type === 'select' && node.props['aria-label'] === '按分类筛选'))
  assert.ok(desktopNodes(searchedTree).some(node => node.type === 'select' && node.props['aria-label'] === '排序方式'))
  assert.ok(desktopNodes(searchedTree).some(node => node.type === 'select' && node.props['aria-label'] === '按 Desktop 适配标识筛选'))
})

test('blocked fixed-source entries use DSH inspect and install only after explicit confirmation', async () => {
  const commit = '9'.repeat(40)
  const entry = desktopEntry({ id: 'build-dsh-plugin', packageName: 'dsh-build-plugin', commit,
    repositoryUrl: 'https://github.com/AI-Scarlett/build-dsh-plugin', profiles: [], status: 'blocked',
    statusReason: 'Automatic policy blocked installation: runtime source contains files and commands permission signals' })
  entry.updatePolicy = 'external-only'
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]) })
  await harness.ready
  await harness.render()
  const desktopPanel = harness.getComponent('DesktopStorePanel')
  await harness.runEffects(desktopPanel)
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Store 待复核 · DSH 可检查'))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('dsh-build-plugin'))
  const install = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
  assert.ok(install)
  assert.equal(install.props.disabled, false)
  install.props.onClick()
  tree = await harness.render()
  const warning = desktopText(tree)
  assert.match(warning, /Store 复核建议：Automatic policy blocked installation/)
  assert.match(warning, /不是 DSH 的安装结论/)
  assert.match(warning, /external-only/)
  assert.equal(harness.calls.inspect.length, 0)
  assert.equal(harness.calls.installBundle.length, 0)

  const confirmation = `INSTALL dsh-build-plugin ${commit}`
  const input = desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
  assert.ok(input)
  input.props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  const confirm = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  assert.ok(confirm)
  assert.equal(confirm.props.disabled, false)
  await confirm.props.onClick()

  assert.deepEqual(harness.calls.inspect, [`git+https://github.com/AI-Scarlett/build-dsh-plugin.git#${commit}`])
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.installBundle[0].options.enabled, true)
  tree = await harness.render()
  assert.match(desktopText(tree), /DSH 官方插件管理器已完成安装/)
  assert.ok(desktopNodes(tree).some(node => node.type === 'article' && desktopText(node).includes('Store 待复核 · 已安装')))
})

test('DSH inspection warning is shown while the confirmed request reaches installBundle', async () => {
  const commit = '8'.repeat(40)
  const entry = desktopEntry({ id: 'review-rejected', packageName: 'dsh-review-rejected', commit, status: 'blocked',
    statusReason: 'Fixed-source review required' })
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]),
    inspectResult: { status: 'rejected', reason: 'DSH runtime requirement is not met' } })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Store 待复核 · DSH 可检查'))
  const install = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
  install.props.onClick()
  tree = await harness.render()
  const phrase = `INSTALL ${entry.packageName} ${commit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === phrase)
    .props.onChange({ target: { value: phrase } })
  tree = await harness.render()
  const confirm = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  await confirm.props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方插件管理器已完成安装'))
  assert.equal(harness.calls.inspect.length, 1)
  assert.equal(harness.calls.installBundle.length, 1)
  assert.match(desktopText(tree), /DSH Desktop 预检提示：DSH runtime requirement is not met/)
})

test('blocked full-Commit entries are not gated by Catalog provenance labels or timestamps', async () => {
  const entry = desktopEntry({ id: 'repository-provenance', packageName: 'dsh-repository-provenance',
    commit: '6'.repeat(40), status: 'blocked', statusReason: 'Fixed-source review required',
    source: { provenance: 'github-repository' } })
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]) })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Store 待复核 · DSH 可检查'))
  const install = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
  assert.ok(install)
  assert.equal(install.props.disabled, false)
})

test('blocked entries with safe Unicode install paths are handed to DSH as pinned bundle specs', async () => {
  const commit = '5'.repeat(40)
  const installPath = '其它好用的工具/dsh-deepseek-balance'
  const entry = desktopEntry({ id: 'cjk-install-path', packageName: 'dsh-cjk-install-path', commit,
    repositoryUrl: 'https://github.com/Kaczev/dsh-KazMode', status: 'blocked',
    installPath, manifestPath: `${installPath}/package.json`, statusReason: 'Compatibility review required' })
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]) })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Store 待复核 · DSH 可检查'))
  const install = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
  assert.ok(install)
  assert.equal(install.props.disabled, false)
  install.props.onClick()
  tree = await harness.render()
  const confirmation = `INSTALL ${entry.packageName} ${commit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  const confirm = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  await confirm.props.onClick()
  assert.deepEqual(harness.calls.inspect, [
    `git+https://github.com/Kaczev/dsh-KazMode.git#${commit}&path:${installPath}`,
  ])
  assert.equal(harness.calls.installBundle.length, 1)
})

test('Desktop rechecks the confirmed source identity before calling the official manager', async () => {
  const commit = '7'.repeat(40)
  const entry = desktopEntry({ id: 'source-changed', packageName: 'dsh-source-changed', commit, status: 'blocked',
    statusReason: 'Fixed-source review required' })
  let requestCount = 0
  const responseFactory = () => {
    const current = requestCount++ === 0 ? entry : { ...entry, commit: '6'.repeat(40) }
    const bytes = new TextEncoder().encode(JSON.stringify(desktopCatalog([current])))
    let offset = 0
    return {
      ok: true, url: desktopCatalogUrl,
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
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), responseFactory })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Store 待复核 · DSH 可检查'))
  desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装')).props.onClick()
  tree = await harness.render()
  const phrase = `INSTALL ${entry.packageName} ${commit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === phrase)
    .props.onChange({ target: { value: phrase } })
  tree = await harness.render()
  const confirm = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  await confirm.props.onClick()
  tree = await harness.render()
  assert.equal(harness.calls.inspect.length, 0)
  assert.equal(harness.calls.installBundle.length, 0)
  assert.match(desktopText(tree), /CATALOG_OR_PROFILE_STATE_CHANGED/)
})

test('blocked entry handoff still fails closed on invalid source, unsafe paths, and protected targets', async () => {
  const rows = [
    desktopEntry({ id: 'bad-repository', packageName: 'dsh-bad-repository', commit: '1'.repeat(40), status: 'blocked',
      repositoryUrl: 'https://example.com/plugin' }),
    desktopEntry({ id: 'floating-source', packageName: 'dsh-floating-source', commit: 'main', status: 'blocked' }),
    desktopEntry({ id: 'unsafe-path', packageName: 'dsh-unsafe-path', commit: '2'.repeat(40), status: 'blocked',
      installPath: '../outside', manifestPath: '../outside/package.json' }),
    desktopEntry({ id: 'protected-entry', packageName: 'dsh-protected-entry', commit: '3'.repeat(40), status: 'blocked',
      entryIds: ['ui-settings-plugin-inventory'] }),
    desktopEntry({ id: 'protected-package', packageName: '@deepseek-ai/dsh-protected-package', commit: '4'.repeat(40), status: 'blocked' }),
  ]
  const harness = createDesktopHarness({ catalog: desktopCatalog(rows) })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes('5 Store 待复核'))
  const cards = desktopNodes(tree).filter(node => node.type === 'article')
  assert.equal(cards.length, rows.length)
  for (const card of cards) {
    const button = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
    assert.ok(button, 'the review reason remains visible with an unavailable action')
    assert.equal(button.props.disabled, true)
  }
  assert.equal(harness.calls.inspect.length, 0)
  assert.equal(harness.calls.installBundle.length, 0)
})

test('official Desktop restores a separate installed view and keeps out-of-catalog bundles read-only', async () => {
  const catalogInstalled = desktopEntry({ id: 'dsh-installed-view', packageName: '@acme/dsh-installed-view', commit: 'b'.repeat(40) })
  const harness = createDesktopHarness({
    catalog: desktopCatalog([catalogInstalled]),
    installed: [
      { name: '@acme/dsh-installed-view', official: false, installed: true, removable: true, enabled: false,
        version: '1.0.0', source: `git+https://github.com/acme/dsh-installed-view.git#${'b'.repeat(40)}` },
      { name: 'local-unlisted-plugin', official: false, installed: true, removable: true, enabled: true,
        version: '2.0.0', source: `git+https://github.com/acme/local-unlisted-plugin.git#${'c'.repeat(40)}` },
    ],
  })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  const catalogTree = await waitForDesktopTree(harness, tree => desktopText(tree).includes('Name dsh-installed-view'))
  const catalogTab = desktopNodes(catalogTree).find(node => node.type === 'button' && node.props.role === 'tab'
    && node.children?.some(value => String(value).startsWith('插件目录 · ')))
  const installedTab = desktopNodes(catalogTree).find(node => node.type === 'button' && node.props.role === 'tab'
    && node.children?.some(value => String(value).startsWith('已安装 · 2')))
  assert.ok(catalogTab)
  assert.ok(installedTab)
  assert.equal(installedTab.props['aria-selected'], false)
  installedTab.props.onClick()

  const installedTree = await harness.render()
  assert.ok(desktopNodes(installedTree).some(node => node.type === 'button' && node.props.role === 'tab'
    && node.props['aria-selected'] === true && node.children?.some(value => String(value).startsWith('已安装 · '))))
  assert.match(desktopText(installedTree), /DSH 已安装/)
  assert.match(desktopText(installedTree), /目录外只读/)
  assert.match(desktopText(installedTree), /local-unlisted-plugin/)
  const externalCard = desktopNodes(installedTree).find(node => node.type === 'article' && desktopText(node).includes('local-unlisted-plugin'))
  assert.ok(externalCard)
  assert.match(desktopText(externalCard), /此插件没有可匹配的已审核 Catalog 固定来源记录/)
  assert.ok(desktopNodes(externalCard).some(node => node.type === 'button' && node.children?.includes('商城不管理') && node.props.disabled))
  assert.equal(desktopNodes(externalCard).some(node => node.type === 'button' && ['安装', '启动', '关闭', '卸载'].some(label => node.children?.includes(label))), false)

  const search = desktopNodes(installedTree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索插件')
  search.props.onChange({ target: { value: 'local-unlisted-plugin' } })
  const searchedTree = await harness.render()
  assert.equal(desktopNodes(searchedTree).filter(node => node.type === 'article').length, 1)
  assert.match(desktopText(searchedTree), /GitHub 来源：https:\/\/github\.com\/acme\/local-unlisted-plugin/)
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

test('official Desktop receives unadapted unknown entries and displays DSH compatibility refusal', async () => {
  const entry = desktopEntry({ id: 'dsh-unknown', packageName: '@acme/dsh-unknown', commit: desktopCommit,
    compatibility: 'unknown', profiles: ['web'] })
  const incompatible = [{ name: entry.packageName, version: entry.version, runtimeVersion: '0.2.2-alpha.2',
    requirements: { 'engines.dsh': '^0.1.0' } }]
  const harness = createDesktopHarness({
    catalog: desktopCatalog([entry]), desktopRuntimeVersion: null,
    installResult: { application: 'failed', changed: false, stage: 'install', target: entry.packageName,
      error: { code: 'incompatible-version', incompatible }, packageResult: { exitCode: 1, output: '', truncated: false,
        logPath: '/disposable/manager.log', incompatible } },
  })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  assert.match(desktopText(tree), /安装仍会交由 Desktop 官方插件管理器按当前运行环境校验/)
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  const install = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('安装'))
  assert.ok(install)
  assert.equal(install.props.disabled, false)
  assert.equal(typeof install.props.onClick, 'function')
  const details = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('查看详情'))
  details.props.onClick()
  tree = await harness.render()
  assert.match(desktopText(tree), /DSH Desktop 客户端：未声明适配/)
  assert.match(desktopText(tree), /Catalog 兼容性参考：DSH 未知 \/ unknown/)
  const detailInstall = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('安装'))
  assert.equal(detailInstall.props.disabled, false)
  detailInstall.props.onClick()
  tree = await harness.render()
  const confirmation = `INSTALL ${entry.packageName} ${entry.commit}`
  const input = desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
  assert.ok(input)
  input.props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  const confirm = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  await confirm.props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方兼容性校验拒绝'))
  assert.match(desktopText(tree), /incompatible-version/)
  assert.match(desktopText(tree), /@acme\/dsh-unknown@1\.2\.3/)
  assert.match(desktopText(tree), /engines\.dsh=\^0\.1\.0/)
  assert.equal(harness.calls.inspect.length, 1)
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.removeBundle.length, 0)
  assert.equal(harness.calls.setBundleEnabled.length, 0)
})

test('official Desktop inspection refusal is advisory and installBundle determines the final result', async () => {
  const entry = desktopEntry({ id: 'dsh-no-bundle', packageName: '@acme/dsh-no-bundle', commit: desktopCommit,
    compatibility: 'incompatible', profiles: [] })
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]),
    inspectResult: { status: 'refused', problem: 'not-a-bundle', reason: 'the Git source has no DSH Bundle Patch' },
    installResult: { application: 'failed', changed: false, stage: 'install', target: entry.packageName,
      error: { code: 'not-a-bundle' } } })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const install = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('安装'))
  assert.ok(install)
  assert.equal(install.props.disabled, false)
  install.props.onClick()
  tree = await harness.render()
  const confirmation = `INSTALL ${entry.packageName} ${entry.commit}`
  const input = desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
  input.props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  const confirm = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  await confirm.props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('操作未完成（not-a-bundle）'))
  assert.match(desktopText(tree), /DSH Desktop 预检提示：the Git source has no DSH Bundle Patch/)
  assert.match(desktopText(tree), /the Git source has no DSH Bundle Patch/)
  assert.match(desktopText(tree), /not-a-bundle/)
  assert.equal(harness.calls.inspect.length, 1)
  assert.equal(harness.calls.installBundle.length, 1)
})

test('official Desktop install result can succeed after its inspection advisory', async () => {
  const entry = desktopEntry({ id: 'dsh-inspection-advisory', packageName: '@acme/dsh-inspection-advisory', commit: desktopCommit })
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]),
    inspectResult: { status: 'refused', reason: 'Desktop preflight could not confirm this source' } })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const install = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('安装'))
  install.props.onClick()
  tree = await harness.render()
  const confirmation = `INSTALL ${entry.packageName} ${desktopCommit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  await desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装')).props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方插件管理器已完成安装'))
  assert.match(desktopText(tree), /DSH Desktop 预检提示：Desktop preflight could not confirm this source/)
  assert.equal(harness.calls.inspect.length, 1)
  assert.equal(harness.calls.installBundle.length, 1)
})

test('an already installed exact package reported by Desktop reconciles a no-change install failure', async () => {
  const entry = desktopEntry({ id: 'dsh-no-change-installed', packageName: '@acme/dsh-no-change-installed', commit: desktopCommit })
  const installedPackage = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: entry.version, source: `git+${entry.repositoryUrl}.git#${desktopCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]),
    installResult: { application: 'failed', changed: false, stage: 'install', target: entry.packageName,
      error: { code: 'NO_DEPENDENCY_CHANGES' } },
    installedAfterInstallResult: [installedPackage] })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const install = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('安装'))
  install.props.onClick()
  tree = await harness.render()
  const confirmation = `INSTALL ${entry.packageName} ${desktopCommit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  await desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装')).props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH Desktop 已安装清单确认此版本已安装'))
  assert.match(desktopText(tree), /本次未发生依赖变更/)
  assert.equal(harness.calls.installBundle.length, 1)
  assert.ok(harness.calls.listBundles >= 2)
  assert.equal(harness.calls.waitForInstall.length, 0)
})

test('Desktop updates an older fixed GitHub revision through installBundle after exact Commit confirmation', async () => {
  const entry = desktopEntry({ id: 'dsh-update-target', packageName: '@acme/dsh-update-target', commit: desktopCommit })
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: false, version: '1.0.0', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const updated = { ...installed, enabled: false, version: entry.version,
    source: `git+${entry.repositoryUrl}.git#${desktopCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    installResult: { application: 'applied', changed: true, stage: 'install', target: entry.packageName },
    installedAfterInstallResult: [updated] })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  const update = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('更新'))
  assert.ok(update)
  assert.equal(update.props.disabled, false)
  update.props.onClick()
  tree = await harness.render()
  const confirmation = `UPDATE ${entry.packageName} ${desktopCommit}`
  assert.match(desktopText(tree), new RegExp(`更新 spec：git\\+${entry.repositoryUrl}\\.git#${desktopCommit}`))
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  await desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并更新')).props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方插件管理器已完成更新'))
  assert.deepEqual(harness.calls.inspect, [`git+${entry.repositoryUrl}.git#${desktopCommit}`])
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.installBundle[0].spec, harness.calls.inspect[0])
  assert.equal(harness.calls.installBundle[0].options.enabled, false)
  assert.ok(harness.timerDelays.includes(90_000), 'DSH operations retain their 90-second deadline')
  assert.equal(harness.calls.removeBundle.length, 0)
})

test('DSH Store can update its own installed package through the official Desktop manager', async () => {
  const entry = desktopEntry({ id: 'dsh-safe-plugin-manager', packageName: 'dsh-safe-plugin-manager', commit: desktopCommit,
    repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store' })
  entry.version = '0.9.25'
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: '0.9.24', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const updated = { ...installed, version: entry.version, source: `git+${entry.repositoryUrl}.git#${desktopCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    installResult: { application: 'applied', changed: true, stage: 'install', target: entry.packageName },
    installedAfterInstallResult: [updated] })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  const update = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('更新'))
  assert.ok(update, 'the Store entry exposes its fixed-Commit update action')
  update.props.onClick()
  tree = await harness.render()
  const confirmation = `UPDATE ${entry.packageName} ${desktopCommit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  await desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并更新')).props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方插件管理器已完成更新'))
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.installBundle[0].spec, `git+${entry.repositoryUrl}.git#${desktopCommit}`)
  assert.equal(harness.calls.removeBundle.length, 0)
})

test('an update with no dependency changes is reconciled only when Desktop confirms the exact target Commit', async () => {
  const entry = desktopEntry({ id: 'dsh-update-no-change', packageName: '@acme/dsh-update-no-change', commit: desktopCommit })
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: '1.0.0', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const updated = { ...installed, version: entry.version, source: `git+${entry.repositoryUrl}.git#${desktopCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    installResult: { application: 'failed', changed: false, stage: 'install', target: entry.packageName,
      error: { code: 'NO_DEPENDENCY_CHANGES' } },
    installedAfterInstallResult: [updated] })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('更新')).props.onClick()
  tree = await harness.render()
  const confirmation = `UPDATE ${entry.packageName} ${desktopCommit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  await desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并更新')).props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('此固定 Commit 已是当前版本'))
  assert.equal(harness.calls.installBundle.length, 1)
  assert.ok(harness.calls.listBundles >= 2)
  assert.equal(harness.calls.waitForInstall.length, 0)
})

test('Desktop update preserves the official rejection and never resubmits the request', async () => {
  const entry = desktopEntry({ id: 'dsh-update-refused', packageName: '@acme/dsh-update-refused', commit: desktopCommit })
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: '1.0.0', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    installResult: { application: 'failed', changed: false, stage: 'install', target: entry.packageName,
      error: { code: 'incompatible-version' } } })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('更新')).props.onClick()
  tree = await harness.render()
  const confirmation = `UPDATE ${entry.packageName} ${desktopCommit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  await desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并更新')).props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('操作未完成（incompatible-version）'))
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.waitForInstall.length, 0)
})

test('Desktop hides the update action when the installed source already matches the fixed Commit', async () => {
  const entry = desktopEntry({ id: 'dsh-already-current', packageName: '@acme/dsh-already-current', commit: desktopCommit })
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: entry.version, source: `git+${entry.repositoryUrl}.git#${desktopCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed] })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  const update = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('更新'))
  assert.ok(update)
  assert.equal(update.props.disabled, true)
  assert.match(update.props.title, /当前固定 Commit/)
  assert.equal(harness.calls.installBundle.length, 0)
})

test('a changed Desktop installation invalidates the update confirmation before any package request', async () => {
  const entry = desktopEntry({ id: 'dsh-update-stale', packageName: '@acme/dsh-update-stale', commit: desktopCommit })
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: '1.0.0', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const alreadyUpdated = { ...installed, version: entry.version, source: `git+${entry.repositoryUrl}.git#${desktopCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed] })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('更新')).props.onClick()
  tree = await harness.render()
  const confirmation = `UPDATE ${entry.packageName} ${desktopCommit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  harness.setInstalledBundles([alreadyUpdated])
  await desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并更新')).props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('CATALOG_OR_PROFILE_STATE_CHANGED'))
  assert.equal(harness.calls.installBundle.length, 0)
})

test('Desktop installBundle remains available when the optional inspect method is absent', async () => {
  const entry = desktopEntry({ id: 'dsh-no-inspect', packageName: '@acme/dsh-no-inspect', commit: desktopCommit })
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), inspectAvailable: false })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('安装')).props.onClick()
  tree = await harness.render()
  const confirmation = `INSTALL ${entry.packageName} ${desktopCommit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  await desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装')).props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方插件管理器已完成安装'))
  assert.equal(harness.calls.inspect.length, 0)
  assert.equal(harness.calls.installBundle.length, 1)
})

test('official Desktop installs an approved plugin without Desktop adaptation when its manager accepts it', async () => {
  const entry = desktopEntry({ id: 'dsh-host-only', packageName: '@acme/dsh-host-only', commit: desktopCommit,
    compatibility: 'unknown', profiles: ['web'] })
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]) })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  assert.ok(card)
  assert.match(desktopText(card), /DSH Desktop 客户端：未声明适配/)
  const install = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('安装'))
  assert.ok(install)
  assert.equal(install.props.disabled, false)
  install.props.onClick()
  tree = await harness.render()
  const confirmation = `INSTALL ${entry.packageName} ${entry.commit}`
  const input = desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
  assert.ok(input)
  input.props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  const confirm = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  assert.ok(confirm)
  await confirm.props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方插件管理器已完成安装'))
  assert.equal(harness.calls.inspect.length, 1)
  assert.equal(harness.calls.inspect[0], `git+${entry.repositoryUrl}.git#${desktopCommit}`)
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.installBundle[0].spec, harness.calls.inspect[0])
  assert.equal(harness.calls.installBundle[0].options.enabled, true)
})

test('official Desktop starts, closes, and uninstalls only the matching Catalog bundle through pluginManager', async () => {
  const entry = desktopEntry({ id: 'dsh-managed', packageName: '@acme/dsh-managed', commit: desktopCommit,
    compatibility: 'incompatible', profiles: ['web'] })
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
  assert.equal(desktopNodes(managedCard).some(node => node.type === 'button' && node.children?.includes('更新')), true,
    'a changed Catalog Commit is sent through DSH installBundle after confirmation')

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

test('official Desktop keeps lifecycle operations disabled when an installed package source differs from the Catalog', async () => {
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
  for (const label of ['关闭', '卸载']) {
    const button = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes(label))
    assert.ok(button, `${label} remains visible in the card`)
    assert.equal(button.props.disabled, true)
  }
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
  const expectedBlocked = catalog.entries.filter(entry => entry.status === 'blocked').length
  const harness = createDesktopHarness({ catalog })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes(`${expectedBlocked} Store 待复核`))
  assert.match(desktopText(tree), new RegExp(`${expectedApproved + expectedBlocked} 目录条目`))
  assert.match(desktopText(tree), new RegExp(`${expectedApproved} Catalog 已审核`))
  assert.match(desktopText(tree), new RegExp(`${expectedBlocked} Store 待复核`))
  const expectedDesktop = catalog.entries.filter(entry => entry.status !== 'unlisted' && entry.compatibility?.profiles?.includes('desktop')).length
  assert.match(desktopText(tree), new RegExp(`${expectedDesktop} 声明适配 Desktop`))
  const search = desktopNodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索插件')
  assert.ok(search)
  search.props.onChange({ target: { value: 'build-dsh-plugin' } })
  const searched = await harness.render()
  const matches = desktopNodes(searched).filter(node => node.type === 'article')
  assert.equal(matches.length, 1)
  assert.match(desktopText(matches[0]), /DSH 插件开发工作流（Build DSH Plugin）/)
  assert.match(desktopText(matches[0]), /Store 待复核 · DSH 可检查/)
  const handoff = desktopNodes(matches[0]).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
  assert.ok(handoff)
  assert.equal(handoff.props.disabled, false)
  assert.equal(harness.requests[0].url, desktopCatalogUrl)
})

test('website SEO and LLM guidance separates Desktop adaptation labels from installation', async () => {
  const home = await readFile(new URL('../marketplace/index.html', import.meta.url), 'utf8')
  const directory = await readFile(new URL('../marketplace/plugins/index.html', import.meta.url), 'utf8')
  const buildPage = await readFile(new URL('../marketplace/build/index.html', import.meta.url), 'utf8')
  const buildScript = await readFile(new URL('../marketplace/build/build.js', import.meta.url), 'utf8')
  const llms = await readFile(new URL('../marketplace/llms.txt', import.meta.url), 'utf8')
  assert.match(home, /DSH STORE 已适配 DSH 官方桌面端/)
  assert.match(home, /DSH Desktop 官方插件管理器/)
  assert.match(home, /DSH Desktop 内通过 DSH STORE 查看和管理已审核条目/)
  assert.match(home, /"name": "DSH STORE — DSH Desktop Plugin Marketplace"/)
  assert.match(directory, /client-adaptation labels do not gate installation/)
  assert.match(directory, /DSH Desktop 内的 DSH STORE 可查看和管理已审核插件/)
  assert.match(buildPage, /user-confirmed fixed sources with Store review advice/)
  assert.match(buildPage, /用 build-dsh-plugin 为 DSH Web 或官方 DSH Desktop 设计和验证插件/)
  assert.match(buildScript, /客户端适配标识不作安装门槛/)
  assert.match(buildScript, /Client-adaptation labels do not decide installation eligibility/)
  assert.match(llms, /informational and does not decide installation eligibility/)
  assert.match(llms, /user-confirmed fixed sources with Store review advice/)
})
