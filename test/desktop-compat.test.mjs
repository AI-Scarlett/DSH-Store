import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { createKnownPluginDirectory } from '../marketplace/lib/plugin-directory.js'
import { rankingEntries } from '../marketplace/rankings/model.js'
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
const desktopCatalogIndexUrl = 'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/catalog-index.json'
const desktopDiscoveryUrl = 'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/discovery-index.json'
const desktopCandidatesUrl = 'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/candidates.json'
const desktopRankingIndexUrl = 'https://ai-scarlett.github.io/DSH-Store/marketplace/rankings/index.html'
const desktopRankingDataUrl = 'https://ai-scarlett.github.io/DSH-Store/marketplace/rankings/data.json'
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

function desktopRankingEntry({ id, name = id, repositoryUrl = `https://github.com/acme/${id}`, source = 'catalog',
  reviewStatus = 'approved', listingStatus = source === 'catalog' && reviewStatus === 'approved' ? 'listed' : 'not-listed',
  listingReason = listingStatus === 'listed' ? null : 'This entry is not approved for Store listing.',
  categories = ['tools'], weeklyCategories = categories, weeklyStars = 0, communityRecommendation }) {
  return {
    id, nameZh: name, nameEn: name, version: '1.0.0', repositoryUrl, description: `${name} description`, categories,
    listingStatus, listingReason, source, reviewStatus, stars: weeklyStars, weeklyStars,
    weeklySnapshotMember: true, weeklyCategories,
    ...(communityRecommendation ? { communityRecommendation } : {}),
  }
}

function desktopRankingSnapshot(entries) {
  return {
    schemaVersion: 4, sourceCommit: desktopCommit, catalogUpdatedAt: '2026-11-02T00:00:00.000Z',
    candidatesUpdatedAt: '2026-11-02T00:00:00.000Z', starsObservedAt: '2026-11-02T00:00:00.000Z',
    weeklyStarsObservedAt: '2026-11-02T00:00:00.000Z',
    categories: [{ id: 'tools', zh: '工具', en: 'Tools' }, { id: 'ai', zh: 'AI', en: 'AI' }], entries,
  }
}

