import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createKnownPluginDirectory, filterPluginDirectory, isDshDiscoveryCandidate } from '../marketplace/lib/plugin-directory.js'

const catalog = [
  { id: 'listed-one', nameZh: '已收录插件', nameEn: 'Listed plugin', packageName: 'dsh-listed', version: '1.2.0', repositoryUrl: 'https://github.com/example/listed', status: 'approved', categories: ['tools'], searchTerms: ['listed'], order: 1, detailPath: 'catalog/details/listed.json' },
  { id: 'blocked-one', nameZh: '策略阻止插件', nameEn: 'Blocked plugin', packageName: 'dsh-blocked', version: '1.0.0', repositoryUrl: 'https://github.com/example/blocked', status: 'blocked', statusReason: 'missing standard bundle', categories: ['tools'], searchTerms: ['blocked'], order: 2, detailPath: 'catalog/details/blocked.json' },
  { id: 'unlisted-one', nameZh: '下架插件', nameEn: 'Unlisted plugin', packageName: 'dsh-unlisted', version: '0.9.0', repositoryUrl: 'https://github.com/example/unlisted', status: 'unlisted', categories: ['workflow'], searchTerms: ['unlisted'], order: 3, detailPath: 'catalog/details/unlisted.json' },
]
const candidates = [
  { id: 'candidate-duplicate', name: 'Duplicate repo candidate', description: 'DSH plugin', repositoryUrl: 'https://github.com/example/listed', topics: ['dsh-plugin'], status: 'reviewing', route: 'direct-review', statusReason: 'duplicate' },
  { id: 'new-candidate', name: 'New DSH Plugin', description: 'A new integration', repositoryUrl: 'https://github.com/example/new', topics: ['dsh-plugin'], status: 'reviewing', route: 'direct-review', statusReason: 'awaiting review', discoveredAt: '2026-10-01T00:00:00.000Z' },
  { id: 'unrelated', name: 'Generic library', description: 'A general JavaScript library', repositoryUrl: 'https://github.com/example/generic', topics: ['javascript'], status: 'reviewing', route: 'direct-review' },
]

test('directory combines every Catalog status with unique known DSH candidates only', () => {
  const entries = createKnownPluginDirectory(catalog, candidates)
  assert.equal(entries.length, 4)
  assert.deepEqual(entries.map(entry => entry.listingStatus), ['listed', 'unlisted', 'unlisted', 'unlisted'])
  assert.equal(entries.filter(entry => entry.source === 'candidate').length, 1)
  assert.equal(entries.find(entry => entry.id === 'candidate:new-candidate').listingReason, 'awaiting review')
  assert.equal(entries.find(entry => entry.id === 'unlisted-one').listingReason, '该插件当前未在商城目录中上架。')
  assert.equal(entries.find(entry => entry.id === 'blocked-one').listingReason, 'missing standard bundle')
})

test('directory filters by listed state, query, and category without changing admission', () => {
  const entries = createKnownPluginDirectory(catalog, candidates)
  assert.deepEqual(filterPluginDirectory(entries, { listingFilter: 'listed' }).map(entry => entry.id), ['listed-one'])
  assert.deepEqual(filterPluginDirectory(entries, { listingFilter: 'unlisted', query: 'awaiting' }).map(entry => entry.id), ['candidate:new-candidate'])
  assert.deepEqual(filterPluginDirectory(entries, { category: 'workflow' }).map(entry => entry.id), ['unlisted-one'])
  assert.equal(entries[0].status, 'approved')
  assert.equal(entries[1].status, 'blocked')
})

test('candidate matching uses explicit DSH evidence and excludes malformed repository URLs', () => {
  assert.equal(isDshDiscoveryCandidate({ topics: ['deepseek-harness-plugin'] }), true)
  assert.equal(isDshDiscoveryCandidate({ topics: ['dsh-plugin-candidate'] }), true)
  assert.equal(isDshDiscoveryCandidate({ topics: ['dsh-compatibility-review'] }), true)
  assert.equal(isDshDiscoveryCandidate({ topics: ['dsh-plugins'] }), true)
  assert.equal(isDshDiscoveryCandidate({ name: 'Ordinary library', description: 'No relation', topics: [] }), false)
  const entries = createKnownPluginDirectory([], [
    { ...candidates[1], repositoryUrl: 'https://example.com/new' },
    { ...candidates[1], id: 'non-dsh', name: 'Ordinary', description: 'none', topics: ['javascript'], repositoryUrl: 'https://github.com/example/ordinary' },
  ])
  assert.deepEqual(entries, [])
})

test('repository registry union includes every Catalog state plus deduplicated DSH candidates', async () => {
  const [catalogIndex, candidateRegistry] = await Promise.all([
    readFile(new URL('../registry/catalog-index.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../registry/candidates.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  const entries = createKnownPluginDirectory(catalogIndex.entries, candidateRegistry.entries)
  const catalogRepositories = new Set(catalogIndex.entries.map(entry => entry.repositoryUrl.toLowerCase()))
  const extraCandidates = candidateRegistry.entries.filter(entry => isDshDiscoveryCandidate(entry)
    && !catalogRepositories.has(entry.repositoryUrl.toLowerCase()))
  const approvedCount = catalogIndex.entries.filter(entry => entry.status === 'approved').length
  assert.equal(entries.length, catalogIndex.entries.length + extraCandidates.length)
  assert.equal(entries.filter(entry => entry.listingStatus === 'listed').length, approvedCount)
  assert.equal(entries.filter(entry => entry.listingStatus === 'unlisted').length, entries.length - approvedCount)
  assert.ok(entries.filter(entry => entry.listingStatus === 'unlisted').every(entry => entry.listingReason))
  assert.ok(entries.filter(entry => entry.source === 'candidate').every(entry => !('installable' in entry) && !('allowedActions' in entry)))
})
