import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createKnownPluginDirectory, fetchPublicDiscoveryIndex, filterPluginDirectory } from '../marketplace/lib/plugin-directory.js'
import { projectDiscoveryIndex } from '../scripts/build-plugin-discovery-index.mjs'

const catalog = [
  { id: 'catalog-approved', nameZh: '已收录插件', nameEn: 'Listed plugin', packageName: 'alpha-package', repositoryUrl: 'https://github.com/example/one', status: 'approved', categories: ['developer'] },
  { id: 'catalog-blocked', nameZh: '策略状态不影响收录标记', nameEn: 'Policy state does not change listing', packageName: 'beta-package', repositoryUrl: 'https://github.com/example/two', status: 'blocked', categories: ['file'] },
  { id: 'catalog-hidden', nameZh: '目录中仍有记录', nameEn: 'A record remains in the catalog', packageName: 'hidden-package', repositoryUrl: 'https://github.com/example/catalog-only', status: 'unlisted', categories: ['catalog-tool'] },
]

function publicIndex(count) {
  return {
    schemaVersion: 1,
    source: {
      url: 'https://www.dsh.so/plugins-index.json',
      generatedAt: '2026-10-13T00:19:35.310Z',
      recordCount: count,
      license: { spdx: 'CC-BY-4.0', attribution: 'dsh.so — DSH Developer Hub (https://www.dsh.so)' },
    },
    entries: Array.from({ length: count }, (_, sourceIndex) => ({
      sourceIndex,
      sourceId: `record-${sourceIndex}`,
      alias: `plugin-${sourceIndex}`,
      name: sourceIndex === 0 ? 'Ordinary generic extension' : `Plugin ${sourceIndex}`,
      description: 'Public directory metadata only',
      categories: [sourceIndex % 2 === 0 ? 'developer' : 'file'],
      repositoryUrl: sourceIndex === 0 ? 'https://github.com/example/one'
        : sourceIndex === 1 ? 'https://github.com/example/two'
          : `https://github.com/example/repo-${sourceIndex}`,
      stars: sourceIndex,
      detailUrl: `https://www.dsh.so/artifact/record-${sourceIndex}/`,
    })),
  }
}

const candidates = [
  { id: 'candidate-duplicate', name: 'Duplicate source repository', repositoryUrl: 'https://github.com/example/one', topics: ['unrelated'] },
  { id: 'generic-candidate', name: 'Generic extension', description: 'No DSH keywords required', repositoryUrl: 'https://github.com/example/generic-candidate', topics: [] },
  { id: 'no-repository', name: 'Repository unavailable', description: 'Still retained as a known record', topics: ['new-topic'] },
]

test('directory retains all 12,000 public records and supplements Catalog/candidate-only records', () => {
  const index = publicIndex(12_000)
  const entries = createKnownPluginDirectory(catalog, candidates, { discoveryIndex: index })

  assert.equal(entries.length, 12_003)
  const sourceRows = entries.filter(entry => entry.source === 'discovery')
  assert.equal(sourceRows.length, 12_000)
  assert.deepEqual(sourceRows.map(entry => entry.sourceIndex), Array.from({ length: 12_000 }, (_, index) => index))
  assert.ok(entries.some(entry => entry.nameZh === 'Ordinary generic extension'))
  assert.ok(entries.some(entry => entry.source === 'candidate' && entry.sourceId === 'generic-candidate'))
  assert.equal(entries.filter(entry => entry.source === 'candidate').length, 2)
  assert.equal(entries.filter(entry => entry.listingStatus === 'listed').length, 3)
  assert.equal(entries.filter(entry => entry.listingStatus === 'unlisted').length, 12_000)
  assert.equal(entries.find(entry => entry.sourceId === 'record-0').listingStatus, 'listed')
  assert.equal(entries.find(entry => entry.sourceId === 'record-1').listingStatus, 'listed')
  assert.equal(entries.find(entry => entry.id === 'catalog:catalog-hidden').listingStatus, 'listed')
  assert.equal(entries.find(entry => entry.id === 'candidate:no-repository').primaryCategory, 'uncategorized')
  assert.ok(entries.filter(entry => entry.listingStatus === 'unlisted').every(entry => /尚未匹配到/.test(entry.listingReason)))
  assert.ok(entries.every(entry => !('install' in entry) && !('installable' in entry) && !('allowedActions' in entry)))

  assert.equal(filterPluginDirectory(entries, { category: 'developer' }).length, 6_000)
  assert.equal(filterPluginDirectory(entries, { category: 'developer', listingFilter: 'listed' }).length, 1)
  assert.equal(filterPluginDirectory(entries, { listingFilter: 'unlisted' }).length, 12_000)
  assert.equal(filterPluginDirectory(entries, { query: 'generic extension' }).length, 2)
})