function desktopCatalog(entries) {
  const updatedAt = '2026-10-30T00:00:00Z'
  const catalogIndex = {
    schemaVersion: 2, catalogType: 'index',
    registry: { repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store', updatedAt, detailsPath: 'catalog/details' },
    entries: entries.map((entry, order) => ({
      id: entry.id, nameZh: entry.name, nameEn: entry.name, packageName: entry.packageName,
      version: entry.version, featured: false, order, repositoryUrl: entry.repositoryUrl,
      detailPath: `catalog/details/${entry.id}.json`, status: entry.status,
      categories: entry.categories, searchTerms: entry.searchTerms || [],
    })),
  }
  const catalogIndexBytes = Buffer.from(JSON.stringify(catalogIndex))
  return {
    schemaVersion: 1,
    registry: {
      repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store', categories: { tools: '工具' }, updatedAt,
      indexPath: 'catalog-index.json', indexSha256: createHash('sha256').update(catalogIndexBytes).digest('hex'),
      indexBytes: catalogIndexBytes.byteLength, indexEntryCount: entries.length,
    },
    entries,
  }
}

function desktopDirectoryDocuments(catalog, { extraCandidates = [] } = {}) {
  const entries = catalog.entries.filter(entry => entry.status !== 'unlisted').map((entry, sourceIndex) => ({
    sourceIndex, sourceId: entry.id, alias: entry.packageName, name: entry.name,
    description: entry.description, stars: 25 - sourceIndex, categories: ['ai'], kind: 'dsh-plugin',
    repositoryUrl: entry.repositoryUrl, detailUrl: `https://www.dsh.so/artifact/${entry.id}/`,
  }))
  entries.push({ sourceIndex: entries.length, sourceId: 'public-only', alias: '@acme/public-only', name: 'Public only plugin',
    description: 'Listed in the public discovery index only.', stars: 3, categories: ['ai'], kind: 'dsh-plugin',
    repositoryUrl: 'https://github.com/acme/public-only', detailUrl: 'https://www.dsh.so/artifact/public-only/' })
  const candidates = [{ id: 'build-dsh-plugin', name: 'DSH Build candidate', description: 'Candidate review metadata for a Catalog entry.',
    repositoryUrl: 'https://github.com/acme/build-dsh-plugin', status: 'reviewing', latestCommit: '9'.repeat(40), topics: ['ai'] },
  ...extraCandidates]
  return {
    catalogIndex: desktopCatalogIndex(catalog.entries),
    catalogIndexRaw: JSON.stringify(desktopCatalogIndex(catalog.entries)),
    discovery: {
      schemaVersion: 1,
      source: { name: 'dsh.so public discovery index', url: 'https://www.dsh.so/plugins-index.json',
        generatedAt: '2026-10-13T00:19:35.310Z', recordCount: entries.length,
        license: { spdx: 'CC-BY-4.0', attribution: 'dsh.so — DSH Developer Hub (https://www.dsh.so)' } },
      entries,
    },
    candidates: { schemaVersion: 1, registry: {
      repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store',
      trustBoundary: { installActionsDisabled: true, catalogPromotionRequired: true, unknownIsNotVerified: true },
    }, entries: candidates },
  }
}

function desktopRankingFixture() {
  const rankingSnapshot = desktopRankingSnapshot([
    desktopRankingEntry({ id: 'dsh-rank-alpha', name: 'Alpha ranked plugin', weeklyStars: 55, categories: ['tools'] }),
    desktopRankingEntry({ id: 'dsh-rank-beta', name: 'Beta ranked plugin', weeklyStars: 45, categories: ['ai'] }),
    desktopRankingEntry({ id: 'candidate:pending-review', name: 'Pending review plugin', source: 'candidate',
      reviewStatus: 'reviewing', listingReason: 'Store review is still pending for this plugin.',
      repositoryUrl: 'https://github.com/acme/pending-review', weeklyStars: 35, categories: ['tools', 'ai'],
      communityRecommendation: { basis: 'author-interaction', evidenceUrl: 'https://github.com/AI-Scarlett/DSH-Store/issues/1700#issuecomment-1', occurredAt: '2026-11-01T12:00:00.000Z' } }),
    desktopRankingEntry({ id: 'dsh-rank-blocked', name: 'Blocked plugin', reviewStatus: 'blocked', listingReason: 'A policy blocker.',
      weeklyStars: 100, categories: ['tools'] }),
    desktopRankingEntry({ id: 'candidate:rejected-review', name: 'Rejected plugin', source: 'candidate', reviewStatus: 'rejected',
      listingReason: 'Fixed-source review rejected this plugin.', repositoryUrl: 'https://github.com/acme/rejected-review',
      weeklyStars: 90, categories: ['ai'] }),
    desktopRankingEntry({ id: 'dsh-store-tool', name: 'DSH Store tool', repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store',
      weeklyStars: 10, categories: ['tools'] }),
    desktopRankingEntry({ id: 'build-dsh-plugin', name: 'Build DSH Plugin', repositoryUrl: 'https://github.com/AI-Scarlett/build-dsh-plugin',
      weeklyStars: 5, categories: ['ai'] }),
    desktopRankingEntry({ id: 'zero-star-category-leader', name: 'Zero star category leader', weeklyStars: 0, categories: ['zero-weekly'] }),
    desktopRankingEntry({ id: 'unknown-stars-tools-plugin', name: 'Unknown stars tools plugin', reviewStatus: 'unlisted',
      listingStatus: 'not-listed', listingReason: 'This entry is not approved for Store listing.', weeklyStars: null, categories: ['tools'] }),
  ])
  rankingSnapshot.categories.push({ id: 'zero-weekly', zh: '零星标', en: 'Zero Stars' })
  const catalogEntries = rankingSnapshot.entries.filter(entry => entry.source === 'catalog').map(entry => desktopEntry({
    id: entry.id, packageName: `@acme/${entry.id}`, commit: desktopCommit, status: entry.reviewStatus,
    statusReason: entry.listingReason || undefined, repositoryUrl: entry.repositoryUrl,
  }))
  const candidates = rankingSnapshot.entries.filter(entry => entry.source === 'candidate').map(entry => ({
    id: entry.id.replace(/^candidate:/, ''), name: entry.nameZh, description: entry.description,
    repositoryUrl: entry.repositoryUrl, status: entry.reviewStatus, statusReason: entry.listingReason,
    latestCommit: '9'.repeat(40), topics: entry.categories,
  }))
  const catalog = desktopCatalog(catalogEntries)
  return { rankingSnapshot, catalog, directoryDocuments: desktopDirectoryDocuments(catalog, { extraCandidates: candidates }) }
}

function desktopCatalogIndex(entries) {
  const updatedAt = '2026-10-30T00:00:00Z'
  return {
    schemaVersion: 2, catalogType: 'index',
    registry: { repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store', updatedAt, detailsPath: 'catalog/details' },
    entries: entries.map((entry, order) => ({
      id: entry.id, nameZh: entry.name, nameEn: entry.name, packageName: entry.packageName,
      version: entry.version, featured: false, order, repositoryUrl: entry.repositoryUrl,
      detailPath: `catalog/details/${entry.id}.json`, status: entry.status,
      categories: entry.categories, searchTerms: entry.searchTerms || [],
    })),
  }
}

function createDesktopHarness({ catalog, installed = [], responseFactory, desktopRuntimeVersion = '0.2.2-alpha.2',
  inspectResult, installResult, installedAfterInstallResult = null, removeResult = null,
  retainInstalledAfterRemove = false, inspectAvailable = true, removeBundleAvailable = true,
  protocol = 'dsh-app:', directoryDocuments = undefined, rankingSnapshot = null, rankingIndexDigest = null,
  listBundlesError = false } = {}) {
  const activeDirectoryDocuments = directoryDocuments === undefined
    ? (catalog ? desktopDirectoryDocuments(catalog) : null) : directoryDocuments
  const sourcePromise = readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const settingsRegistrations = []
  const slotRegistrations = []
  const injections = []
  const moduleDependencies = []
  const requests = []
  const directoryRequests = []
  const timerCallbacks = []
  const timerDelays = []
  const calls = { listBundles: 0, inspect: [], installBundle: [], removeBundle: [], setBundleEnabled: [], waitForInstall: [] }
  const componentRecords = new Map()
  let activeComponent = null
  let panel
  let activeSlotRegistration = null
  let installedBundles = installed
  let nextTimer = 0

  const recordFor = component => {
    if (!componentRecords.has(component)) componentRecords.set(component, { states: [], refs: [], effects: [], callbacks: [], cursor: 0 })
    return componentRecords.get(component)
  }
  const sameDependencies = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const values = children.length === 1 ? children[0] : children
      return { type, props: { ...(props || {}), ...(children.length ? { children: values } : {}) }, children }
    },
    useCallback(callback, dependencies) {
      const record = activeComponent
      const index = record.cursor++
      const cached = record.callbacks[index]
      if (cached && sameDependencies(cached.dependencies, dependencies)) return cached.callback
      record.callbacks[index] = { callback, dependencies }
      return callback
    },
    useEffect(effect, dependencies) {
      const record = activeComponent
      const index = record.cursor++
      const previous = record.effects[index]
      if (!previous) record.effects[index] = { effect, cleanup: null, dependencies, pending: true }
      else if (dependencies === undefined || previous.dependencies === undefined
        || !sameDependencies(previous.dependencies, dependencies)) {
        record.effects[index] = { effect, cleanup: previous.cleanup, dependencies, pending: true }
      }
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
      if (listBundlesError) throw Object.assign(new Error('DESKTOP_INVENTORY_FAILED'), { code: 'DESKTOP_INVENTORY_FAILED' })
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
      const result = removeResult ?? { application: 'applied', changed: true, stage: 'remove', target: name }
      if (!retainInstalledAfterRemove && ['applied', 'restart-required'].includes(result.application)) {
        installedBundles = installedBundles.filter(bundle => bundle.name !== name)
      }
      return result
    },
    async setBundleEnabled(name, enabled) {
      calls.setBundleEnabled.push({ name, enabled })
      installedBundles = installedBundles.map(bundle => bundle.name === name ? { ...bundle, enabled } : bundle)
      return { application: 'applied', changed: true, stage: 'enable', target: name, enabled }
    },
    async waitForInstall(requestId) { calls.waitForInstall.push(requestId); return null },
  }
  if (!inspectAvailable) delete manager.inspect
  if (!removeBundleAvailable) delete manager.removeBundle
  const jsonResponse = (url, payload, rawText = JSON.stringify(payload)) => {
    const bytes = new TextEncoder().encode(rawText)
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
  const fetch = async (url, options) => {
    if (url === desktopCatalogUrl) {
      requests.push({ url, options })
      if (responseFactory) return responseFactory()
      return jsonResponse(url, catalog)
    }
    directoryRequests.push({ url, options })
    if (url === desktopRankingIndexUrl) {
      const digest = rankingIndexDigest || createHash('sha256').update(JSON.stringify(rankingSnapshot)).digest('hex')
      return jsonResponse(url, null, `<meta name="dsh-rankings-sha256" content="${digest}">`)
    }
    const payload = url.includes('/catalog-index.json') ? activeDirectoryDocuments?.catalogIndex
      : url.includes('/discovery-index.json') ? activeDirectoryDocuments?.discovery
        : url.includes('/candidates.json') ? activeDirectoryDocuments?.candidates
          : url === desktopRankingDataUrl ? rankingSnapshot : null
    if (!payload) throw new Error('directory fixture unavailable')
    const rawText = url.includes('/catalog-index.json') ? activeDirectoryDocuments?.catalogIndexRaw : null
    return jsonResponse(url, payload, rawText || JSON.stringify(payload))
  }
  const window = {
    location: { protocol, origin: protocol === 'dsh-app:' ? 'dsh-app://app' : 'https://dsh.test',
      href: protocol === 'dsh-app:' ? 'dsh-app://app/settings' : 'https://dsh.test/settings' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111', subtle: webcrypto.subtle },
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
        effect() {},
        slots: {
          inject(slot, register) {
            const current = { slot }
            slotRegistrations.push(current)
            if (slot === 'settings.section') settingsRegistrations.push(current)
            activeSlotRegistration = current
            register()
            activeSlotRegistration = null
          },
          register(metadata, component) {
            activeSlotRegistration.metadata = metadata
            activeSlotRegistration.component = component
            if (activeSlotRegistration.slot === 'settings.section') panel = component
          },
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
  const renderComponent = async (component, props) => {
    await ready
    return resolveTree(withComponent(component, props))
  }
  const runEffects = async component => {
    await ready
    const effects = recordFor(component).effects
    for (const record of effects) {
      if (!record || !record.pending) continue
      record.pending = false
      record.cleanup?.()
      record.cleanup = record.effect()
    }
  }
  return { ready, render, runEffects, setInstalledBundles: value => { installedBundles = value },
    getComponent: name => [...componentRecords.keys()].find(component => component.name === name),
    settingsRegistrations, slotRegistrations, renderComponent, injections, moduleDependencies, requests, directoryRequests,
    calls, timerCallbacks, timerDelays,
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
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setImmediate(resolve))
    tree = await harness.render()
    if (predicate(tree)) return tree
  }
  return tree
}

test('official Desktop registers 插件商城 and mirrors the complete website directory with search and scrolling', async () => {
  const entry = desktopEntry({ id: 'dsh-installed', packageName: '@acme/dsh-installed', commit: 'b'.repeat(40) })
  const catalog = desktopCatalog([
    entry,
    desktopEntry({ id: 'dsh-installable', packageName: '@acme/dsh-installable', commit: desktopCommit }),
    desktopEntry({ id: 'dsh-incompatible', packageName: '@acme/dsh-incompatible', commit: 'c'.repeat(40), compatibility: 'incompatible' }),
    desktopEntry({ id: 'dsh-unknown', packageName: '@acme/dsh-unknown', commit: 'e'.repeat(40), compatibility: 'unknown' }),
    desktopEntry({ id: 'dsh-web-only', packageName: '@acme/dsh-web-only', commit: 'f'.repeat(40), profiles: ['web'] }),
    desktopEntry({ id: 'dsh-safe-plugin-manager', packageName: 'dsh-safe-plugin-manager', commit: 'd'.repeat(40), profiles: ['web'] }),
    desktopEntry({ id: 'build-dsh-plugin', packageName: 'dsh-build-plugin', commit: '9'.repeat(40), profiles: [], status: 'blocked',
      statusReason: 'Automatic policy blocked installation: fixed-source security warnings require review' }),
    desktopEntry({ id: 'withdrawn-plugin', packageName: '@acme/withdrawn-plugin', commit: '8'.repeat(40), status: 'unlisted' }),
  ])
  const harness = createDesktopHarness({
    catalog,
    directoryDocuments: desktopDirectoryDocuments(catalog, { extraCandidates: [
      { id: 'candidate-only', name: 'Candidate only plugin', description: 'A candidate with no Catalog record.',
        repositoryUrl: 'https://github.com/acme/candidate-only', status: 'rejected', latestCommit: '7'.repeat(40), topics: ['ai'] },
    ] }),
    installed: [{ name: '@acme/dsh-installed', official: false, installed: true, removable: true, enabled: true,
      version: '1.0.0', source: `git+https://github.com/acme/dsh-installed.git#${'b'.repeat(40)}` }],
  })
  await harness.ready
  assert.equal(harness.settingsRegistrations.length, 1)
  assert.equal(harness.settingsRegistrations[0].slot, 'settings.section')
  assert.equal(harness.settingsRegistrations[0].metadata.id, 'dsh-store')
  assert.equal(harness.settingsRegistrations[0].metadata.label(), '插件商城')
  assert.deepEqual(harness.slotRegistrations.map(row => row.slot), ['settings.section', 'main', 'sidebar.panellist'])
  const storePanel = harness.slotRegistrations.find(row => row.slot === 'main')
  assert.equal(storePanel.metadata.key, 'dsh-store')
  assert.equal(storePanel.component.name, 'ManagerPanel')
  const sidebarEntry = harness.slotRegistrations.find(row => row.slot === 'sidebar.panellist')
  assert.equal(sidebarEntry.metadata.id, storePanel.metadata.key)
  assert.equal(sidebarEntry.metadata.label, '插件商城')
  assert.equal(sidebarEntry.metadata.order, 10)
  const icon = await harness.renderComponent(sidebarEntry.component, { size: 18, active: true })
  assert.equal(desktopNodes(icon).find(node => node.type === 'svg')?.props.width, 18)
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar'))
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
  assert.match(text, /全部已知插件 · 10/)
  assert.match(text, /Name dsh-installed.*已启动|已启动.*Name dsh-installed/)
  assert.match(text, /收录状态与审核建议分开展示/)
  assert.match(text, /Catalog 已拦截 · DSH 可检查/)
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
  const publicOnlyCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('@acme/public-only'))
  const candidateOnlyCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('Candidate only plugin'))
  const withdrawnCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('@acme/withdrawn-plugin'))
  const blockedPluginCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('dsh-build-plugin'))
  assert.ok(installedCard)
  assert.ok(incompatibleCard)
  assert.ok(unknownCard)
  assert.ok(webOnlyCard)
  assert.ok(publicOnlyCard, 'discovery-only plugins remain visible in the full directory')
  assert.ok(candidateOnlyCard, 'candidate-only plugins remain visible in the full directory')
  assert.ok(withdrawnCard, 'unlisted Catalog records remain visible in the full directory')
  assert.ok(blockedPluginCard, 'Catalog-blocked plugins remain searchable and can be handed to DSH for a final check')
  assert.match(desktopText(blockedPluginCard), /Catalog 已拦截 · DSH 可检查/)
  const blockedInstallCard = desktopNodes(blockedPluginCard).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
  assert.ok(blockedInstallCard)
  assert.equal(blockedInstallCard.props.disabled, false)
  assert.equal(typeof blockedInstallCard.props.onClick, 'function')
  for (const card of [publicOnlyCard, candidateOnlyCard, withdrawnCard]) {
    const githubInstall = desktopNodes(card).find(node => node.type === 'button'
      && node.children?.includes('GitHub 地址交由 DSH 安装'))
    assert.ok(githubInstall, 'unlisted, candidate, and public-only DSH plugins share the DSH install handoff')
    assert.equal(githubInstall.props.disabled, false)
  }
  assert.match(desktopText(tree), /AI 与智能体/)
  const directorySearch = desktopNodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  assert.ok(directorySearch)
  const viewport = desktopNodes(tree).find(node => node.props?.['aria-label'] === '全部已知插件结果')
  assert.equal(viewport.props.style.overflow, 'visible')
  assert.equal(viewport.children.length, 1, 'the list and pagination share the marketplace scroll flow')
  const root = desktopNodes(tree).find(node => node.type === 'section' && node.props?.['aria-label'].startsWith('插件商城（DSH-Store）'))
  assert.match(root.props.style.height, /100vh/)
  assert.equal(root.props.style.overflowY, 'auto')
  assert.equal(root.props.style.marginInline, 'auto')
  assert.equal(root.props.style.padding, '14px clamp(16px, 2.5vw, 30px) 28px')
  assert.equal(desktopNodes(tree).find(node => node.props?.['aria-label'] === '全部已知插件').props.style.gap, '14px')
  assert.equal(root.props.tabIndex, 0)
  assert.equal(desktopNodes(tree).find(node => node.props?.['aria-label'] === '目录搜索和筛选').props.style.position, 'sticky')
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

  const search = desktopNodes(detailTree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  assert.ok(search)
  search.props.onChange({ target: { value: 'build-dsh-plugin' } })
  const blockedSearchTree = await harness.render()
  const searchResults = desktopNodes(blockedSearchTree).filter(node => node.type === 'article')
  assert.equal(searchResults.length, 1)
  assert.match(desktopText(searchResults[0]), /dsh-build-plugin/)
  assert.ok(desktopText(blockedSearchTree).includes('Catalog 已拦截 · 1'))
  const blockedDetailsButton = desktopNodes(searchResults[0]).find(node => node.type === 'button' && node.children?.includes('查看详情'))
  blockedDetailsButton.props.onClick()
  const blockedDetailsTree = await harness.render()
  assert.match(desktopText(blockedDetailsTree), /商城审核建议/)
  assert.match(desktopText(blockedDetailsTree), /Automatic policy blocked installation/)
  assert.match(desktopText(blockedDetailsTree), /查看技术检查详情/)
  const blockedDetailActions = desktopNodes(blockedDetailsTree).find(node => node.props?.['aria-label'] === '插件操作')
  assert.equal(desktopNodes(blockedDetailActions).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装')).props.disabled, false)
  const clearBlockedSearch = desktopNodes(blockedDetailsTree).find(node => node.type === 'button' && node.children?.includes('清除筛选'))
  clearBlockedSearch.props.onClick()
  const resetTree = await harness.render()
  const resetSearch = desktopNodes(resetTree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  resetSearch.props.onChange({ target: { value: 'dsh-web-only' } })
  const searchedTree = await harness.render()
  assert.equal(desktopNodes(searchedTree).filter(node => node.type === 'article').length, 1)
  assert.match(desktopText(searchedTree), /Name dsh-web-only/)
  assert.ok(desktopNodes(searchedTree).some(node => node.type === 'select' && node.props['aria-label'] === '按分类筛选'))
  assert.ok(desktopNodes(searchedTree).some(node => node.type === 'select' && node.props['aria-label'] === '排序方式'))
  assert.ok(desktopNodes(searchedTree).some(node => node.type === 'select' && node.props['aria-label'] === '按 DSH STORE 审核状态筛选'))
})

test('Desktop directory keeps records beyond the former 700-item range searchable', async () => {
  const catalog = desktopCatalog([desktopEntry({ id: 'large-directory-anchor', packageName: '@acme/large-directory-anchor', commit: desktopCommit })])
  const directoryDocuments = desktopDirectoryDocuments(catalog)
  const initialCount = directoryDocuments.discovery.entries.length
  const additionalRecords = 805
  for (let index = 0; index < additionalRecords; index++) {
    const sourceIndex = initialCount + index
    const id = `bulk-dsh-plugin-${index}`
    directoryDocuments.discovery.entries.push({
      sourceIndex, sourceId: id, alias: `@acme/${id}`, name: `Bulk DSH plugin ${index}`,
      description: `Large directory fixture ${index}`, stars: additionalRecords - index, categories: ['ai'],
      kind: 'dsh-plugin', repositoryUrl: `https://github.com/acme/${id}`,
      detailUrl: `https://www.dsh.so/artifact/${id}/`,
    })
  }
  directoryDocuments.discovery.source.recordCount = directoryDocuments.discovery.entries.length
  const expectedDirectory = createKnownPluginDirectory(catalog.entries.filter(row => row.status !== 'unlisted'),
    directoryDocuments.candidates.entries, { discoveryIndex: directoryDocuments.discovery })
  const harness = createDesktopHarness({ catalog, directoryDocuments })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(`全部已知插件 · ${expectedDirectory.length}`))
  const search = desktopNodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  search.props.onChange({ target: { value: `bulk-dsh-plugin-${additionalRecords - 1}` } })
  tree = await harness.render()
  const results = desktopNodes(tree).filter(node => node.type === 'article')
  assert.equal(results.length, 1)
  assert.match(desktopText(results[0]), new RegExp(`Bulk DSH plugin ${additionalRecords - 1}`))
  assert.match(desktopText(tree), /1 条结果 · 第 1 \/ 1 页/)
})

test('Desktop full-directory search ignores moderation boilerplate and ranks plugin identity matches first', async () => {
  const image = desktopEntry({ id: 'dsh-image-tool', packageName: '@acme/dsh-image-tool', commit: desktopCommit })
  image.name = 'dsh-image-tool'
  image.description = 'Creates and edits images.'
  image.searchTerms = ['image generation']
  const bodyOnly = desktopEntry({ id: 'text-tool', packageName: '@acme/text-tool', commit: 'b'.repeat(40) })
  bodyOnly.name = 'text-tool'
  bodyOnly.description = 'A simple image utility.'
  const boilerplateOnly = desktopEntry({ id: 'security-audit-helper', packageName: '@acme/security-audit-helper',
    commit: 'c'.repeat(40), status: 'blocked',
    statusReason: 'Automatic policy blocked installation: runtime security warnings require review' })
  boilerplateOnly.name = 'security-audit-helper'
  boilerplateOnly.description = 'Reviews package security.'
  const catalog = desktopCatalog([image, bodyOnly, boilerplateOnly])
  const harness = createDesktopHarness({ catalog, directoryDocuments: desktopDirectoryDocuments(catalog) })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('全部已知插件 · 3'))
  const search = desktopNodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  assert.ok(search)

  search.props.onChange({ target: { value: 'im' } })
  tree = await harness.render()
  let results = desktopNodes(tree).filter(node => node.type === 'article')
  assert.equal(results.length, 1, 'short search excludes incidental description and moderation-reason matches')
  assert.match(desktopText(results[0]), /dsh-image-tool/)

  const updatedSearch = desktopNodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  updatedSearch.props.onChange({ target: { value: 'image' } })
  tree = await harness.render()
  results = desktopNodes(tree).filter(node => node.type === 'article')
  assert.equal(results.length, 2, 'longer searches also match relevant description text')
  assert.match(desktopText(results[0]), /dsh-image-tool/, 'plugin name and package matches rank before body-only matches')
  assert.match(desktopText(results[1]), /text-tool/)

  const imageSearch = desktopNodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  imageSearch.props.onChange({ target: { value: 'installation' } })
  tree = await harness.render()
  assert.equal(desktopNodes(tree).filter(node => node.type === 'article').length, 0,
    'moderation rationale is not user-searchable plugin metadata')
})

