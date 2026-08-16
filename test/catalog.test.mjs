import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMarketplaceSnapshot, createCatalogService, githubInstallSpecifier,
  searchCatalog, validateCatalog, verifyCatalogEntry,
} from '../src/catalog.mjs'

const entry = {
  id: 'demo', name: 'Demo', packageName: 'dsh-demo', description: 'demo plugin',
  repositoryUrl: 'https://github.com/example/dsh-demo', defaultBranch: 'main',
  manifestPath: 'package.json', commit: 'a'.repeat(40), version: '1.2.0',
  categories: ['tools'], featured: true, entryIds: ['demo'], status: 'approved',
  compatibility: { dsh: '>=0.1.0', node: '>=22' },
  risk: { installScripts: [], review: 'curated-not-security-audited' },
}

function document(entries = [entry]) {
  return {
    schemaVersion: 1,
    registry: {
      name: 'Fixture', repositoryUrl: 'https://github.com/example/registry',
      homepageUrl: 'https://example.github.io/registry', updatedAt: '2026-08-16T00:00:00Z',
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
  assert.equal(catalog.entries[0].featured, true)
  assert.throws(() => validateCatalog(document([{ ...entry, repositoryUrl: 'https://example.test/repo' }])), /github\.com/)
  assert.throws(() => validateCatalog(document([entry, { ...entry, id: 'two' }])), /duplicate catalog package/)
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
  assert.equal(catalog.source.errorCode, 'CATALOG_UNAVAILABLE')
  assert.ok(catalog.entries.length >= 2)
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
})

test('source verification checks manifest, lifecycle scripts, and Bundle ids at the pinned commit', async () => {
  const catalogEntry = validateCatalog(document()).entries[0]
  const request = async url => {
    if (url.endsWith('/package.json')) return new Response(JSON.stringify({
      name: 'dsh-demo', version: '1.2.0', dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: {},
    }))
    return new Response('- insert:\n    - id: demo\n      name: dsh-demo\n')
  }
  const result = await verifyCatalogEntry(catalogEntry, { fetch: request })
  assert.equal(result.status, 'verified')
  assert.equal(result.packageName, 'dsh-demo')
})

test('source verification retries transient GitHub transport failures', async () => {
  const catalogEntry = validateCatalog(document()).entries[0]
  let calls = 0
  const request = async url => {
    calls += 1
    if (calls === 1) throw new TypeError('fetch failed')
    if (url.endsWith('/package.json')) return new Response(JSON.stringify({
      name: 'dsh-demo', version: '1.2.0', dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: {},
    }))
    return new Response('- insert:\n    - id: demo\n      name: dsh-demo\n')
  }
  assert.equal((await verifyCatalogEntry(catalogEntry, { fetch: request })).status, 'verified')
  assert.equal(calls, 3)
})