test('catalog status or review metadata never screens public discovery rows', () => {
  const entries = createKnownPluginDirectory(catalog, [], { discoveryIndex: publicIndex(4) })
  const byRepository = new Map(entries.filter(entry => entry.source === 'discovery').map(entry => [entry.repositoryUrl, entry]))
  assert.ok(byRepository.has('https://github.com/example/repo-2'))
  assert.equal(byRepository.get('https://github.com/example/one').listingStatus, 'listed')
  assert.equal(byRepository.get('https://github.com/example/two').listingStatus, 'listed')
  assert.equal(byRepository.get('https://github.com/example/repo-2').listingStatus, 'unlisted')
})

test('discovery snapshot builder preserves source count, source order, attribution, and safe category fallbacks', () => {
  const projected = projectDiscoveryIndex({
    generatedAt: '2026-10-13T00:19:35.310Z',
    count: 2,
    plugins: [
      { id: 'one', name: 'One', topics: ['AI Agents', 'Browser'], capability: { samples: ['workflow'] }, install: 'dsh plugin --profile web add github:example/one#abc' },
      null,
    ],
  })
  assert.equal(projected.entries.length, 2)
  assert.deepEqual(projected.entries.map(entry => entry.sourceIndex), [0, 1])
  assert.deepEqual(projected.entries[0].categories, ['ai-agents', 'browser', 'workflow'])
  assert.deepEqual(projected.entries[1].categories, ['uncategorized'])
  assert.equal(projected.entries[0].repositoryUrl, 'https://github.com/example/one')
  assert.ok(!('install' in projected.entries[0]))
  assert.equal(projected.source.license.attribution, 'dsh.so — DSH Developer Hub (https://www.dsh.so)')
  assert.throws(() => projectDiscoveryIndex({ generatedAt: '2026-10-13T00:19:35Z', count: 1, plugins: [] }), /count/)
})

test('directory index falls back to GitHub Pages and verifies the complete payload', async () => {
  const payload = publicIndex(1)
  const bytes = Buffer.from(JSON.stringify(payload))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const compressed = gzipSync(bytes, { level: 9, mtime: 0 })
  const requests = []
  const index = await fetchPublicDiscoveryIndex({
    url: 'https://dsh.store/registry/discovery-index.json',
    integrity: { sha256, bytes: bytes.byteLength, count: 1 },
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      if (url.startsWith('https://dsh.store/')) return new Response('temporarily slow', { status: 503 })
      return new Response(compressed, {
        status: 200,
        headers: { 'content-type': 'application/gzip', 'content-length': String(compressed.byteLength) },
      })
    },
  })

  assert.equal(index.entries.length, 1)
  assert.equal(index.entries[0].description, 'Public directory metadata only')
  assert.equal(requests.length, 2)
  assert.match(requests[0].url, /^https:\/\/dsh\.store\/registry\/discovery-index\.json\.gz\?v=/)
  assert.match(requests[1].url, /^https:\/\/ai-scarlett\.github\.io\/DSH-Store\/registry\/discovery-index\.json\.gz\?v=/)
  assert.ok(requests.every(request => request.options.signal instanceof AbortSignal))
})

test('directory index rejects a CDN payload that does not match the published digest', async () => {
  const expected = publicIndex(1)
  const modified = publicIndex(1)
  modified.entries[0].description = 'Public directory metadata onlY'
  const expectedBytes = Buffer.from(JSON.stringify(expected))
  const modifiedBytes = Buffer.from(JSON.stringify(modified))
  const requests = []

  await assert.rejects(fetchPublicDiscoveryIndex({
    url: 'https://dsh.store/registry/discovery-index.json',
    integrity: {
      sha256: createHash('sha256').update(expectedBytes).digest('hex'),
      bytes: expectedBytes.byteLength,
      count: 1,
    },
    fetchImpl: async (url) => {
      requests.push(url)
      if (url.startsWith('https://dsh.store/') && new URL(url).pathname.endsWith('.gz')) return new Response('', { status: 503 })
      if (url.startsWith('https://ai-scarlett.github.io/')) return new Response(gzipSync(modifiedBytes), { status: 200 })
      return new Response(modifiedBytes, { status: 200, headers: { 'content-type': 'application/json' } })
    },
  }), /SHA-256 does not match/)
  assert.equal(requests.length, 3)
})

test('checked-in public snapshot contains every source row and gzip is an exact transport copy', async () => {
  const [raw, compressed] = await Promise.all([
    readFile(new URL('../registry/discovery-index.json', import.meta.url)),
    readFile(new URL('../registry/discovery-index.json.gz', import.meta.url)),
  ])
  const index = JSON.parse(raw.toString('utf8'))
  assert.equal(index.source.recordCount, 19_345)
  assert.equal(index.entries.length, 19_345)
  assert.equal(index.source.generatedAt, '2026-10-13T00:19:35.310Z')
  assert.equal(index.source.license.spdx, 'CC-BY-4.0')
  assert.equal(index.entries[0].sourceIndex, 0)
  assert.equal(index.entries.at(-1).sourceIndex, 19_344)
  assert.ok(index.entries.every(entry => Array.isArray(entry.categories) && entry.categories.length > 0))
  assert.equal(gunzipSync(compressed).byteLength, raw.byteLength)
  assert.deepEqual(gunzipSync(compressed), raw)
})