test('Store review advice is plain-language, keeps technical evidence expandable, and leaves the final decision to Desktop', async () => {
  const blocked = desktopEntry({ id: 'review-advice-plugin', packageName: '@acme/review-advice-plugin',
    commit: desktopCommit, status: 'blocked',
    statusReason: 'Automatic policy blocked installation: network permission signal; install lifecycle scripts are present: prepare' })
  const harness = createDesktopHarness({ catalog: desktopCatalog([blocked]) })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('review-advice-plugin'))
  let card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('review-advice-plugin'))
  assert.match(desktopText(card), /插件会连接网络/)
  assert.match(desktopText(card), /安装或更新时会自动运行脚本（prepare）/)
  assert.match(desktopText(card), /不代表 DSH Desktop 已拒绝安装/)
  assert.match(desktopText(card), /Automatic policy blocked installation/)
  assert.ok(desktopNodes(card).some(node => node.type === 'details'), 'the exact scanner reason is behind a disclosure control')

  const detailsButton = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('查看详情'))
  detailsButton.props.onClick()
  tree = await harness.render()
  let dialog = desktopNodes(tree).find(node => node.props.role === 'dialog')
  assert.ok(dialog)
  assert.match(desktopText(dialog), /插件会连接网络/)
  assert.match(desktopText(dialog), /查看技术检查详情/)
  assert.match(desktopText(dialog), /最终结果以 DSH 官方插件管理器返回为准/)
  desktopNodes(dialog).find(node => node.type === 'button' && node.children?.includes('关闭详情')).props.onClick()

  tree = await harness.render()
  card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('review-advice-plugin'))
  const handoff = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
  assert.ok(handoff)
  assert.equal(handoff.props.disabled, false)
  handoff.props.onClick()
  tree = await harness.render()
  dialog = desktopNodes(tree).find(node => node.props.role === 'dialog')
  assert.match(desktopText(dialog), /商城审核建议/)
  assert.match(desktopText(dialog), /最终结果以 DSH 官方插件管理器返回为准/)
  assert.equal(harness.calls.installBundle.length, 0, 'the Store advice is shown before the user submits the request to Desktop')
})

