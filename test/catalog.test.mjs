import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  assertLegacyCatalogCompatibility, buildMarketplaceSnapshot, catalogBridgeBuffer, createCatalogService, githubInstallSpecifier,
  compareCatalogEntries, compareVersions, createDshReleaseContext, dshReleaseCompatibility, dshVersionCompatibility,
  dshReleaseVersion,
  MAX_CATALOG_BRIDGE_RESPONSE_BYTES, MAX_CATALOG_INDEX_RESPONSE_BYTES, MAX_CATALOG_RESPONSE_BYTES,
  loadCatalogFromFiles, paginateMarketplaceSnapshot, projectDshRelease,
  searchCatalog, splitCatalogDocument, validateCatalog, validateCatalogBridgeIndex, validateCatalogDetail,
  validateCatalogIndex, verifyCatalogEntry,
} from '../src/catalog.mjs'
import { COMPATIBILITY_HOLD_PREFIX } from '../src/catalog-compatibility-policy.mjs'
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

function projectedReleaseStatus(original, wire, release) {
  if (Object.hasOwn(wire.compatibility.dshReleases ?? {}, release)) return wire.compatibility.dshReleases[release]
  const version = dshReleaseVersion(release)
  const rangeStatus = version === null ? 'unknown' : dshVersionCompatibility(original.compatibility.dsh, version)
  return rangeStatus === 'incompatible' ? 'incompatible' : 'unknown'
}

test('catalog accepts pinned GitHub entries without requiring Desktop client adaptation', () => {
  const catalog = validateCatalog(document())
  assert.equal(catalog.entries.length, 1)
  assert.equal(githubInstallSpecifier(catalog.entries[0]), `git+https://github.com/example/dsh-demo.git#${'a'.repeat(40)}`)
  assert.equal(searchCatalog(catalog, 'TOOLS')[0].id, 'demo')
  assert.equal(searchCatalog(catalog, 'MIT')[0].id, 'demo')
  assert.equal(catalog.entries[0].featured, true)
  assert.equal(catalog.entries[0].status, 'approved')
  assert.equal(catalog.entries[0].details.permissions.files, 'read-only')
  const proxyCredentials = validateCatalog(document([{
    ...entry,
    details: { ...entry.details, permissions: { ...entry.details.permissions, credentials: ['proxy-credentials'] } },
  }]))
  assert.deepEqual(proxyCredentials.entries[0].details.permissions.credentials, ['proxy-credentials'])
  const webSessionCredential = validateCatalog(document([{
    ...entry,
    details: { ...entry.details, permissions: { ...entry.details.permissions, credentials: ['web-session-token'] } },
  }]))
  assert.deepEqual(webSessionCredential.entries[0].details.permissions.credentials, ['web-session-token'])
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

test('new credential detail labels remain explicit for current clients and fail-safe for legacy bridges', async () => {
  const current = await loadCatalogFromFiles()
  const webChat = current.entries.find(item => item.id === 'dsh-more-details')
  assert.deepEqual(webChat.details.permissions.credentials, ['web-session-token'])
  const bridge = JSON.parse(await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8'))
  const bridgeWebChat = bridge.entries.find(item => item.id === 'dsh-more-details')
  const detailWebChat = JSON.parse(await readFile(new URL('../registry/catalog/details/dsh-more-details.json', import.meta.url), 'utf8'))
  assert.deepEqual(bridgeWebChat.details.permissions.credentials, ['unknown'])
  assert.deepEqual(detailWebChat.details.permissions.credentials, ['web-session-token'])
  for (const validate of [validateCatalog085, validateCatalog086, validateCatalog087]) {
    assert.deepEqual(validate(bridge).entries.find(item => item.id === 'dsh-more-details').details.permissions.credentials, ['unknown'])
  }
  const source = current.entries.find(item => item.id === 'dsh-tun-proxy')
  assert.deepEqual(source.details.permissions.credentials, ['proxy-credentials'])
  const bridgeEntry = bridge.entries.find(item => item.id === 'dsh-tun-proxy')
  const detailEntry = JSON.parse(await readFile(new URL('../registry/catalog/details/dsh-tun-proxy.json', import.meta.url), 'utf8'))
  assert.deepEqual(bridgeEntry.details.permissions.credentials, ['unknown'])
  assert.deepEqual(detailEntry.details.permissions.credentials, ['proxy-credentials'])
  for (const validate of [validateCatalog085, validateCatalog086, validateCatalog087]) {
    assert.deepEqual(validate(bridge).entries.find(item => item.id === 'dsh-tun-proxy').details.permissions.credentials, ['unknown'])
  }
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
  const github = createDshReleaseContext([], {
    latestVersion: '0.1.3-alpha.1', latestSource: 'github-official:release',
    channels: [{ version: '0.1.2-rc.1' }, { version: '0.1.2-alpha.5' }],
  })
  assert.equal(github.source, 'github-official')
  assert.deepEqual(github.cardReleases.map(release => release.version), ['0.1.2-alpha.5', '0.1.2-rc.1', '0.1.3-alpha.1'])

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
]) test(`legacy ${historical.version} accepts the complete bounded bridge and respects manager availability`, async () => {
  const bridgeText = await readFile(new URL('../registry/catalog.json', import.meta.url))
  const bridge = JSON.parse(bridgeText)
  const index = JSON.parse(await readFile(new URL('../registry/catalog-index.json', import.meta.url), 'utf8'))
  const legacy = historical.validate(bridge)
  assert.ok(bridgeText.length < MAX_CATALOG_BRIDGE_RESPONSE_BYTES)
  assert.deepEqual(bridgeText, catalogBridgeBuffer(bridge), 