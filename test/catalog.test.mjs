import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  assertLegacyCatalogCompatibility, buildMarketplaceSnapshot, catalogBridgeBuffer, createCatalogService, githubInstallSpecifier,
  compareCatalogEntries, compareVersions, createDshReleaseContext, dshReleaseCompatibility, dshVersionCompatibility,
  MAX_CATALOG_BRIDGE_RESPONSE_BYTES, MAX_CATALOG_INDEX_RESPONSE_BYTES, MAX_CATALOG_RESPONSE_BYTES,
  loadCatalogFromFiles, paginateMarketplaceSnapshot, projectDshRelease,
  searchCatalog, splitCatalogDocument, validateCatalog, validateCatalogBridgeIndex, validateCatalogDetail,
  validateCatalogIndex, verifyCatalogEntry,
} from '../src/catalog.mjs'
import {
  buildMarketplaceSnapshot as buildMarketplaceSnapshot085,
  compareVersions as compareVersions085,
  validateCatalog as validateCatalog085,
} from './fixtures/catalog-validator-0.8.5.mjs'
import {
  buildMarketplaceSnapshot as buildMarketplaceSnapshot086,
  compareVersions as compareVersions086,
  validateCatalog as validateCatalog086,
} from './fixtures/catalog-validator-0.8.6.mjs'
import {
  buildMarketplaceSnapshot as buildMarketplaceSnapshot087,
  compareVersions as compareVersions087,
  validateCatalog as validateCatalog087,
} from './fixtures/catalog-validator-0.8.7.mjs'

const entry = {
  id: 'demo', name: 'Demo', packageName: 'dsh-demo', description: 'demo plugin',
  repositoryUrl: 'https://github.com/example/dsh-demo', defaultBranch: 'main',
  manifestPath: 'package.json', commit: 'a'.repeat(40), version: '1.2.0',
  categories: ['tools'], featured: true, entryIds: ['demo'], status: 'approved',
  compatibility: { dsh: '>=0.1.0', node: '>=22', systems: ['Linux'], profiles: ['web'] },
  details: {
    pluginType: 'feature', installSource: 'github', license: 'MIT',
    permissions: { level: 'medium', files: 'read-only', network: 'none', commands: 'none', credentials: ['none'] },
    externalDependencies: [], reviewStatus: 'automated-scan',
  },
  risk: { installScripts: [], review: 'curated-not-security-audited' },
}

function document(entries = [entry]) {
  return {
    schemaVersion: 1,
    registry: {
      name: 'Fixture', repositoryUrl: 'https://github.com/example/registry',
      homepageUrl: 'https://example.github.io/registry', updatedAt: '2026-08-16T00:00:00Z',
      trustPolicy: { candidateInstallDisabled: true, unknownIsNotVerified: true, promotionIndependentOfVerification: true },
      categories: { tools: '工具' },
    },
    entries,
  }
}

test('catalog accepts only pinned GitHub plugin entries', () => {
  const catalog = validateCatalog(document())
  assert.equal(catalog.entries.length, 1)
  assert.equal(githubInstallSpecifier(catalog.entries[0]), `git+https://github.com/example/dsh-demo.git#${'a'.repeat(40)}`)
  assert.equal(searchCatalog(catalog, 'TOOLS')[0].id, 'demo')
  assert.equal(searchCatalog(catalog, 'MIT')[0].id, 'demo')
  assert.equal(catalog.entries[0].featured, true)
  assert.equal(catalog.entries[0].details.permissions.files, 'read-only')
  assert.deepEqual(catalog.entries[0].compatibility.profiles, ['web'])
  assert.equal(catalog.entries[0].assurance.discovery.status, 'verified')
  assert.equal(catalog.entries[0].assurance.runtime.status, 'unknown')
  assert.deepEqual(catalog.entries[0].compatibility.dshOperations['rc.8'], {
    install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown',
  })
  assert.throws(() => validateCatalog(document([{ ...entry, repositoryUrl: 'https://example.test/repo' }])), /github\.com/)
  assert.throws(() => validateCatalog(document([entry, { ...entry, id: 'two' }])), /duplicate catalog package/)
  assert.throws(() => validateCatalog(document([{ ...entry, details: { ...entry.details, pluginType: 'daemon' } }])), /pluginType/)
  assert.throws(() => validateCatalog(document([{
    ...entry,
    details: { ...entry.details, permissions: { ...entry.details.permissions, credentials: [] } },
  }])), /credentials must contain at least 1 value/)
  assert.throws(() => validateCatalog(document([{ ...entry, details: undefined }])), /details must be an object/)
})