test('Desktop recommendation and essential boards match the official website ranking algorithm and show review reasons', async () => {
  const { rankingSnapshot, catalog, directoryDocuments } = desktopRankingFixture()
  const harness = createDesktopHarness({ catalog, directoryDocuments, rankingSnapshot })
  await harness.ready
  await harness.render()
  const panel = harness.getComponent('DesktopStorePanel')
  await harness.runEffects(panel)
  await waitForDesktopTree(harness, tree => desktopText(tree).includes('全部已知插件'))
  const expectedCounts = Object.fromEntries(['recommended', 'essential'].map(type => [type, rankingEntries(rankingSnapshot, type).length]))
  assert.notEqual(expectedCounts.recommended, expectedCounts.essential, 'fixture exposes cross-board count leakage')

  for (const [type, tabPrefix] of [['recommended', '推荐榜单'], ['essential', '必装榜单']]) {
    let tree = await harness.render()
    const tab = desktopNodes(tree).find(node => node.type === 'button' && node.props.role === 'tab'
      && node.children?.some(value => String(value).startsWith(tabPrefix)))
    assert.ok(tab, `${tabPrefix} tab is visible`)
    tab.props.onClick()
    tree = await harness.render()
    await harness.runEffects(panel)
    tree = await waitForDesktopTree(harness, value => desktopText(value).includes(type === 'recommended' ? '官网推荐榜' : '官网必装榜')
      && !desktopText(value).includes('正在读取官网榜单'))
    for (const [countType, countLabel] of [['recommended', '推荐榜单'], ['essential', '必装榜单']]) {
      const countTab = desktopNodes(tree).find(node => node.type === 'button' && node.props.role === 'tab'
        && node.children?.some(value => String(value).startsWith(countLabel)))
      assert.ok(countTab, `${countLabel} tab is visible`)
      assert.match(desktopText(countTab), new RegExp(`${countLabel} · ${expectedCounts[countType]}$`),
        `${countLabel} count stays bound to its own ranking after switching to ${type}`)
    }

    const expectedIds = rankingEntries(rankingSnapshot, type).map(entry => entry.id)
    const pageCount = Math.max(1, Math.ceil(expectedIds.length / 30))
    for (let page = 1; page <= pageCount; page++) {
      if (page > 1) {
        const next = desktopNodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '下一页')
        assert.ok(next, `${tabPrefix} exposes page ${page}`)
        next.props.onClick()
        tree = await harness.render()
        assert.ok(desktopText(tree).includes(`${page} / ${pageCount} 页`))
      }
      const actualIds = desktopNodes(tree).filter(node => node.type === 'article')
        .map(node => node.props['data-market-entry-id'])
      assert.deepEqual(actualIds, expectedIds.slice((page - 1) * 30, page * 30),
        `${tabPrefix} page ${page} follows marketplace/rankings/model.js`)
    }
    if (type === 'recommended') {
      const candidateCard = desktopNodes(tree).find(node => node.type === 'article'
        && node.props['data-market-entry-id'] === 'candidate:pending-review')
      assert.ok(candidateCard)
      assert.match(desktopText(candidateCard), /DSH Store 还没有完成这项来源的收录审核/)
      assert.match(desktopText(candidateCard), /查看技术检查详情/)
      assert.match(desktopText(candidateCard), /Store review is still pending for this plugin\./)
      assert.match(desktopText(candidateCard), /作者互动推荐/)
    } else {
      const supplement = desktopNodes(tree).find(node => node.type === 'article'
        && node.props['data-market-entry-id'] && desktopText(node).includes('工具 · 分类补位 · 可查星标第'))
      assert.ok(supplement, 'Desktop labels category supplements with their category and observed rank')
      assert.match(desktopText(supplement), /1 个插件星标未知，冠军未确认/)
    }
  }

  assert.equal(harness.directoryRequests.filter(item => item.url === desktopRankingIndexUrl).length, 1)
  assert.equal(harness.directoryRequests.filter(item => item.url === desktopRankingDataUrl).length, 1)
})

