import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildMarketplaceSnapshot, createCatalogService, githubInstallSpecifier,
  compareCatalogEntries, dshReleaseCompatibility, searchCatalog, validateCatalog, verifyCatalogEntry,
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

test('catalog exposes an explicit rc.5 through rc.8 compatibility matrix', () => {
  assert.deepEqual(dshReleaseCompatibility('>=0.1.0-rc.8 <0.2.0'), {
    'rc.5': 'incompatible', 'rc.6': 'incompatible', 'rc.7': 'incompatible', 'rc.8': 'compatible',
  })
  assert.deepEqual(dshReleaseCompatibility('>=0.1.0-rc.5'), {
    'rc.5': 'compatible', 'rc.6': 'compatible', 'rc.7': 'compatible', 'rc.8': 'compatible',
  })
  assert.deepEqual(dshReleaseCompatibility('0.1.0-rc.7'), {
    'rc.5': 'incompatible', 'rc.6': 'incompatible', 'rc.7': 'compatible', 'rc.8': 'incompatible',
  })
  assert.deepEqual(dshReleaseCompatibility('unknown'), {
    'rc.5': 'unknown', 'rc.6': 'unknown', 'rc.7': 'unknown', 'rc.8': 'unknown',
  })
})

test('catalog recommended ordering puts rc.8-compatible entries first', () => {
  const old = { ...entry, id: 'old', packageName: 'dsh-old', name: 'Old', compatibility: { ...entry.compatibility, dsh: '0.1.0-rc.7' } }
  const current = { ...entry, id: 'current', packageName: 'dsh-current', name: 'Current', version: '0.1.0', compatibility: { ...entry.compatibility, dsh: '>=0.1.0-rc.8 <0.2.0' } }
  assert.deepEqual(searchCatalog(validateCatalog(document([old, current]))).map(item => item.id), ['current', 'old'])
})

test('catalog ordering uses rc.8 compatibility before source freshness and never promotion as verification', () => {
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
  assert.deepEqual([...catalog.entries].sort(compareCatalogEntries).map(item => item.id), ['current-new', 'current-old', 'unsupported-new'])
  assert.equal(catalog.entries.find(item => item.id === 'current-old').assurance.securityReview.status, 'unknown')
})

test('bundled registry declares complete detail metadata for every entry', async () => {
  const source = JSON.parse(await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8'))
  const catalog = validateCatalog(source)
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(catalog.entries.length, source.entries.length)
  for (const item of source.entries) {
    assert.ok(item.details, `${item.id} must declare details in the GitHub catalog`)
    assert.ok(Array.isArray(item.compatibility.systems), `${item.id} must declare supported systems`)
    assert.ok(Array.isArray(item.compatibility.profiles), `${item.id} must declare supported profiles`)
    assert.ok(item.details.permissions.credentials.length > 0, `${item.id} must declare credential access`)
  }
  assert.deepEqual(source.entries.filter(item => item.featured === true).map(item => item.id), [
    'build-dsh-plugin', 'dsh-safe-plugin-manager', 'dsh-plugin-agent-workflow',
  ])
  const manager = catalog.entries.find(item => item.id === 'dsh-safe-plugin-manager')
  assert.ok(manager, 'the marketplace manager must be listed in its own catalog')
  assert.equal(manager.version, packageManifest.version, 'catalog manager version must match package.json')
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
    assert.deepEqual(item.compatibility.dshReleases, dshReleaseCompatibility(item.compatibility.dsh), `${id} rc matrix must be explicit`)
  }
  const requestedIm = source.entries.find(item => item.id === 'xmanrui-dsh-im')
  assert.ok(requestedIm, 'the requested DSH IM plugin must remain listed')
  assert.equal(requestedIm.name, '多平台 IM 机器人桥接（DSH IM）')
  assert.equal(requestedIm.version, '0.14.0')
  assert.equal(requestedIm.commit, '832bd539a2bca2518cbf575d9b61606f868290e4')
  assert.equal(requestedIm.updatePolicy, 'user-reviewed')
  assert.deepEqual(requestedIm.compatibility.dshReleases, {
    'rc.5': 'unknown', 'rc.6': 'unknown', 'rc.7': 'unknown', 'rc.8': 'unknown',
  })
  for (const release of ['rc.5', 'rc.6', 'rc.7', 'rc.8']) {
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