test('catalog keeps partial evidence distinct from verified and unknown', () => {
  const partial = validateCatalog(document([{ ...entry, assurance: {
    discovery: { status: 'verified', method: 'fixed-source', checkedAt: '2026-08-24T00:00:00Z', evidenceUrl: 'https://github.com/example/dsh-demo/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    installability: { status: 'partial', method: 'disposable-profile-install', checkedAt: '2026-08-24T00:00:00Z', evidenceUrl: 'https://github.com/example/dsh-demo/releases/tag/v1.2.0', summary: 'Local disposable Profile install passed; public runtime evidence is pending.' },
    runtime: { status: 'unknown', summary: 'No runtime evidence yet.' },
    securityReview: { status: 'partial', method: 'fixed-source-policy', checkedAt: '2026-08-24T00:00:00Z', evidenceUrl: 'https://github.com/example/dsh-demo/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', summary: 'Bounded policy checks passed; this is not an independent audit.' },
  } }])).entries[0]
  assert.equal(partial.assurance.installability.status, 'partial')
  assert.equal(partial.assurance.securityReview.status, 'partial')
  assert.throws(() => validateCatalog(document([{ ...entry, assurance: {
    installability: { status: 'partial', summary: 'missing evidence anchors' },
  } }])), /partial evidence requires method, checkedAt, and evidenceUrl/)
})

test('catalog projects a legacy-compatible partial bridge without weakening current evidence', () => {
  const bridgedRecord = {
    status: 'unknown', evidenceStatus: 'partial', method: 'disposable-profile-install',
    checkedAt: '2026-08-26T00:00:00Z', evidenceUrl: 'https://github.com/example/dsh-demo/releases/tag/v1.2.0',
    summary: 'Bounded install evidence exists; real Profile acceptance remains pending.',
  }
  const catalog = validateCatalog(document([{ ...entry, assurance: { installability: bridgedRecord } }]))
  assert.equal(catalog.entries[0].assurance.installability.status, 'partial')
  assert.equal(bridgedRecord.status, 'unknown', '0.8.2 reads the conservative legacy status')
  assert.equal(assertLegacyCatalogCompatibility(document([{ ...entry, assurance: { installability: bridgedRecord } }])), true)
  assert.throws(() => assertLegacyCatalogCompatibility(document([{ ...entry, assurance: {
    installability: { ...bridgedRecord, status: 'partial', evidenceStatus: undefined },
  } }])), /wire status unsupported by 0\.8\.2/)
  assert.throws(() => validateCatalog(document([{ ...entry, assurance: {
    installability: { ...bridgedRecord, status: 'verified' },
  } }])), /evidenceStatus requires the legacy wire status unknown/)
  assert.throws(() => validateCatalog(document([{ ...entry, assurance: {
    installability: { status: 'unknown', evidenceStatus: 'partial' },
  } }])), /partial evidence requires method, checkedAt, and evidenceUrl/)
})

test('catalog exposes the historical and current DSH compatibility matrix', () => {
  assert.deepEqual(dshReleaseCompatibility('>=0.1.0-rc.8 <0.2.0'), {
    'rc.7': 'incompatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible',
    '0.1.2-alpha.2': 'compatible', '0.1.2-alpha.3': 'compatible', '0.1.2-alpha.4': 'compatible', '0.1.2-alpha.5': 'compatible',
  })
  assert.deepEqual(dshReleaseCompatibility('>=0.1.0-rc.7 <0.2.0'), {
    'rc.7': 'compatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible',
    '0.1.2-alpha.2': 'compatible', '0.1.2-alpha.3': 'compatible', '0.1.2-alpha.4': 'compatible', '0.1.2-alpha.5': 'compatible',
  })
  assert.deepEqual(dshReleaseCompatibility('0.1.0-rc.7'), {
    'rc.7': 'compatible', 'rc.8': 'incompatible', '0.1.1-rc.1': 'incompatible', '0.1.1-rc.2': 'incompatible',
    '0.1.2-alpha.2': 'incompatible', '0.1.2-alpha.3': 'incompatible', '0.1.2-alpha.4': 'incompatible', '0.1.2-alpha.5': 'incompatible',
  })
  assert.deepEqual(dshReleaseCompatibility('unknown'), {
    'rc.7': 'unknown', 'rc.8': 'unknown', '0.1.1-rc.1': 'unknown', '0.1.1-rc.2': 'unknown',
    '0.1.2-alpha.2': 'unknown', '0.1.2-alpha.3': 'unknown', '0.1.2-alpha.4': 'unknown', '0.1.2-alpha.5': 'unknown',
  })
  assert.deepEqual(dshReleaseCompatibility('>= 0.1.0-rc.8 < 0.2.0'), {
    'rc.7': 'incompatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible',
    '0.1.2-alpha.2': 'compatible', '0.1.2-alpha.3': 'compatible', '0.1.2-alpha.4': 'compatible', '0.1.2-alpha.5': 'compatible',
  })
  assert.deepEqual(dshReleaseCompatibility(`${' '.repeat(200_000)}!`), {
    'rc.7': 'unknown', 'rc.8': 'unknown', '0.1.1-rc.1': 'unknown', '0.1.1-rc.2': 'unknown',
    '0.1.2-alpha.2': 'unknown', '0.1.2-alpha.3': 'unknown', '0.1.2-alpha.4': 'unknown', '0.1.2-alpha.5': 'unknown',
  }, 'oversized uncontrolled ranges must fail closed before regular-expression parsing')
})

test('dynamic DSH releases keep range support pending until exact catalog evidence exists', () => {
  const catalog = validateCatalog(document([{ ...entry, compatibility: {
    ...entry.compatibility,
    dsh: '>=0.1.0-rc.8 <0.2.0',
    dshReleases: { '0.1.1-rc.1': 'compatible' },
    dshOperations: { '0.1.1-rc.1': { install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed' } },
  } }]))
  const context = createDshReleaseContext(catalog.entries, {
    latestVersion: '0.1.1-rc.2', checkedAt: '2026-08-21T13:00:00.000Z', registryUrl: 'https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest',
  })
  assert.equal(context.source, 'npm-official')
  assert.equal(context.latestVersion, '0.1.1-rc.2')
  assert.deepEqual(context.cardReleases.map(release => release.version), ['0.1.0-rc.8', '0.1.1-rc.1', '0.1.1-rc.2'])
  const latest = projectDshRelease(catalog.entries[0], context.releases.find(release => release.latest))
  assert.equal(latest.status, 'unknown')
  assert.equal(latest.basis, 'range')
  assert.equal(latest.rangeStatus, 'compatible')
  assert.deepEqual(latest.operations, { install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown' })
  assert.equal(dshVersionCompatibility('>=0.1.0-rc.8 <0.2.0', '0.2.0'), 'incompatible')
})

test('catalog accepts dynamic full SemVer evidence and rejects conflicting aliases', () => {
  const dynamic = validateCatalog(document([{ ...entry, compatibility: {
    ...entry.compatibility,
    dshReleases: { '0.1.1-rc.2': 'compatible' },
    dshOperations: { '0.1.1-rc.2': { install: 'passed', start: 'passed', uninstall: 'unknown', rollback: 'unknown' } },
  } }])).entries[0]
  assert.equal(dynamic.compatibility.dshReleases['0.1.1-rc.2'], 'compatible')
  assert.equal(dynamic.compatibility.dshOperations['0.1.1-rc.2'].start, 'passed')
  assert.throws(() => validateCatalog(document([{ ...entry, compatibility: {
    ...entry.compatibility,
    dshReleases: { 'rc.8': 'compatible', '0.1.0-rc.8': 'incompatible' },
  } }])), /conflicting aliases/)
  assert.throws(() => validateCatalog(document([{ ...entry, compatibility: {
    ...entry.compatibility, dshReleases: { latest: 'compatible' },
  } }])), /not a supported DSH release key/)
  assert.throws(() => validateCatalog(document([{ ...entry, compatibility: {
    ...entry.compatibility, dshReleases: { 'rc.5': 'unknown' },
  } }])), /not a supported DSH release key/)
})

for (const historical of [
  {
    version: '0.8.5', commit: '0bc733064bfc8ff16f6e8144188a7ac563092e12',
    validate: validateCatalog085, snapshot: buildMarketplaceSnapshot085, compare: compareVersions085,
  },
  {
    version: '0.8.6', commit: '1a529364ef228d5423e6414d98eaa939410c7d73',
    validate: validateCatalog086, snapshot: buildMarketplaceSnapshot086, compare: compareVersions086,
  },
  {
    version: '0.8.7', commit: '79f2158be8f59d92d5227cad5474121081c0e32b',
    validate: validateCatalog087, snapshot: buildMarketplaceSnapshot087, compare: compareVersions087,
  },
]) test(`legacy ${historical.version} accepts the complete bounded bridge and discovers the marketplace update`, async () => {
  const bridgeText = await readFile(new URL('../registry/catalog.json', import.meta.url))
  const bridge = JSON.parse(bridgeText)
  const index = JSON.parse(await readFile(new URL('../registry/catalog-index.json', import.meta.url), 'utf8'))
  const legacy = historical.validate(bridge)
  assert.ok(bridgeText.length < MAX_CATALOG_BRIDGE_RESPONSE_BYTES)
  assert.deepEqual(bridgeText, catalogBridgeBuffer(bridge), 'the compatibility bridge must use its bounded canonical encoding')
  assert.equal(legacy.entries.length, bridge.registry.indexEntryCount)
  assert.equal(legacy.entries.length, index.entries.length)
  assert.ok(legacy.entries.length > 1, 'historical clients must receive the complete compatibility directory')
  assert.deepEqual(legacy.entries.map(entry => entry.id), index.entries.map(entry => entry.id))
  const manager = legacy.entries.find(entry => entry.id === 'dsh-safe-plugin-manager')
  assert.ok(manager)
  assert.equal(historical.compare(manager.version, historical.version), 1)
  assert.equal(legacy.registry.indexPath, undefined, `${historical.version} safely ignores the new bridge pointer`)
  const snapshot = historical.snapshot({ ...legacy, source: { kind: 'github' } }, {
    profile: 'web', plugins: [{
      packageName: 'dsh-safe-plugin-manager', official: false, source: 'git', version: historical.version,
      declaredSpecifier: `git+https://github.com/AI-Scarlett/DSH-Store.git#${historical.commit}`,
    }],
  })
  const managerSnapshot = snapshot.entries.find(entry => entry.id === 'dsh-safe-plugin-manager')
  assert.ok(managerSnapshot)
  assert.equal(managerSnapshot.updateAvailable, true)
  assert.deepEqual(managerSnapshot.allowedActions, ['update'])
})

test('catalog v2 keeps the index bounded and maps every plugin id to one detail record', async () => {
  const bridgeText = await readFile(new URL('../registry/catalog.json', import.meta.url))
  const indexText = await readFile(new URL('../registry/catalog-index.json', import.meta.url))
  const bridge = validateCatalog(JSON.parse(bridgeText))
  const index = validateCatalogIndex(JSON.parse(indexText))
  validateCatalogBridgeIndex(bridge, index, indexText)
  assert.ok(Buffer.byteLength(indexText) < MAX_CATALOG_INDEX_RESPONSE_BYTES)
  assert.equal(index.entries.length, bridge.registry.indexEntryCount)
  assert.ok(index.entries.every(item => item.detailPath === `${index.registry.detailsPath}/${item.id}.json`))
  assert.ok(index.entries.every(item => !Object.hasOwn(item, 'description') && !Object.hasOwn(item, 'compatibility')))
  assert.equal(new Set(index.entries.map(item => item.id)).size, index.entries.length)
  const trimmed = splitCatalogDocument(document(), { detailsPath: '///catalog/details///' })
  assert.equal(trimmed.index.registry.detailsPath, 'catalog/details')
})

test('Catalog bridge fails closed when its index is missing or does not match the pinned digest', async () => {
  const bridge = await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8')
  const index = JSON.parse(await readFile(new URL('../registry/catalog-index.json', import.meta.url), 'utf8'))
  const root = await mkdtemp(join(tmpdir(), 'dsh-catalog-bridge-'))
  const bridgeUrl = pathToFileURL(join(root, 'catalog.json'))
  try {
    await writeFile(bridgeUrl, bridge)
    await assert.rejects(() => loadCatalogFromFiles({ indexUrl: bridgeUrl }), error => error.code === 'CATALOG_INDEX_MISSING')
    index.entries[0] = { ...index.entries[0], version: '9.9.9' }
    await writeFile(join(root, 'catalog-index.json'), `${JSON.stringify(index, null, 2)}\n`)
    await assert.rejects(() => loadCatalogFromFiles({ indexUrl: bridgeUrl }), error => error.code === 'CATALOG_INDEX_INVALID')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('catalog v2 fails closed when a detail record is missing or does not match its index', async () => {
  const source = await loadCatalogFromFiles()
  const sourceDetail = JSON.parse(await readFile(new URL('../registry/catalog/details/dsh-safe-plugin-manager.json', import.meta.url), 'utf8'))
  const root = await mkdtemp(join(tmpdir(), 'dsh-catalog-v2-'))
  try {
    const split = splitCatalogDocument({ ...source, sourceFormat: undefined, entries: [source.entries.find(entry => entry.id === 'dsh-safe-plugin-manager')] })
    const indexUrl = pathToFileURL(join(root, 'catalog.json'))
    await writeFile(indexUrl, `${JSON.stringify(split.bridge, null, 2)}\n`)
    await writeFile(join(root, 'catalog-index.json'), `${JSON.stringify(split.index, null, 2)}\n`)
    await assert.rejects(
      () => loadCatalogFromFiles({ indexUrl }),
      error => error.code === 'CATALOG_DETAIL_MISSING' && /dsh-safe-plugin-manager/.test(error.message),
    )

    await mkdir(join(root, 'catalog', 'details'), { recursive: true })
    for (const field of ['id', 'version', 'repositoryUrl']) {
      const detail = { ...sourceDetail, [field]: field === 'id' ? 'other-plugin' : field === 'version' ? '9.9.9' : 'https://github.com/example/other-plugin' }
      await writeFile(join(root, 'catalog', 'details', 'dsh-safe-plugin-manager.json'), `${JSON.stringify(detail)}\n`)
      await assert.rejects(
        () => loadCatalogFromFiles({ indexUrl }),
        new RegExp(`catalog detail ${field} does not match index entry dsh-safe-plugin-manager`),
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('catalog service loads only the requested page details and caches them without duplicate requests', async () => {
  const bridgeText = await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8')
  const indexText = await readFile(new URL('../registry/catalog-index.json', import.meta.url), 'utf8')
  const remoteCatalogUrl = 'https://catalog.example.test/registry/catalog.json'
  const localRegistryRoot = new URL('../registry/', import.meta.url)
  let detailCalls = 0
  const service = createCatalogService({
    catalogUrl: remoteCatalogUrl,
    retryDelaysMs: [],
    fetch: async url => {
      const requested = new URL(url)
      if (requested.pathname === '/registry/catalog.json') return new Response(bridgeText)
      if (requested.pathname === '/registry/catalog-index.json') return new Response(indexText)
      if (!requested.pathname.startsWith('/registry/catalog/details/')) return new Response('missing', { status: 404 })
      detailCalls += 1
      const relativePath = requested.pathname.slice('/registry/'.length)
      const detailText = await readFile(new URL(relativePath, localRegistryRoot), 'utf8')
      return new Response(detailText)
    },
  })
  const index = await service.loadIndex()
  const pageIds = index.entries.slice(20, 40).map(item => item.id)
  const details = await service.loadDetails(pageIds, { index })
  assert.equal(details.length, 20)
  assert.equal(detailCalls, 20)
  await service.loadDetails(pageIds, { index })
  assert.equal(detailCalls, 20)
})

test('catalog service atomically falls back without mixing remote details into the bundled generation', async () => {
  const second = { ...entry, id: 'demo-two', packageName: 'dsh-demo-two', name: 'Demo Two', repositoryUrl: 'https://github.com/example/dsh-demo-two' }
  const split = splitCatalogDocument(document([entry, second]))
  const root = await mkdtemp(join(tmpdir(), 'dsh-catalog-atomic-fallback-'))
  try {
    await mkdir(join(root, 'catalog', 'details'), { recursive: true })
    await writeFile(join(root, 'catalog.json'), `${JSON.stringify(split.bridge, null, 2)}\n`)
    await writeFile(join(root, 'catalog-index.json'), `${JSON.stringify(split.index, null, 2)}\n`)
    for (const detail of split.details) await writeFile(join(root, detail.path), `${JSON.stringify(detail.entry, null, 2)}\n`)
    const service = createCatalogService({
      catalogUrl: 'https://catalog.example.test/registry/catalog.json',
      bundledUrl: pathToFileURL(join(root, 'catalog.json')),
      retryDelaysMs: [],
      fetch: async url => {
        const path = new URL(url).pathname
        if (path.endsWith('/catalog.json')) return new Response(`${JSON.stringify(split.bridge, null, 2)}\n`)
        if (path.endsWith('/catalog-index.json')) return new Response(`${JSON.stringify(split.index, null, 2)}\n`)
        const id = path.split('/').at(-1).replace(/\.json$/, '')
        const detail = split.details.find(item => item.entry.id === id).entry
        return new Response(JSON.stringify(id === 'demo'
          ? { ...detail, description: 'REMOTE DETAIL MUST NOT LEAK INTO FALLBACK' }
          : { ...detail, version: '9.9.9' }))
      },
    })
    const catalog = await service.load()
    assert.equal(catalog.source.kind, 'bundled')
    assert.equal(catalog.source.errorCode, 'CATALOG_DETAILS_UNAVAILABLE')
    assert.ok(catalog.entries.every(item => item.description !== 'REMOTE DETAIL MUST NOT LEAK INTO FALLBACK'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('marketplace snapshot pagination returns one bounded page and lazy candidate data', () => {
  const entries = Array.from({ length: 61 }, (_, index) => ({
    ...entry,
    id: `demo-${String(index).padStart(2, '0')}`,
    packageName: `dsh-demo-${String(index).padStart(2, '0')}`,
    name: `Demo ${String(index).padStart(2, '0')}`,
    featured: index < 3,
  }))
  const catalog = validateCatalog(document(entries))
  const snapshot = buildMarketplaceSnapshot(catalog, { profile: 'web', plugins: [] }, '', {
    candidateRegistry: {
      registry: { name: 'Candidates' }, source: { kind: 'fixture' },
      entries: [
        { id: 'candidate-new', name: 'Candidate New', status: 'pending', sourceUpdatedAt: '2026-08-21T00:00:00Z' },
        { id: 'candidate-old', name: 'Candidate Old', status: 'pending', sourceUpdatedAt: '2026-08-20T00:00:00Z' },
        { id: 'candidate-rejected', name: 'Candidate Rejected', status: 'rejected', sourceUpdatedAt: '2026-08-22T00:00:00Z' },
      ],
    },
  })
  const market = paginateMarketplaceSnapshot(snapshot, { view: 'market', page: 2, pageSize: 20 })
  assert.equal(market.entries.length, 20)
  assert.equal(market.candidates.length, 0)
  assert.deepEqual(market.pagination, {
    view: 'market', query: '', category: '', featuredOnly: false, page: 2, pageSize: 20, total: 61, pageCount: 4,
    hasPrevious: true, hasNext: true,
  })
  assert.equal(market.catalogPackageNames.length, 61)

  const featured = paginateMarketplaceSnapshot(snapshot, { view: 'market', featuredOnly: true, page: 1, pageSize: 20 })
  assert.deepEqual(featured.entries.map(item => item.id), ['demo-00', 'demo-01', 'demo-02'])
  assert.equal(featured.pagination.total, 3)
  assert.equal(featured.pagination.featuredOnly, true)

  const candidates = paginateMarketplaceSnapshot(snapshot, { view: 'candidates', includeRejected: true, page: 1, pageSize: 1 })
  assert.equal(candidates.entries.length, 0)
  assert.deepEqual(candidates.candidates.map(item => item.id), ['candidate-rejected'])
  assert.equal(candidates.pagination.total, 3)
  assert.deepEqual(candidates.candidateSummary, { total: 3, discovered: 0, reviewing: 0, rejected: 1, unknown: 2, reviewable: 0 })
  assert.throws(() => paginateMarketplaceSnapshot(snapshot, { pageSize: 49 }), /pageSize/)
})

test('catalog recommended ordering puts latest-compatible entries first', () => {
  const old = { ...entry, id: 'old', packageName: 'dsh-old', name: 'Old', compatibility: { ...entry.compatibility, dsh: '0.1.0-rc.7' } }
  const current = { ...entry, id: 'current', packageName: 'dsh-current', name: 'Current', version: '0.1.0', compatibility: { ...entry.compatibility, dsh: '>=0.1.0-rc.8 <0.2.0' } }
  assert.deepEqual(searchCatalog(validateCatalog(document([old, current]))).map(item => item.id), ['current', 'old'])
})

test('catalog ordering pins featured entries before compatibility and source freshness', () => {
  const currentOld = {
    ...entry, id: 'current-old', packageName: 'dsh-current-old', name: 'Current old',
    compatibility: { ...entry.compatibility, dsh: '>=0.1.0-rc.8 <0.2.0' },
    source: { updatedAt: '2026-08-01T00:00:00Z', observedAt: '2026-08-20T00:00:00Z', provenance: 'github-commit' },
  }
  const currentNew = {
    ...entry, id: 'current-new', packageName: 'dsh-current-new', name: 'Current new', featured: false,
    compatibility: { ...entry.compatibility, dsh: '>=0.1.0-rc.8 <0.2.0' },
    source: { updatedAt: '2026-08-19T00:00:00Z', observedAt: '2026-08-20T00:00:00Z', provenance: 'github-commit' },
  }
  const unsupportedNew = {
    ...entry, id: 'unsupported-new', packageName: 'dsh-unsupported-new', name: 'Unsupported new',
    compatibility: { ...entry.compatibility, dsh: '0.1.0-rc.7' },
    source: { updatedAt: '2026-08-20T00:00:00Z', observedAt: '2026-08-20T00:00:00Z', provenance: 'github-commit' },
  }
  const catalog = validateCatalog(document([currentOld, currentNew, unsupportedNew]))
  assert.deepEqual([...catalog.entries].sort(compareCatalogEntries).map(item => item.id), ['current-old', 'unsupported-new', 'current-new'])
  assert.equal(catalog.entries.find(item => item.id === 'current-old').assurance.securityReview.status, 'unknown')
})

test('bundled registry declares complete detail metadata for every entry', async () => {
  const source = await loadCatalogFromFiles()
  assert.equal(assertLegacyCatalogCompatibility(source), true)
  const catalog = source
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const legacyCatalogReleases = ['rc.7', 'rc.8', '0.1.1-rc.1', '0.1.1-rc.2']
  assert.equal(catalog.entries.length, source.entries.length)
  for (const item of source.entries) {
    assert.ok(item.details, `${item.id} must declare details in the GitHub catalog`)
    assert.ok(Array.isArray(item.compatibility.systems), `${item.id} must declare supported systems`)
    assert.ok(Array.isArray(item.compatibility.profiles), `${item.id} must declare supported profiles`)
    assert.ok(item.details.permissions.credentials.length > 0, `${item.id} must declare credential access`)
    if (item.compatibility.dshReleases) {
      for (const release of legacyCatalogReleases) {
        assert.ok(['compatible', 'incompatible', 'unknown'].includes(item.compatibility.dshReleases[release]),
          `${item.id} must preserve the ${release} compatibility key for DSH-Store 0.8.0 clients`)
      }
    }
  }
  assert.deepEqual(source.entries.filter(item => item.featured === true).map(item => item.id).sort(), [
    'build-dsh-plugin', 'dsh-plugin-agent-workflow', 'dsh-safe-plugin-manager', 'dsh-settings-hub',
  ])
  const manager = catalog.entries.find(item => item.id === 'dsh-safe-plugin-manager')
  assert.ok(manager, 'the marketplace manager must be listed in its own catalog')
  assert.equal(catalog.registry.repositoryUrl, 'https://github.com/AI-Scarlett/DSH-Store')
  assert.equal(manager.repositoryUrl, 'https://github.com/AI-Scarlett/DSH-Store')
  assert.equal(manager.status, 'approved', 'the self manager must remain available after its two-phase Catalog update')
  assert.ok(compareVersions(manager.version, packageManifest.version) <= 0, 'catalog manager version cannot be newer than package.json during two-phase self-pinning')
  const bootstrapCommit = '0bc733064bfc8ff16f6e8144188a7ac563092e12'
  const managerIsBootstrap = manager.version === '0.8.5' && manager.commit === bootstrapCommit
  const managerIsCurrent = manager.version === packageManifest.version && manager.commit !== bootstrapCommit
  const managerIsPreviousReleaseBeforeCatalogPin = (
    (packageManifest.version === '0.8.9' && manager.version === '0.8.8')
    || (packageManifest.version === '0.8.10' && manager.version === '0.8.9')
    || (packageManifest.version === '0.8.11' && manager.version === '0.8.10')
    || (packageManifest.version === '0.8.12' && manager.version === '0.8.11')
    || (packageManifest.version === '0.8.13' && manager.version === '0.8.12')
  )
  assert.ok(managerIsBootstrap || managerIsCurrent || managerIsPreviousReleaseBeforeCatalogPin,
    'the Catalog manager must be the fixed bootstrap, the current package release, or the staged previous release before self-pinning')
  assert.match(manager.commit, /^[0-9a-f]{40}$/)
  assert.ok(readme.includes(`git+https://github.com/AI-Scarlett/DSH-Store.git#${bootstrapCommit}`),
    'README must retain the fixed bootstrap install command even after the Catalog self-pin advances')
  assert.ok(readme.includes(`| 商城版本 | \`${packageManifest.version}\` |`), 'README marketplace version must match package.json')
  assert.match(readme, /dsh plugin --profile web add/)
  assert.match(readme, /设置 → 插件 → 插件商城/)
  assert.doesNotMatch(readme, /dsh-safe-plugin-manager\.git#main/)
  const agentReach = source.entries.find(item => item.id === 'dsh-agent-reach')
  assert.ok(agentReach, 'Agent Reach adapter must be listed')
  assert.ok(['approved', 'unlisted'].includes(agentReach.status), 'latest-three policy may reversibly unlist an older compatibility record')
  assert.equal(agentReach.featured, false)
  assert.equal(agentReach.commit, '85d9801a3e8884baf33f8166eb2e587a4482050f')
  assert.deepEqual(agentReach.entryIds, ['dsh-agent-reach-skill-provider'])
  assert.equal(agentReach.details.permissions.level, 'high')
  assert.ok(agentReach.details.externalDependencies.includes('Agent Reach CLI 1.5.0'))
  for (const id of ['dsh-safe-plugin-manager', 'dsh-token-monitor', 'dsh-chat-import', 'dsh-agent-reach', 'dsh-wecom-cli']) {
    const item = source.entries.find(entry => entry.id === id)
    assert.ok(item, `${id} must be listed`)
    for (const release of legacyCatalogReleases) {
      assert.ok(Object.hasOwn(item.compatibility.dshReleases, release), `${id} must declare the ${release} compatibility key`)
      assert.ok(['compatible', 'incompatible', 'unknown'].includes(item.compatibility.dshReleases[release]),
        `${id} ${release} compatibility must be a valid status`)
    }
    for (const release of Object.keys(item.compatibility.dshReleases).filter(release => !legacyCatalogReleases.includes(release))) {
      assert.match(release, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, `${id} dynamic releases must use full SemVer`)
    }
  }
  assert.equal(manager.compatibility.dshReleases['0.1.1-rc.2'], 'compatible')
  if (managerIsBootstrap) {
    assert.deepEqual(manager.compatibility.dshOperations['0.1.1-rc.2'], {
      install: 'passed', start: 'passed', uninstall: 'unknown', rollback: 'unknown',
    })
  } else if (managerIsCurrent && manager.version === '0.8.13') {
    for (const release of ['0.1.2-alpha.3', '0.1.2-alpha.4']) {
      assert.equal(manager.compatibility.dshReleases[release], 'compatible')
      assert.deepEqual(manager.compatibility.dshOperations[release], {
        install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown',
      })
    }
    assert.equal(manager.compatibility.dshReleases['0.1.2-alpha.5'], 'compatible')
    assert.deepEqual(manager.compatibility.dshOperations['0.1.2-alpha.5'], {
      install: 'passed', start: 'passed', uninstall: 'unknown', rollback: 'unknown',
    })
  } else if (managerIsCurrent || manager.version === '0.8.12') {
    for (const release of ['0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5']) {
      assert.equal(manager.compatibility.dshReleases[release], 'compatible')
      assert.deepEqual(manager.compatibility.dshOperations[release], {
        install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed',
      })
    }
  } else {
    for (const release of ['0.1.2-alpha.2', '0.1.2-alpha.3', '0.1.2-alpha.4']) {
      assert.equal(manager.compatibility.dshReleases[release], 'compatible')
      assert.deepEqual(manager.compatibility.dshOperations[release], {
        install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown',
      })
    }
  }
  const settingsHub = source.entries.find(item => item.id === 'dsh-settings-hub')
  assert.ok(settingsHub, 'Settings Hub must be listed')
  assert.equal(settingsHub.compatibility.dsh, '^0.1.1-rc.1')
  assert.deepEqual(settingsHub.compatibility.dshReleases, {
    'rc.7': 'incompatible', 'rc.8': 'incompatible',
    '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible',
    '0.1.2-alpha.3': 'unknown', '0.1.2-alpha.4': 'unknown', '0.1.2-alpha.5': 'unknown',
  })
  for (const release of ['rc.7', 'rc.8', '0.1.1-rc.1', '0.1.1-rc.2', '0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5']) {
    assert.deepEqual(settingsHub.compatibility.dshOperations[release], {
      install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown',
    })
  }
  const updatedSelfHosted = [
    {
      id: 'dsh-cliapi',
      version: '0.5.1',
      commit: '2db132bb430c5304627e5eb5681febecfc2d81ab',
      dsh: '>=0.1.0-rc.8 <0.2.0',
      releases: { 'rc.7': 'incompatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible', '0.1.2-alpha.3': 'unknown', '0.1.2-alpha.4': 'unknown', '0.1.2-alpha.5': 'unknown' },
    },
    {
      id: 'dsh-chat-import',
      version: '0.4.0',
      commit: '81f1a9785fbae6acd04a6b49a576b237c4f70eae',
      dsh: '>=0.1.0-rc.8 <0.2.0',
      releases: { 'rc.7': 'incompatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible', '0.1.2-alpha.3': 'unknown', '0.1.2-alpha.4': 'unknown', '0.1.2-alpha.5': 'unknown' },
    },
    {
      id: 'dsh-token-monitor',
      version: '1.3.0',
      commit: 'd655a1627607968394fd823cee440e68f07e9f00',
      dsh: '>=0.1.0-rc.6 <0.2.0',
      releases: { 'rc.7': 'compatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible', '0.1.2-alpha.3': 'unknown', '0.1.2-alpha.4': 'unknown', '0.1.2-alpha.5': 'unknown' },
    },
    {
      id: 'dsh-agent-reach',
      version: '0.1.0',
      commit: '85d9801a3e8884baf33f8166eb2e587a4482050f',
      dsh: '>=0.1.0-rc.6 <0.2.0',
      releases: { 'rc.7': 'compatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible', '0.1.2-alpha.3': 'unknown', '0.1.2-alpha.4': 'unknown', '0.1.2-alpha.5': 'unknown' },
    },
  ]
  for (const expected of updatedSelfHosted) {
    const plugin = source.entries.find(item => item.id === expected.id)
    assert.ok(['approved', 'unlisted'].includes(plugin.status), `${expected.id} must remain represented during compatibility review`)
    assert.equal(plugin.version, expected.version)
    assert.equal(plugin.commit, expected.commit)
    assert.equal(plugin.compatibility.dsh, expected.dsh)
    assert.deepEqual(plugin.compatibility.dshReleases, expected.releases)
    assert.equal(plugin.assurance.securityReview.status, 'partial')
    assert.equal(Object.hasOwn(plugin.assurance.securityReview, 'evidenceStatus'), false)
    const projectedPlugin = catalog.entries.find(item => item.id === expected.id)
    assert.equal(projectedPlugin.assurance.securityReview.status, 'partial')
  }
  const requestedIm = source.entries.find(item => item.id === 'xmanrui-dsh-im')
  assert.ok(requestedIm, 'the requested DSH IM plugin must remain listed')
  assert.equal(requestedIm.name, '多平台 IM 机器人桥接（DSH IM）')
  assert.equal(requestedIm.version, '0.14.0')
  assert.equal(requestedIm.commit, '832bd539a2bca2518cbf575d9b61606f868290e4')
  assert.equal(requestedIm.updatePolicy, 'user-reviewed')
  assert.deepEqual(requestedIm.compatibility.dshReleases, {
    'rc.7': 'unknown', 'rc.8': 'unknown', '0.1.1-rc.1': 'unknown', '0.1.1-rc.2': 'unknown',
    '0.1.2-alpha.3': 'unknown', '0.1.2-alpha.4': 'unknown', '0.1.2-alpha.5': 'unknown',
  })
  for (const release of ['rc.7', 'rc.8', '0.1.1-rc.1', '0.1.1-rc.2', '0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5']) {
    assert.deepEqual(requestedIm.compatibility.dshOperations[release], {
      install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown',
    })
  }
  assert.equal(requestedIm.assurance.discovery.status, 'verified')
  assert.equal(requestedIm.assurance.runtime.status, 'unknown')
  assert.equal(source.entries.find(item => item.id === 'dsh-wecom-cli')?.status, 'unlisted')
  const buildPlugin = source.entries.find(item => item.id === 'build-dsh-plugin')
  assert.equal(buildPlugin.status, 'approved')
  const previousBuildPluginCommit = '99f054a42e60e3e91f8ca54eb8e8c6b22c21e870'
  const buildPluginIsPrevious = buildPlugin.version === '0.4.0' && buildPlugin.commit === previousBuildPluginCommit
  const buildPluginIsCurrent = buildPlugin.version === '0.4.1' && buildPlugin.commit !== previousBuildPluginCommit
  assert.ok(buildPluginIsPrevious || buildPluginIsCurrent,
    'build-dsh-plugin must be the staged previous release or the current fixed Catalog pin')
  const buildPluginWindow = buildPluginIsCurrent
    ? ['0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5']
    : ['0.1.2-alpha.2', '0.1.2-alpha.3', '0.1.2-alpha.4']
  for (const release of buildPluginWindow) {
    assert.equal(buildPlugin.compatibility.dshReleases[release], 'compatible')
    if (buildPluginIsCurrent) {
      assert.deepEqual(buildPlugin.compatibility.dshOperations[release], {
        install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed',
      })
    }
  }
  for (const gate of ['installability', 'runtime', 'securityReview']) {
    assert.equal(buildPlugin.assurance[gate].status, 'partial')
    assert.equal(Object.hasOwn(buildPlugin.assurance[gate], 'evidenceStatus'), false)
    assert.equal(catalog.entries.find(item => item.id === 'build-dsh-plugin').assurance[gate].status, 'partial')
  }
})

test('catalog supports pinned repository subdirectories and hides unlisted entries from search', () => {
  const nested = { ...entry, id: 'nested', packageName: 'dsh-nested', manifestPath: 'plugin/package.json', installPath: 'plugin' }
  const hidden = { ...entry, id: 'hidden', packageName: 'dsh-hidden', status: 'unlisted', statusReason: 'retired', featured: false }
  const catalog = validateCatalog(document([nested, hidden]))
  assert.equal(githubInstallSpecifier(catalog.entries[0]), `git+https://github.com/example/dsh-demo.git#${'a'.repeat(40)}&path:plugin`)
  assert.deepEqual(searchCatalog(catalog).map(item => item.id), ['nested'])
  assert.deepEqual(searchCatalog(catalog, '', { includeUnlisted: true }).map(item => item.id), ['nested', 'hidden'])
})

test('catalog service falls back to bundled snapshot when GitHub is unavailable', async () => {
  const service = createCatalogService({
    catalogUrl: 'https://raw.githubusercontent.com/example/registry/main/catalog.json',
    fetch: async () => new Response('missing', { status: 404 }),
  })
  const catalog = await service.load()
  assert.equal(catalog.source.kind, 'bundled')
  assert.equal(catalog.source.errorCode, 'CATALOG_HTTP_ERROR')
  assert.ok(catalog.entries.length >= 2)
})

test('catalog service retries a transient GitHub transport failure before using the bundle', async () => {
  let calls = 0
  const service = createCatalogService({
    catalogUrl: 'https://raw.githubusercontent.com/example/registry/main/catalog.json',
    retryDelaysMs: [0],
    fetch: async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return new Response(JSON.stringify(document()))
    },
  })
  const catalog = await service.load()
  assert.equal(catalog.source.kind, 'github')
  assert.equal(catalog.source.errorCode, null)
  assert.equal(calls, 2)
})

test('catalog service accepts a valid remote response between the legacy and current bounds', async () => {
  const raw = JSON.stringify({ ...document(), padding: 'x'.repeat(2 * 1024 * 1024) })
  const bytes = Buffer.byteLength(raw)
  assert.ok(bytes > 2 * 1024 * 1024, 'the fixture must reproduce the retired 2 MiB limit')
  assert.ok(bytes < MAX_CATALOG_RESPONSE_BYTES, 'the fixture must remain below the bounded 4 MiB limit')
  const service = createCatalogService({
    catalogUrl: 'https://raw.githubusercontent.com/example/registry/main/catalog.json',
    retryDelaysMs: [],
    fetch: async () => ({
      ok: true,
      headers: new Headers({ 'content-length': String(bytes) }),
      text: async () => raw,
    }),
  })
  const catalog = await service.load({ force: true })
  assert.equal(catalog.source.kind, 'github')
  assert.equal(catalog.source.errorCode, null)
  assert.equal(catalog.entries.length, 1)
})

test('catalog service fails closed when the declared remote response exceeds the bound', async () => {
  let bodyRead = false
  const service = createCatalogService({
    catalogUrl: 'https://raw.githubusercontent.com/example/registry/main/catalog.json',
    retryDelaysMs: [],
    fetch: async () => ({
      ok: true,
      headers: new Headers({ 'content-length': String(MAX_CATALOG_RESPONSE_BYTES + 1) }),
      text: async () => {
        bodyRead = true
        return JSON.stringify(document())
      },
    }),
  })
  const catalog = await service.load({ force: true })
  assert.equal(bodyRead, false, 'a declared oversized response must be rejected before reading the body')
  assert.equal(catalog.source.kind, 'bundled')
  assert.equal(catalog.source.errorCode, 'CATALOG_UNAVAILABLE')
})

test('catalog service fails closed when the remote body exceeds the bound without a length header', async () => {
  const raw = `${JSON.stringify(document())}${' '.repeat(MAX_CATALOG_RESPONSE_BYTES)}`
  const service = createCatalogService({
    catalogUrl: 'https://raw.githubusercontent.com/example/registry/main/catalog.json',
    retryDelaysMs: [],
    fetch: async () => ({ ok: true, headers: new Headers(), text: async () => raw }),
  })
  const catalog = await service.load({ force: true })
  assert.equal(catalog.source.kind, 'bundled')
  assert.equal(catalog.source.errorCode, 'CATALOG_UNAVAILABLE')
})

test('catalog service accepts partial assurance evidence from the remote Catalog', async () => {
  const remote = document([{ ...entry, assurance: {
    discovery: { status: 'verified', method: 'fixed-source', checkedAt: '2026-08-25T00:00:00Z', evidenceUrl: 'https://github.com/example/dsh-demo/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    installability: { status: 'partial', method: 'disposable-profile-install', checkedAt: '2026-08-25T00:00:00Z', evidenceUrl: 'https://github.com/example/dsh-demo/releases/tag/v1.2.0', summary: 'Installation evidence is bounded and public runtime evidence is pending.' },
    runtime: { status: 'unknown', summary: 'No runtime evidence yet.' },
    securityReview: { status: 'partial', method: 'fixed-source-policy', checkedAt: '2026-08-25T00:00:00Z', evidenceUrl: 'https://github.com/example/dsh-demo/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', summary: 'Bounded policy checks passed; this is not an independent audit.' },
  } }])
  const service = createCatalogService({
    catalogUrl: 'https://raw.githubusercontent.com/example/registry/main/catalog.json',
    retryDelaysMs: [],
    fetch: async () => new Response(JSON.stringify(remote)),
  })
  const catalog = await service.load({ force: true })
  assert.equal(catalog.source.kind, 'github')
  assert.equal(catalog.entries[0].assurance.installability.status, 'partial')
  assert.equal(catalog.entries[0].assurance.securityReview.status, 'partial')
})

test('catalog overlays live marketplace install counts without changing catalog authority', async () => {
  const service = createCatalogService({
    catalogUrl: 'https://catalog.test/catalog.json', installCountsUrl: 'https://counts.test/v1/counts', retryDelaysMs: [],
    fetch: async url => url.includes('counts')
      ? new Response(JSON.stringify({ schemaVersion: 1, updatedAt: '2026-08-17T00:00:00Z', counts: { demo: 42 } }))
      : new Response(JSON.stringify(document())),
  })
  const catalog = await service.load()
  assert.equal(catalog.entries[0].installCount, 42)
  assert.equal(catalog.installCounts.status, 'live')
  assert.equal(catalog.source.kind, 'github')
})

test('marketplace offers explicit migration for local links and reports version updates', () => {
  const catalog = { ...validateCatalog(document()), source: { kind: 'fixture' } }
  const local = buildMarketplaceSnapshot(catalog, {
    profile: 'web', plugins: [{ packageName: 'dsh-demo', official: false, source: 'link', version: '1.0.0' }],
  })
  assert.equal(local.entries[0].updateAvailable, true)
  assert.equal(local.entries[0].migrationAvailable, true)
  assert.deepEqual(local.entries[0].allowedActions, ['migrate'])
  assert.equal(local.entries[0].manageable, true)
  const npm = buildMarketplaceSnapshot(catalog, {
    profile: 'web', plugins: [{ packageName: 'dsh-demo', official: false, source: 'npm', version: '1.0.0' }],
  })
  assert.equal(npm.entries[0].manageable, true)
  const git = buildMarketplaceSnapshot(catalog, {
    profile: 'web', plugins: [{ packageName: 'dsh-demo', official: false, source: 'git', version: '1.2.0', declaredSpecifier: 'github:example/dsh-demo#main' }],
  })
  assert.equal(git.entries[0].updateAvailable, true)
  assert.equal(git.entries[0].commitMatched, false)
  assert.equal(git.entries[0].sourceDrift, true)
  const sourceNewer = buildMarketplaceSnapshot(catalog, {
    profile: 'web', plugins: [{ packageName: 'dsh-demo', official: false, source: 'git', version: '2.0.0', declaredSpecifier: 'github:example/dsh-demo#newer' }],
  })
  assert.equal(sourceNewer.entries[0].versionState, 'ahead')
  assert.equal(sourceNewer.entries[0].sourceDrift, true)
  assert.equal(sourceNewer.entries[0].updateAvailable, false, 'a newer source-verified install must not be offered a catalog downgrade')
})

test('source verification checks manifest, lifecycle scripts, and Bundle ids at the pinned commit', async () => {
  const catalogEntry = validateCatalog(document()).entries[0]
  const request = async url => {
    if (url.endsWith('/package.json')) return new Response(JSON.stringify({
      name: 'dsh-demo', version: '1.2.0', license: 'MIT', dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: {},
    }))
    return new Response('- insert:\n    - id: demo\n      name: dsh-demo\n')
  }
  const result = await verifyCatalogEntry(catalogEntry, { fetch: request })
  assert.equal(result.status, 'verified')
  assert.equal(result.packageName, 'dsh-demo')
  assert.equal(result.license, 'MIT')
  await assert.rejects(() => verifyCatalogEntry({
    ...catalogEntry, details: { ...catalogEntry.details, license: 'Apache-2.0' },
  }, { fetch: request }), /license does not match/)
})

test('source verification retries transient GitHub transport failures', async () => {
  const catalogEntry = validateCatalog(document()).entries[0]
  let calls = 0
  const request = async url => {
    calls += 1
    if (calls === 1) throw new TypeError('fetch failed')
    if (url.endsWith('/package.json')) return new Response(JSON.stringify({
      name: 'dsh-demo', version: '1.2.0', license: 'MIT', dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: {},
    }))
    return new Response('- insert:\n    - id: demo\n      name: dsh-demo\n')
  }
  assert.equal((await verifyCatalogEntry(catalogEntry, { fetch: request, retryDelaysMs: [0, 0] })).status, 'verified')
  assert.equal(calls, 3)
})

test('source verification distinguishes timeout, HTTP, manifest, and patch failures', async () => {
  const catalogEntry = validateCatalog(document()).entries[0]
  const manifest = JSON.stringify({
    name: 'dsh-demo', version: '1.2.0', license: 'MIT',
    dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: {},
  })
  const timeout = Object.assign(new Error('aborted'), { name: 'AbortError' })
  await assert.rejects(
    () => verifyCatalogEntry(catalogEntry, { fetch: async () => { throw timeout }, retryDelaysMs: [] }),
    error => error.code === 'SOURCE_VERIFICATION_TIMEOUT',
  )
  await assert.rejects(
    () => verifyCatalogEntry(catalogEntry, { fetch: async () => new Response('missing', { status: 404 }), retryDelaysMs: [] }),
    error => error.code === 'SOURCE_VERIFICATION_HTTP',
  )
  await assert.rejects(
    () => verifyCatalogEntry(catalogEntry, { fetch: async () => new Response('{'), retryDelaysMs: [] }),
    error => error.code === 'SOURCE_MANIFEST_INVALID',
  )
  await assert.rejects(
    () => verifyCatalogEntry(catalogEntry, {
      fetch: async url => new Response(url.endsWith('/package.json') ? manifest : '- insert:\n    - id: wrong\n'),
      retryDelaysMs: [],
    }),
    error => error.code === 'SOURCE_PATCH_MISMATCH',
  )
})