test('a ranking digest mismatch fails the board closed without disabling full-directory search', async () => {
  const { rankingSnapshot, catalog, directoryDocuments } = desktopRankingFixture()
  const harness = createDesktopHarness({ catalog, directoryDocuments, rankingSnapshot, rankingIndexDigest: 'f'.repeat(64) })
  await harness.ready
  await harness.render()
  const panel = harness.getComponent('DesktopStorePanel')
  await harness.runEffects(panel)
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('全部已知插件'))
  let tab = desktopNodes(tree).find(node => node.type === 'button' && node.props.role === 'tab'
    && node.children?.some(value => String(value).startsWith('推荐榜单')))
  tab.props.onClick()
  tree = await harness.render()
  await harness.runEffects(panel)
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DESKTOP_RANKING_INTEGRITY_MISMATCH'))
  assert.match(desktopText(tree), /官网榜单暂不可用/)
  assert.equal(desktopNodes(tree).some(node => node.type === 'article'), false)

  tab = desktopNodes(tree).find(node => node.type === 'button' && node.props.role === 'tab'
    && node.children?.some(value => String(value).startsWith('全部已知插件')))
  tab.props.onClick()
  tree = await harness.render()
  assert.ok(desktopNodes(tree).some(node => node.type === 'article' && desktopText(node).includes('Name dsh-rank-alpha')))
  const search = desktopNodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  search.props.onChange({ target: { value: 'public-only' } })
  tree = await harness.render()
  assert.equal(desktopNodes(tree).filter(node => node.type === 'article').length, 1)
  assert.match(desktopText(tree), /Public only plugin/)
})

test('Desktop lets DSH decide a rejected candidate after exact GitHub source confirmation', async () => {
  const catalog = desktopCatalog([
    desktopEntry({ id: 'baseline-entry', packageName: '@acme/baseline-entry', commit: desktopCommit }),
  ])
  const candidate = { id: 'candidate-only', name: 'Candidate only plugin', description: 'A candidate with no Catalog record.',
    repositoryUrl: 'https://github.com/acme/candidate-only', status: 'rejected', latestCommit: '7'.repeat(40),
    statusReason: 'Static Store review did not find a standard DSH Bundle.', topics: ['ai'] }
  const harness = createDesktopHarness({
    catalog,
    directoryDocuments: desktopDirectoryDocuments(catalog, { extraCandidates: [candidate] }),
    inspectResult: { status: 'rejected', reason: 'DSH preflight could not verify this repository yet' },
  })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Candidate only plugin'))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(candidate.name))
  assert.ok(card, desktopText(tree))
  assert.match(desktopText(card), /候选审核未通过/)
  assert.match(desktopText(card), /Static Store review did not find a standard DSH Bundle/)
  const install = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('GitHub 地址交由 DSH 安装'))
  assert.ok(install)
  assert.equal(install.props.disabled, false)
  install.props.onClick()
  tree = await harness.render()
  assert.match(desktopText(tree), /Store 候选审核状态：rejected/)
  assert.match(desktopText(tree), /这是商城建议，不是 DSH 的安装结论/)
  assert.equal(harness.calls.installBundle.length, 0)

  const confirmation = 'INSTALL GITHUB acme/candidate-only DEFAULT'
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  const confirm = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并安装'))
  assert.equal(confirm.props.disabled, false)
  await confirm.props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方插件管理器已完成安装')
    && desktopText(value).includes('DSH 已安装 · 已启动'))

  assert.deepEqual(harness.calls.inspect, ['git+https://github.com/acme/candidate-only.git'])
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.installBundle[0].spec, 'git+https://github.com/acme/candidate-only.git')
  assert.equal(harness.calls.installBundle[0].options.enabled, true)
  assert.match(desktopText(tree), /DSH Desktop 预检提示：DSH preflight could not verify this repository yet/)
  const installedCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(candidate.name))
  assert.match(desktopText(installedCard), /DSH 已安装 · 已启动/)
  assert.match(desktopText(installedCard), /已由 DSH Desktop 安装/)
  assert.equal(desktopNodes(installedCard).some(node => node.type === 'button'
    && node.children?.includes('GitHub 地址交由 DSH 安装')), false)
})

test('Web renderer retains the Settings entry without registering a Desktop home panel', async () => {
  const harness = createDesktopHarness({ catalog: desktopCatalog([]), protocol: 'https:' })
  await harness.ready
  assert.deepEqual(harness.slotRegistrations.map(row => row.slot), ['settings.section'])
  assert.equal(harness.settingsRegistrations[0].metadata.id, 'dsh-store')
})

test('Desktop keeps the complete directory searchable when its official install inventory is unavailable', async () => {
  const entry = desktopEntry({ id: 'inventory-independent', packageName: '@acme/inventory-independent', commit: desktopCommit })
  const catalog = desktopCatalog([entry])
  const directoryDocuments = desktopDirectoryDocuments(catalog)
  const expectedDirectory = createKnownPluginDirectory(catalog.entries.filter(row => row.status !== 'unlisted'),
    directoryDocuments.candidates.entries, { discoveryIndex: directoryDocuments.discovery })
  const harness = createDesktopHarness({ catalog, directoryDocuments, listBundlesError: true })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(`全部已知插件 · ${expectedDirectory.length}`))
  assert.match(desktopText(tree), /DSH 安装清单暂不可用（DESKTOP_INVENTORY_FAILED）/)
  assert.match(desktopText(tree), /完整目录和搜索仍可使用/)
  const search = desktopNodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  assert.ok(search)
  search.props.onChange({ target: { value: 'public-only' } })
  tree = await harness.render()
  const publicCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('Public only plugin'))
  assert.ok(publicCard, 'directory search remains independent of the DSH installed list')
  search.props.onChange({ target: { value: 'inventory-independent' } })
  tree = await harness.render()
  const catalogCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('@acme/inventory-independent'))
  const install = desktopNodes(catalogCard).find(node => node.type === 'button' && node.children?.includes('安装'))
  assert.ok(install)
  assert.equal(install.props.disabled, true, 'state-dependent installs wait for an authoritative DSH inventory')
  assert.match(install.props.title, /DSH 安装清单暂不可用/)
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
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Catalog 已拦截 · DSH 可检查'))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('dsh-build-plugin'))
  const install = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
  assert.ok(install)
  assert.equal(install.props.disabled, false)
  install.props.onClick()
  tree = await harness.render()
  const warning = desktopText(tree)
  assert.match(warning, /商城审核建议/)
  assert.match(warning, /Automatic policy blocked installation/)
  assert.match(warning, /DSH Store 的参考提示，不代表 DSH Desktop 已拒绝安装/)
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
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方插件管理器已完成安装')
    && desktopText(value).includes('DSH 已安装 · 已启动'))
  const installedBlockedCard = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes('dsh-build-plugin'))
  assert.match(desktopText(installedBlockedCard), /Catalog 已拦截/)
  assert.match(desktopText(installedBlockedCard), /DSH 已安装 · 已启动/)
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
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Catalog 已拦截 · DSH 可检查'))
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
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Catalog 已拦截 · DSH 可检查'))
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
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Catalog 已拦截 · DSH 可检查'))
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
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes('Catalog 已拦截 · DSH 可检查'))
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
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes('5 Catalog 已拦截'))
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

