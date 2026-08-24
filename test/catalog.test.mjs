import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildMarketplaceSnapshot, createCatalogService, githubInstallSpecifier,
  compareCatalogEntries, compareVersions, createDshReleaseContext, dshReleaseCompatibility, dshVersionCompatibility,
  paginateMarketplaceSnapshot, projectDshRelease, searchCatalog, validateCatalog, verifyCatalogEntry,
} from '../src/catalog.mjs'

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

test('catalog exposes an explicit public rc.7 through 0.1.1-rc.2 compatibility matrix', () => {
  assert.deepEqual(dshReleaseCompatibility('>=0.1.0-rc.8 <0.2.0'), {
    'rc.7': 'incompatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible',
  })
  assert.deepEqual(dshReleaseCompatibility('>=0.1.0-rc.7 <0.2.0'), {
    'rc.7': 'compatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible',
  })
  assert.deepEqual(dshReleaseCompatibility('0.1.0-rc.7'), {
    'rc.7': 'compatible', 'rc.8': 'incompatible', '0.1.1-rc.1': 'incompatible', '0.1.1-rc.2': 'incompatible',
  })
  assert.deepEqual(dshReleaseCompatibility('unknown'), {
    'rc.7': 'unknown', 'rc.8': 'unknown', '0.1.1-rc.1': 'unknown', '0.1.1-rc.2': 'unknown',
  })
  assert.deepEqual(dshReleaseCompatibility('>= 0.1.0-rc.8 < 0.2.0'), {
    'rc.7': 'incompatible', 'rc.8': 'compatible', '0.1.1-rc.1': 'compatible', '0.1.1-rc.2': 'compatible',
  })
  assert.deepEqual(dshReleaseCompatibility(`${' '.repeat(200_000)}!`), {
    'rc.7': 'unknown', 'rc.8': 'unknown', '0.1.1-rc.1': 'unknown', '0.1.1-rc.2': 'unknown',
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
  const market = paginateMarketplaceSnapshot(snapshot, { view: 'market', page: 2, pageSize: 24 })
  assert.equal(market.entries.length, 24)
  assert.equal(market.candidates.length, 0)
  assert.deepEqual(market.pagination, {
    view: 'market', query: '', category: '', featuredOnly: false, page: 2, pageSize: 24, total: 61, pageCount: 3,
    hasPrevious: true, hasNext: true,
  })
  assert.equal(market.catalogPackageNames.length, 61)

  const featured = paginateMarketplaceSnapshot(snapshot, { view: 'market', featuredOnly: true, page: 1, pageSize: 24 })
  assert.deepEqual(featured.entries.map(item => item.id), ['demo-00', 'demo-01', 'demo-02'])
  assert.equal(featured.pagination.total, 3)
  assert.equal(featured.pagination.featuredOnly, true)

  const candidates = paginateMarketplaceSnapshot(snapshot, { view: 'candidates', page: 1, pageSize: 1 })
  assert.equal(candidates.entries.length, 0)
  assert.deepEqual(candidates.candidates.map(item => item.id), ['candidate-new'])
  assert.equal(candidates.pagination.total, 2)
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
  const source = JSON.parse(await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8'))
  const catalog = validateCatalog(source)
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
  assert.ok(compareVersions(manager.version, packageManifest.version) <= 0, 'catalog manager version cannot be newer than package.json during two-phase self-pinning')
  assert.ok(readme.includes(githubInstallSpecifier(manager)), 'README install command must match the catalog fixed commit')
  assert.ok(readme.includes(`| 商城版本 | \`${packageManifest.version}\` |`), 'README marketplace version must match package.json')
  assert.match(readme, /dsh plugin --profile web add/)
  assert.match(readme, /设置 → 插件 → 插件商城/)
  assert.doesNotMatch(readme, /dsh-safe-plugin-manager\.git#main/)
  const agentReach = source.entries.find(item => item.id === 'dsh-agent-reach')
  assert.ok(agentReach, 'Agent Reach adapter must be listed')
  assert.equal(agentReach.status, 'approved')
  assert.equal(agentReach.featured, undefined)
  assert.equal(agentReach.commit, 'd37fb46edf783446b430d324c68ac911b84a14b0')
  assert.deepEqual(agentReach.entryIds, ['dsh-agent-reach-skill-provider'])
  assert.equal(agentReach.details.permissions.level, 'high')
  assert.ok(agentReach.details.externalDependencies.includes('Agent Reach CLI 1.5.0'))
  for (const id of ['dsh-safe-plugin-manager', 'dsh-token-monitor', 'dsh-chat-import', 'dsh-agent-reach', 'dsh-wecom-cli']) {
    const item = source.entries.find(entry => entry.id === id)
    assert.ok(item, `${id} must be listed`)
    const historical = dshReleaseCompatibility(item.compatibility.dsh)
    for (const release of Object.keys(historical)) {
      assert.ok(Object.hasOwn(item.compatibility.dshReleases, release), `${id} must declare the ${release} compatibility key`)
      assert.ok(['compatible', 'incompatible', 'unknown'].includes(item.compatibility.dshReleases[release]),
        `${id} ${release} compatibility must be a valid status`)
    }
    for (const release of Object.keys(item.compatibility.dshReleases).filter(release => !Object.hasOwn(historical, release))) {
      assert.match(release, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, `${id} dynamic releases must use full SemVer`)
    }
  }
  assert.equal(manager.compatibility.dshReleases['0.1.1-rc.2'], 'compatible')
  assert.deepEqual(manager.compatibility.dshOperations['0.1.1-rc.2'], {
    install: 'passed', start: 'passed', uninstall: 'unknown', rollback: 'unknown',
  })
  const requestedIm = source.entries.find(item => item.id === 'xmanrui-dsh-im')
  assert.ok(requestedIm, 'the requested DSH IM plugin must remain listed')
  assert.equal(requestedIm.name, '多平台 IM 机器人桥接（DSH IM）')
  assert.equal(requestedIm.version, '0.14.0')
  assert.equal(requestedIm.commit, '832bd539a2bca2518cbf575d9b61606f868290e4')
  assert.equal(requestedIm.updatePolicy, 'user-reviewed')
  assert.deepEqual(requestedIm.compatibility.dshReleases, {
    'rc.7': 'unknown', 'rc.8': 'unknown', '0.1.1-rc.1': 'unknown', '0.1.1-rc.2': 'unknown',
  })
  for (const release of ['rc.7', 'rc.8', '0.1.1-rc.1', '0.1.1-rc.2']) {
    assert.deepEqual(requestedIm.compatibility.dshOperations[release], {
      install: 'unknown', start: 'unknown', uninstall: 'unknown', rollback: 'unknown',
    })
  }
  assert.equal(requestedIm.assurance.discovery.status, 'verified')
  assert.equal(requestedIm.assurance.runtime.status, 'unknown')
  assert.equal(source.entries.find(item => item.id === 'dsh-wecom-cli')?.status, 'unlisted')
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