test('official Desktop uses compact wrapping tabs and restores the full-directory Desktop adaptation filter', async () => {
  const catalogInstalled = desktopEntry({ id: 'dsh-installed-view', packageName: '@acme/dsh-installed-view', commit: 'b'.repeat(40) })
  const webOnlyCatalog = desktopEntry({ id: 'dsh-web-only', packageName: '@acme/dsh-web-only', commit: 'd'.repeat(40), profiles: ['web'] })
  const harness = createDesktopHarness({
    catalog: desktopCatalog([catalogInstalled, webOnlyCatalog]),
    installed: [
      { name: '@deepseek-ai/dsh-official-plugin', official: true, installed: true, removable: false, enabled: true,
        version: '0.2.2-alpha.2', source: 'npm:@deepseek-ai/dsh-official-plugin@0.2.2-alpha.2' },
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
    && node.children?.some(value => String(value).startsWith('Catalog 审核记录 · ')))
  assert.ok(catalogTab)

  const tabList = desktopNodes(catalogTree).find(node => node.props.role === 'tablist' && node.props['aria-label'] === '插件商城视图')
  assert.ok(tabList)
  assert.equal(tabList.props.style.display, 'flex')
  assert.equal(tabList.props.style.flexWrap, 'wrap')
  assert.equal(tabList.props.style.justifyContent, 'flex-start')
  assert.equal(tabList.props.style.gap, '8px 10px')
  const viewTabs = desktopNodes(tabList).filter(node => node.type === 'button' && node.props.role === 'tab')
  assert.equal(viewTabs.length, 5)
  assert.ok(viewTabs.every(node => node.props.style.width === 'auto'), 'navigation tabs keep their content-sized width')
  assert.ok(viewTabs.every(node => node.props.style.flex === '0 0 auto'), 'unused space does not stretch navigation tabs')
  assert.ok(viewTabs.every(node => node.props.style.minHeight === '46px'))
  assert.equal(desktopNodes(catalogTree).some(node => node.props?.['aria-label'] === '本机插件视图'), false,
    'official and installed tabs stay inside the plugin section')

  let adaptationFilter = desktopNodes(catalogTree).find(node => node.type === 'select'
    && node.props['aria-label'] === '按 DSH Desktop 适配声明筛选')
  assert.ok(adaptationFilter)
  assert.equal(adaptationFilter.props.title, '只按 Catalog 是否声明 Desktop Profile 筛选；未声明不等于不兼容。')
  assert.ok(desktopText(adaptationFilter).includes('已声明适配 DSH Desktop · 1'))
  adaptationFilter.props.onChange({ target: { value: 'declared' } })
  const declaredDirectory = await harness.render()
  assert.match(desktopText(declaredDirectory), /1 条结果/)
  assert.match(desktopText(declaredDirectory), /dsh-installed-view/)
  assert.doesNotMatch(desktopText(declaredDirectory), /dsh-web-only/)

  adaptationFilter = desktopNodes(declaredDirectory).find(node => node.type === 'select'
    && node.props['aria-label'] === '按 DSH Desktop 适配声明筛选')
  adaptationFilter.props.onChange({ target: { value: 'undeclared' } })
  const undeclaredDirectory = await harness.render()
  assert.match(desktopText(undeclaredDirectory), /dsh-web-only/)
  assert.doesNotMatch(desktopText(undeclaredDirectory), /Name dsh-installed-view/)
  assert.ok(desktopNodes(undeclaredDirectory).some(node => node.type === 'button' && node.children?.includes('清除筛选')))

  const directorySearch = desktopNodes(undeclaredDirectory).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  directorySearch.props.onChange({ target: { value: 'local-unlisted-plugin' } })
  let searchedDirectory = await harness.render()
  const localPluginsTab = desktopNodes(searchedDirectory).find(node => node.type === 'button' && node.props.role === 'tab'
    && node.children?.includes('本机插件'))
  assert.ok(localPluginsTab)
  localPluginsTab.props.onClick()
  let pluginTree = await harness.render()
  let pluginTabList = desktopNodes(pluginTree).find(node => node.props.role === 'tablist' && node.props['aria-label'] === '本机插件视图')
  assert.ok(pluginTabList)
  assert.equal(pluginTabList.props.style.display, 'flex')
  assert.equal(pluginTabList.props.style.flexWrap, 'wrap')
  assert.equal(pluginTabList.props.style.alignSelf, 'flex-start')
  assert.equal(pluginTabList.props.style.borderRadius, '12px')
  assert.equal(desktopNodes(pluginTabList).filter(node => node.type === 'button' && node.props.role === 'tab').length, 2)
  let installedTab = desktopNodes(pluginTabList).find(node => node.type === 'button'
    && node.children?.some(value => String(value).startsWith('已安装插件 · 2')))
  let officialTab = desktopNodes(pluginTabList).find(node => node.type === 'button'
    && node.children?.some(value => String(value).startsWith('官方插件 · 2')))
  assert.ok(installedTab)
  assert.ok(officialTab)
  assert.equal(installedTab.props['aria-selected'], true)
  assert.equal(officialTab.props['aria-selected'], false)
  officialTab.props.onClick()

  const officialTree = await harness.render()
  assert.ok(desktopNodes(officialTree).some(node => node.type === 'button' && node.props.role === 'tab'
    && node.props['aria-selected'] === true && node.children?.some(value => String(value).startsWith('官方插件 · '))))
  assert.match(desktopText(officialTree), /这里只展示 Desktop 安装清单中标记为官方或随 DSH 提供的组件/)
  assert.match(desktopText(officialTree), /@deepseek-ai\/dsh-official-plugin/)
  assert.match(desktopText(officialTree), /dsh\.desktop-runtime/)
  assert.doesNotMatch(desktopText(officialTree), /local-unlisted-plugin|@acme\/dsh-installed-view/)
  const officialCard = desktopNodes(officialTree).find(node => node.type === 'article' && desktopText(node).includes('@deepseek-ai/dsh-official-plugin'))
  assert.ok(officialCard)
  assert.ok(desktopNodes(officialCard).some(node => node.type === 'button' && node.children?.includes('DSH 官方管理') && node.props.disabled))

  const officialSearch = desktopNodes(officialTree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索官方插件')
  officialSearch.props.onChange({ target: { value: '@deepseek-ai' } })
  assert.match(desktopText(await harness.render()), /1 条结果/)
  const filteredOfficialTree = await harness.render()
  const installedTabAfterSearch = desktopNodes(filteredOfficialTree).find(node => node.type === 'button' && node.props.role === 'tab'
    && node.children?.some(value => String(value).startsWith('已安装插件 · ')))
  installedTabAfterSearch.props.onClick()

  const installedTree = await harness.render()
  assert.ok(desktopNodes(installedTree).some(node => node.type === 'button' && node.props.role === 'tab'
    && node.props['aria-selected'] === true && node.children?.some(value => String(value).startsWith('已安装插件 · '))))
  assert.match(desktopText(installedTree), /2 已安装插件/)
  assert.match(desktopText(installedTree), /目录外只读/)
  assert.match(desktopText(installedTree), /local-unlisted-plugin/)
  assert.doesNotMatch(desktopText(installedTree), /@deepseek-ai\/dsh-official-plugin|dsh\.desktop-runtime/)
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
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH Desktop 已安装清单确认目标包当前已安装'))
  assert.doesNotMatch(desktopText(tree), /操作未完成|NO_DEPENDENCY_CHANGES/)
  assert.equal(harness.calls.installBundle.length, 1)
  assert.ok(harness.calls.listBundles >= 2)
  assert.equal(harness.calls.waitForInstall.length, 0)
})

test('Desktop updates an older fixed GitHub revision through DSH remove and install after exact Commit confirmation', async () => {
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
  assert.deepEqual(harness.calls.removeBundle, [entry.packageName])
})

test('DSH Store can update its own installed package through the official Desktop manager', async () => {
  const entry = desktopEntry({ id: 'dsh-safe-plugin-manager', packageName: 'dsh-safe-plugin-manager', commit: desktopCommit,
    repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store' })
  entry.version = '0.9.25'
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: false,
    enabled: true, version: '0.9.24', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const updated = { ...installed, version: entry.version, source: `git+${entry.repositoryUrl}.git#${desktopCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    installResult: { application: 'failed', changed: false, stage: 'install', target: entry.packageName,
      error: { code: 'PACKAGE_CHANGE_AMBIGUOUS' } },
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
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH Desktop 已安装清单确认当前来源与目标固定 Commit 一致'))
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.installBundle[0].spec, `git+${entry.repositoryUrl}.git#${desktopCommit}`)
  assert.deepEqual(harness.calls.removeBundle, [])
  assert.ok(harness.calls.listBundles >= 2)
})

test('Store self-update accepts a legacy install with no full source Commit and no removeBundle API', async () => {
  const entry = desktopEntry({ id: 'dsh-safe-plugin-manager', packageName: 'dsh-safe-plugin-manager', commit: desktopCommit,
    repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store' })
  entry.version = '0.9.27'
  const installed = { name: entry.packageName, official: false, installed: true, removable: false,
    enabled: true, version: '0.9.26', source: 'git+https://github.com/AI-Scarlett/DSH-Store.git' }
  const updated = { ...installed, version: entry.version, source: `git+${entry.repositoryUrl}.git#${desktopCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    removeBundleAvailable: false,
    installResult: { application: 'failed', changed: false, stage: 'install', target: entry.packageName,
      error: { code: 'PACKAGE_CHANGE_AMBIGUOUS' } },
    installedAfterInstallResult: [updated] })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  const update = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('更新'))
  assert.ok(update, 'the older Store version exposes the DSH self-update action without removeBundle')
  update.props.onClick()
  tree = await harness.render()
  const confirmation = `UPDATE ${entry.packageName} ${desktopCommit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  await desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并更新')).props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH Desktop 已安装清单确认当前来源与目标固定 Commit 一致'))
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.installBundle[0].spec, `git+${entry.repositoryUrl}.git#${desktopCommit}`)
  assert.deepEqual(harness.calls.removeBundle, [])
  assert.equal(harness.calls.waitForInstall.length, 0)
})

test('Store self-update preserves a DSH rejection for an unpinned old source and never retries', async () => {
  const entry = desktopEntry({ id: 'dsh-safe-plugin-manager', packageName: 'dsh-safe-plugin-manager', commit: desktopCommit,
    repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store' })
  entry.version = '0.9.27'
  const installed = { name: entry.packageName, official: false, installed: true, removable: false,
    enabled: true, version: '0.9.26', source: 'git+https://github.com/AI-Scarlett/DSH-Store.git' }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    removeBundleAvailable: false,
    installResult: { application: 'failed', changed: false, stage: 'install', target: entry.packageName,
      error: { code: 'DSH_FIXED_SOURCE_REJECTED', reason: 'official DSH rejection' } } })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('更新')).props.onClick()
  tree = await harness.render()
  const confirmation = `UPDATE ${entry.packageName} ${desktopCommit}`
  desktopNodes(tree).find(node => node.type === 'input' && node.props.placeholder === confirmation)
    .props.onChange({ target: { value: confirmation } })
  tree = await harness.render()
  await desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('确认并更新')).props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('旧固定 Commit 未知 保留'))
  assert.ok(desktopText(tree).includes('DSH_FIXED_SOURCE_REJECTED'))
  assert.equal(harness.calls.installBundle.length, 1)
  assert.deepEqual(harness.calls.removeBundle, [])
  assert.equal(harness.calls.waitForInstall.length, 0)
})

test('Store self-update does not offer a downgrade when its installed stable version is newer', async () => {
  const entry = desktopEntry({ id: 'dsh-safe-plugin-manager', packageName: 'dsh-safe-plugin-manager', commit: desktopCommit,
    repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store' })
  entry.version = '0.9.27'
  const installed = { name: entry.packageName, official: false, installed: true, removable: false,
    enabled: true, version: '0.9.28', source: 'git+https://github.com/AI-Scarlett/DSH-Store.git' }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    removeBundleAvailable: false })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes(entry.packageName))
  const card = desktopNodes(tree).find(node => node.type === 'article' && desktopText(node).includes(entry.packageName))
  const update = desktopNodes(card).find(node => node.type === 'button' && node.children?.includes('更新'))
  assert.ok(update)
  assert.equal(update.props.disabled, true)
  assert.match(update.props.title, /未提交降级更新/)
  assert.equal(harness.calls.installBundle.length, 0)
  assert.deepEqual(harness.calls.removeBundle, [])
})

test('DSH stop-profile removal outcome follows the official update path and still submits the fixed Commit', async () => {
  const entry = desktopEntry({ id: 'dsh-stop-profile-update', packageName: '@acme/dsh-stop-profile-update', commit: desktopCommit })
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: '1.0.0', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const updated = { ...installed, version: entry.version, source: `git+${entry.repositoryUrl}.git#${desktopCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    removeResult: { application: 'failed', changed: false, stage: 'remove', target: entry.packageName,
      error: { code: 'stop-profile' } },
    installResult: { application: 'applied', changed: true, stage: 'install', target: entry.packageName },
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
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 官方插件管理器已完成更新'))
  assert.deepEqual(harness.calls.removeBundle, [entry.packageName])
  assert.equal(harness.calls.installBundle.length, 1)
  assert.equal(harness.calls.installBundle[0].spec, `git+${entry.repositoryUrl}.git#${desktopCommit}`)
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
    removeResult: { application: 'restart-required', changed: true, stage: 'remove', target: entry.packageName },
    retainInstalledAfterRemove: true,
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
  assert.match(desktopText(tree), new RegExp(`旧固定 Commit ${oldCommit} 保留`))
  assert.equal(harness.calls.installBundle.length, 1)
  assert.deepEqual(harness.calls.removeBundle, [entry.packageName])
  assert.equal(harness.calls.waitForInstall.length, 0)
})

test('a definite target failure restores the prior fixed source through DSH and reports its reload result', async () => {
  const entry = desktopEntry({ id: 'dsh-update-restore', packageName: '@acme/dsh-update-restore', commit: desktopCommit })
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: '1.0.0', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const targetSpec = `git+${entry.repositoryUrl}.git#${desktopCommit}`
  const oldSpec = installed.source
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    installResult: spec => spec === targetSpec
      ? { application: 'failed', changed: false, stage: 'install', error: { code: 'TARGET_COMMIT_REFUSED' } }
      : { application: 'restart-required', changed: true, stage: 'install' },
    installedAfterInstallResult: [] })
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
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DSH 已接受恢复旧固定 Commit'))
  assert.deepEqual(harness.calls.installBundle.map(call => call.spec), [targetSpec, oldSpec])
  assert.match(desktopText(tree), new RegExp(`旧固定 Commit ${oldCommit}，需按 DSH 流程重载`))
  assert.equal(harness.calls.waitForInstall.length, 0)
})

test('an uncertain update result is reconciled once and never resubmitted or rolled back blindly', async () => {
  const entry = desktopEntry({ id: 'dsh-update-unknown', packageName: '@acme/dsh-update-unknown', commit: desktopCommit })
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: '1.0.0', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    installResult: async () => { const error = new Error('result unavailable'); error.code = 'DESKTOP_INSTALL_TIMEOUT'; throw error } })
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
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('操作结果暂时无法确认'))
  assert.equal(harness.calls.installBundle.length, 1)
  assert.deepEqual(harness.calls.removeBundle, [entry.packageName])
  assert.equal(harness.calls.waitForInstall.length, 1)
})

test('DSH restart-required update result is accepted while its installed inventory is still catching up', async () => {
  const entry = desktopEntry({ id: 'dsh-update-restart', packageName: '@acme/dsh-update-restart', commit: desktopCommit })
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: '1.0.0', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    removeResult: { application: 'restart-required', changed: true, stage: 'remove', target: entry.packageName },
    retainInstalledAfterRemove: true,
    installResult: { application: 'restart-required', changed: true, stage: 'install', target: entry.packageName },
    installedAfterInstallResult: [installed] })
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
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('操作已写入 Desktop Profile'))
  assert.equal(harness.calls.installBundle.length, 1)
  assert.deepEqual(harness.calls.removeBundle, [entry.packageName])
  assert.equal(harness.calls.waitForInstall.length, 0)
})

test('DSH refusal to remove an installed bundle prevents the update install request', async () => {
  const entry = desktopEntry({ id: 'dsh-update-remove-refused', packageName: '@acme/dsh-update-remove-refused', commit: desktopCommit })
  const oldCommit = 'b'.repeat(40)
  const installed = { name: entry.packageName, official: false, installed: true, removable: true,
    enabled: true, version: '1.0.0', source: `git+${entry.repositoryUrl}.git#${oldCommit}` }
  const harness = createDesktopHarness({ catalog: desktopCatalog([entry]), installed: [installed],
    removeResult: { application: 'failed', changed: false, stage: 'remove', target: entry.packageName,
      error: { code: 'PACKAGE_REMOVE_REFUSED' } } })
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
  tree = await waitForDesktopTree(harness, value => desktopText(value).includes('PACKAGE_REMOVE_REFUSED'))
  assert.equal(harness.calls.installBundle.length, 0)
  assert.deepEqual(harness.calls.removeBundle, [entry.packageName])
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
  tree = await waitForDesktopTree(harness, value => desktopNodes(value)
    .some(node => node.type === 'button' && node.children?.includes('启动')))
  assert.ok(desktopNodes(tree).some(node => node.type === 'button' && node.children?.includes('启动')))
  await runConfirmed('启动', `START ${entry.packageName} ${desktopCommit}`, 'DSH 官方插件管理器已完成启动')
  assert.deepEqual(harness.calls.setBundleEnabled.at(-1), { name: entry.packageName, enabled: true })

  const finishStart = desktopNodes(tree).find(node => node.type === 'button' && node.children?.includes('完成'))
  finishStart.props.onClick()
  tree = await waitForDesktopTree(harness, value => desktopNodes(value)
    .some(node => node.type === 'button' && node.children?.includes('卸载')))
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

test('Desktop does not label a mismatched website index as the complete directory', async () => {
  const entry = desktopEntry({ id: 'catalog-index-drift', packageName: '@acme/catalog-index-drift', commit: desktopCommit })
  const catalog = desktopCatalog([entry])
  const directoryDocuments = desktopDirectoryDocuments(catalog)
  directoryDocuments.catalogIndex.entries[0].nameZh = 'X'.repeat(directoryDocuments.catalogIndex.entries[0].nameZh.length)
  directoryDocuments.catalogIndexRaw = JSON.stringify(directoryDocuments.catalogIndex)
  const harness = createDesktopHarness({ catalog, directoryDocuments })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  const tree = await waitForDesktopTree(harness, value => desktopText(value).includes('DESKTOP_CATALOG_INDEX_INTEGRITY_MISMATCH'))
  assert.match(desktopText(tree), /全部已知插件 · 暂不可用/)
  assert.match(desktopText(tree), /下方仅显示 Catalog 回退记录，搜索结果不代表全部插件/)
  assert.equal(desktopNodes(tree).some(node => node.type === 'article'), true,
    'Catalog fallback remains readable without being called the complete directory')
  assert.equal(harness.calls.installBundle.length, 0)
})

test('current trusted Registry Catalog is accepted by the Desktop reader', async () => {
  const catalog = JSON.parse(await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8'))
  const catalogIndexRaw = await readFile(new URL('../registry/catalog-index.json', import.meta.url), 'utf8')
  const catalogIndex = JSON.parse(await readFile(new URL('../registry/catalog-index.json', import.meta.url), 'utf8'))
  const discovery = JSON.parse(await readFile(new URL('../registry/discovery-index.json', import.meta.url), 'utf8'))
  const candidates = JSON.parse(await readFile(new URL('../registry/candidates.json', import.meta.url), 'utf8'))
  const expectedDirectory = createKnownPluginDirectory(catalogIndex.entries, candidates.entries, { discoveryIndex: discovery })
  const catalogIndexById = new Map(catalogIndex.entries.map(entry => [entry.id, entry]))
  const expectedDirectoryStatusCount = status => expectedDirectory.filter(entry => entry.collectedBy
    && catalogIndexById.get(entry.collectedBy)?.status === status).length
  const expectedApproved = catalog.entries.filter(entry => entry.status === 'approved').length
  const expectedBlocked = catalog.entries.filter(entry => entry.status === 'blocked').length
  const harness = createDesktopHarness({ catalog, directoryDocuments: { catalogIndex, catalogIndexRaw, discovery, candidates } })
  await harness.ready
  await harness.render()
  await harness.runEffects(harness.getComponent('DesktopStorePanel'))
  let tree = await waitForDesktopTree(harness, value => desktopText(value).includes(`全部已知插件 · ${expectedDirectory.length}`))
  const text = desktopText(tree)
  assert.match(text, new RegExp(`全部已知插件 · ${expectedDirectory.length}`))
  assert.match(text, new RegExp(`Catalog 有记录 · ${expectedDirectory.filter(entry => entry.collected).length}`))
  assert.match(text, new RegExp(`Catalog 未收录 · ${expectedDirectory.filter(entry => !entry.collected).length}`))
  assert.match(text, new RegExp(`Catalog 审核记录 · ${catalog.entries.filter(entry => entry.status !== 'unlisted').length}`))
  assert.match(text, new RegExp(`Catalog 已审核 · ${expectedDirectoryStatusCount('approved')}`))
  assert.match(text, new RegExp(`Catalog 已拦截 · ${expectedDirectoryStatusCount('blocked')}`))
  const categoryOptions = desktopNodes(tree).find(node => node.type === 'select' && node.props?.['aria-label'] === '按分类筛选')
    .children.flat(Infinity).filter(node => node?.type === 'option')
  const expectedCategoryCount = new Set(expectedDirectory.flatMap(entry => entry.categories || [])).size
  assert.equal(categoryOptions.length, expectedCategoryCount + 1)
  const firstPageCardCount = desktopNodes(tree).filter(node => node.type === 'article').length
  const expectedPageCount = Math.ceil(expectedDirectory.length / firstPageCardCount)
  assert.match(text, new RegExp(`${expectedPageCount} 页`))
  const viewport = desktopNodes(tree).find(node => node.props?.['aria-label'] === '全部已知插件结果')
  assert.equal(viewport.props.style.overflow, 'visible')
  const root = desktopNodes(tree).find(node => node.type === 'section' && node.props?.['aria-label'].startsWith('插件商城（DSH-Store）'))
  assert.equal(root.props.style.overflowY, 'auto')
  assert.equal(expectedApproved, 33)
  assert.equal(expectedBlocked, 746)
  const nextPage = desktopNodes(tree).find(node => node.type === 'button' && node.props?.['aria-label'] === '下一页')
  assert.ok(nextPage)
  assert.equal(nextPage.props.disabled, false)
  nextPage.props.onClick()
  tree = await harness.render()
  assert.match(desktopText(tree), new RegExp(`2 \/ ${expectedPageCount} 页`))
  const expectedDesktop = catalog.entries.filter(entry => entry.status !== 'unlisted' && entry.compatibility?.profiles?.includes('desktop')).length
  assert.ok(expectedDesktop > 0)
  const search = desktopNodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '搜索全部已知插件')
  assert.ok(search)
  const farRow = discovery.entries.at(-1)
  search.props.onChange({ target: { value: farRow.sourceId } })
  const searchedPublic = await harness.render()
  const publicMatches = desktopNodes(searchedPublic).filter(node => node.type === 'article')
  assert.equal(publicMatches.length, 1)
  assert.ok(desktopText(publicMatches[0]).includes(farRow.sourceId))
  const expectedFarRow = expectedDirectory.find(entry => entry.sourceId === farRow.sourceId)
  const category = desktopNodes(searchedPublic).find(node => node.type === 'select' && node.props?.['aria-label'] === '按分类筛选')
  assert.ok(category)
  category.props.onChange({ target: { value: expectedFarRow.categories[0] } })
  const categoryFiltered = await harness.render()
  assert.match(desktopText(categoryFiltered), /1 条结果/)
  const sort = desktopNodes(categoryFiltered).find(node => node.type === 'select' && node.props?.['aria-label'] === '排序方式')
  sort.props.onChange({ target: { value: 'stars' } })
  assert.match(desktopText(await harness.render()), /1 条结果/)
  const listedFilter = desktopNodes(searchedPublic).find(node => node.type === 'button'
    && String(node.children?.[0] || node.children).startsWith('Catalog 未收录 · '))
  assert.ok(listedFilter)
  listedFilter.props.onClick()
  const listingFiltered = await harness.render()
  assert.match(desktopText(listingFiltered), expectedFarRow.collected ? /0 条结果/ : /1 条结果/)
  const clearDirectoryFilters = desktopNodes(listingFiltered).find(node => node.type === 'button'
    && node.children?.includes('清除筛选'))
  assert.ok(clearDirectoryFilters)
  clearDirectoryFilters.props.onClick()
  const clearedDirectoryFilters = await harness.render()
  const clearedSearch = desktopNodes(clearedDirectoryFilters).find(node => node.type === 'input'
    && node.props['aria-label'] === '搜索全部已知插件')
  clearedSearch.props.onChange({ target: { value: 'build-dsh-plugin' } })
  const searched = await harness.render()
  const matches = desktopNodes(searched).filter(node => node.type === 'article')
  assert.ok(matches.length >= 1)
  const blockedPlugin = matches.find(node => desktopText(node).includes('dsh-build-plugin')
    && desktopText(node).includes('Catalog 已拦截 · DSH 可检查'))
  assert.ok(blockedPlugin)
  const reviewFilter = desktopNodes(searched).find(node => node.type === 'select'
    && node.props?.['aria-label'] === '按 DSH STORE 审核状态筛选')
  reviewFilter.props.onChange({ target: { value: 'blocked' } })
  const reviewFiltered = await harness.render()
  assert.equal(desktopNodes(reviewFiltered).filter(node => node.type === 'article').length, 1)
  assert.match(desktopText(blockedPlugin), /build-dsh-plugin/)
  const handoff = desktopNodes(blockedPlugin).find(node => node.type === 'button' && node.children?.includes('交由 DSH 检查安装'))
  assert.ok(handoff)
  assert.equal(handoff.props.disabled, false)
  assert.equal(harness.requests[0].url, desktopCatalogUrl)
  assert.ok(harness.directoryRequests.some(request => request.url === desktopCatalogIndexUrl))
  assert.ok(harness.directoryRequests.some(request => request.url === desktopDiscoveryUrl))
  assert.ok(harness.directoryRequests.some(request => request.url === desktopCandidatesUrl))
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
