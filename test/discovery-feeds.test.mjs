import assert from 'node:assert/strict'
import test from 'node:test'
import {
  discoverFeedCandidates,
  discoveryWindowOffset,
  orderDiscoveryCandidates,
  parseCanonicalRepositoryUrl,
  validateDiscoveryFeedSource,
} from '../src/discovery-feeds.mjs'

const commit = 'a'.repeat(40)
const yamlSource = 'url: https://github.com/example/demo\ninstall: execute-malicious-command\n'
const yamlSourceConfig = {
  repository: 'awesome-dsh-plugin/awesome-dsh-plugin',
  branch: 'main',
  format: 'yaml-tree',
  filePattern: '^data/plugins/[a-zA-Z0-9_.-]+\\.yml$',
  maxFileBytes: 65_536,
  maxRecordsPerRun: 8,
}
const jsonMapSourceConfig = {
  repository: 'bruc3van/awesome-dsh-plugin',
  branch: 'main',
  format: 'json-map',
  path: 'data/approved.json',
  excludePath: 'data/curated.json',
  excludeKey: 'excluded_repos',
  maxFileBytes: 800_000,
  excludeMaxFileBytes: 400_000,
  maxEntries: 20_000,
  maxRecordsPerRun: 64,
  primary: true,
}

function fixtureClient({ source = yamlSource, truncated = false, files = ['data/plugins/example__demo.yml'] } = {}) {
  return {
    async api(path) {
      if (path.endsWith('commits/main')) return { sha: commit }
      if (path.includes('git/trees')) return {
        truncated,
        tree: files.map(file => ({ type: 'blob', mode: '100644', path: file })),
      }
      const match = /^repos\/([^/]+)\/([^/?]+)/.exec(path)
      if (!match) throw new Error(`unexpected API path ${path}`)
      return { html_url: `https://github.com/${match[1]}/${match[2]}`, owner: { id: 12 } }
    },
    async raw(repo, fixedCommit, path) {
      assert.equal(fixedCommit, commit)
      if (repo.endsWith('/awesome-dsh-plugin')) assert.match(path, /^data\/plugins\//)
      return source
    },
  }
}

test('fixed-Commit feed evidence is retained and cannot grant installation', async () => {
  const rows = await discoverFeedCandidates(fixtureClient(), {
    source: yamlSourceConfig,
    observedAt: '2026-09-15T00:00:00Z',
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].discoveryOnly, true)
  assert.equal(rows[0].discoverySourceKey, 'github-feed:awesome-dsh-plugin/awesome-dsh-plugin')
  assert.match(rows[0].feedEvidence, /github-feed:awesome-dsh-plugin\/awesome-dsh-plugin@/)
  assert.match(rows[0].feedEvidence, /sha256=[a-f0-9]{64}/)
  assert.match(rows[0].feedEvidence, /owner=12/)
  assert.deepEqual(rows[0].discoverySources, [rows[0].feedEvidence])
  assert.equal(rows[0].install, undefined)
  assert.equal(rows[0].packageName, undefined)
})

test('markdown discovery is limited to the configured single-plugin table and exact-root GitHub links', async () => {
  const markdown = [
    '[not-a-plugin](https://github.com/outside/skill) ',
    '## 🎓 技能',
    '| [skill](https://github.com/example/skill) |',
    '## 🔌 单插件（2）',
    '| [one](https://github.com/example/one) |',
    '| [two](https://github.com/example/two) |',
    '| [nested](https://github.com/example/three/tree/main) |',
    '## 🧰 插件集',
    '| [after](https://github.com/example/after) |',
  ].join('\n')
  const source = {
    repository: '0xsline/awesome-deepseek-harness',
    branch: 'main',
    format: 'markdown-table',
    path: 'CATALOG.md',
    sectionHeading: '## 🔌 单插件',
    maxFileBytes: 32_000,
    maxRecordsPerRun: 8,
  }
  const client = {
    async api(path) {
      if (path.endsWith('commits/main')) return { sha: commit }
      if (path.includes('git/trees')) throw new Error('markdown source must not enumerate a tree')
      const match = /^repos\/([^/]+)\/([^/?]+)/.exec(path)
      if (!match) throw new Error(`unexpected API path ${path}`)
      return { html_url: `https://github.com/${match[1]}/${match[2]}`, owner: { id: 42 } }
    },
    async raw(repo, fixedCommit, path, options) {
      assert.equal(repo, 'https://github.com/0xsline/awesome-deepseek-harness')
      assert.equal(fixedCommit, commit)
      assert.equal(path, 'CATALOG.md')
      assert.equal(options.maxBytes, 32_000)
      return markdown
    },
  }
  const rows = await discoverFeedCandidates(client, { source, observedAt: '2026-09-25T00:00:00Z' })
  assert.deepEqual(rows.map(row => row.html_url), [
    'https://github.com/example/one',
    'https://github.com/example/two',
  ])
  assert.ok(rows.every(row => row.discoveryOnly && row.discoverySources.length === 1))
})

test('large fixed JSON directory is pinned, exclusions are honored, and windows are bounded', async () => {
  const approved = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [
    `owner${String(index).padStart(2, '0')}/plugin-${String(index).padStart(2, '0')}`,
    '2026-09-25',
  ]))
  const client = {
    async api(path) {
      if (path === 'repos/bruc3van/awesome-dsh-plugin/commits/main') return { sha: commit }
      const match = /^repos\/([^/]+)\/([^/?]+)/.exec(path)
      if (!match) throw new Error(`unexpected API path ${path}`)
      return {
        html_url: `https://github.com/${match[1]}/${match[2]}`,
        full_name: `${match[1]}/${match[2]}`,
        owner: { id: 808 },
      }
    },
    async raw(repo, fixedCommit, path, options) {
      assert.equal(repo, 'https://github.com/bruc3van/awesome-dsh-plugin')
      assert.equal(fixedCommit, commit)
      if (path === 'data/approved.json') {
        assert.equal(options.maxBytes, 800_000)
        return JSON.stringify(approved)
      }
      assert.equal(path, 'data/curated.json')
      assert.equal(options.maxBytes, 400_000)
      return JSON.stringify({ excluded_repos: { 'owner00/plugin-00': 'not installable' }, market_exclusions: { 'owner01/plugin-01': 'still indexed' } })
    },
  }
  const stats = {}
  const rows = await discoverFeedCandidates(client, {
    source: jsonMapSourceConfig,
    offset: 0,
    limit: 64,
    stats,
    observedAt: '2026-09-25T00:00:00Z',
  })
  assert.equal(rows.length, 64)
  assert.deepEqual(rows.map(row => row.full_name).slice(0, 2), ['owner01/plugin-01', 'owner02/plugin-02'])
  assert.equal(rows[0].discoverySourceKey, 'github-feed:bruc3van/awesome-dsh-plugin')
  assert.match(rows[0].feedEvidence, /data\/approved\.json:sha256=[a-f0-9]{64}/)
  assert.deepEqual(stats, { totalRecords: 70, excludedRecords: 1, excludedMatches: 1, selectedRecords: 64, commit, liveRepositories: 64 })
})

test('large fixed JSON directory fails closed on malformed records and invalid exclusion schema', async () => {
  const makeClient = (approved, curated) => ({
    async api(path) {
      if (path.endsWith('commits/main')) return { sha: commit }
      throw new Error(`unexpected API path ${path}`)
    },
    async raw(_repo, _sha, path) { return path.endsWith('approved.json') ? approved : curated },
  })
  await assert.rejects(discoverFeedCandidates(makeClient('{"unsafe/../key":"2026-09-25"}', '{"excluded_repos":{}}'), {
    source: jsonMapSourceConfig,
  }), /record/)
  await assert.rejects(discoverFeedCandidates(makeClient('{"example/plugin":"2026-09-25"}', '{"excluded_repos":[]}'), {
    source: jsonMapSourceConfig,
  }), /exclusion map/)
  await assert.rejects(discoverFeedCandidates(makeClient('{"example/plugin":"2026-02-30"}', '{"excluded_repos":{}}'), {
    source: jsonMapSourceConfig,
  }), /feed record/)
  await assert.rejects(discoverFeedCandidates(makeClient('{bad json', '{}'), {
    source: jsonMapSourceConfig,
  }), /JSON map feed document/)
  assert.throws(() => validateDiscoveryFeedSource({ ...jsonMapSourceConfig, maxRecordsPerRun: 65 }), /record bound/)
  assert.throws(() => validateDiscoveryFeedSource({ ...jsonMapSourceConfig, path: '../approved.json' }), /JSON map feed bounds/)
})

test('feed parsing bounds, truncation, ambiguous records and unsafe repository URLs fail closed', async () => {
  await assert.rejects(discoverFeedCandidates(fixtureClient({ truncated: true }), { source: yamlSourceConfig }), /bound/)
  await assert.rejects(discoverFeedCandidates(fixtureClient(), { source: yamlSourceConfig, limit: 9 }), /bound/)
  await assert.rejects(discoverFeedCandidates(fixtureClient(), { source: { ...yamlSourceConfig, maxRecordsPerRun: 65 } }), /record bound/)
  await assert.rejects(discoverFeedCandidates(fixtureClient(), { source: { ...yamlSourceConfig, repository: 'example/../repo' } }), /source/)
  assert.deepEqual(await discoverFeedCandidates(fixtureClient({ source: 'url: !!js malicious\n' }), { source: yamlSourceConfig }), [])
  assert.deepEqual(await discoverFeedCandidates(fixtureClient({ source: 'url: https://other.example/plugin\n' }), { source: yamlSourceConfig }), [])
  assert.deepEqual(await discoverFeedCandidates(fixtureClient({
    source: 'url: https://github.com/example/demo\nurl: https://github.com/other/demo\n',
  }), { source: yamlSourceConfig }), [])
  assert.equal(parseCanonicalRepositoryUrl('https://github.com/example/demo'), 'https://github.com/example/demo')
  assert.equal(parseCanonicalRepositoryUrl('https://github.com/example/demo/tree/main'), null)
  assert.equal(parseCanonicalRepositoryUrl('https://github.com.evil.example/example/demo'), null)
  assert.equal(parseCanonicalRepositoryUrl('https://user@github.com/example/demo'), null)
})

test('stale repository links in a feed do not discard neighboring live discoveries', async () => {
  const source = {
    repository: 'example/curated-list', branch: 'main', format: 'markdown-table',
    path: 'CATALOG.md', sectionHeading: '## Plugins', maxFileBytes: 10_000, maxRecordsPerRun: 5,
  }
  const client = {
    async api(path) {
      if (path.endsWith('commits/main')) return { sha: commit }
      if (path === 'repos/deleted/gone') throw Object.assign(new Error('Not Found'), { status: 404 })
      const match = /^repos\/([^/]+)\/([^/?]+)/.exec(path)
      if (match) return { html_url: `https://github.com/${match[1]}/${match[2]}`, owner: { id: 99 } }
      throw new Error(`unexpected API path ${path}`)
    },
    async raw() {
      return [
        '## Plugins',
        '| [gone](https://github.com/deleted/gone) |',
        '| [live](https://github.com/example/live) |',
      ].join('\n')
    },
  }
  const rows = await discoverFeedCandidates(client, { source, limit: 5 })
  assert.deepEqual(rows.map(row => row.html_url), ['https://github.com/example/live'])
})

test('renamed repository links are resolved to the live canonical GitHub repository', async () => {
  const source = {
    repository: 'example/curated-list', branch: 'main', format: 'markdown-table',
    path: 'CATALOG.md', sectionHeading: '## Plugins', maxFileBytes: 10_000, maxRecordsPerRun: 5,
  }
  const client = {
    async api(path) {
      if (path.endsWith('commits/main')) return { sha: commit }
      if (path === 'repos/old-owner/old-name') return {
        html_url: 'https://github.com/new-owner/new-name', owner: { id: 700 },
      }
      throw new Error(`unexpected API path ${path}`)
    },
    async raw() { return '## Plugins\n| [renamed](https://github.com/old-owner/old-name) |' },
  }
  const rows = await discoverFeedCandidates(client, { source, limit: 5 })
  assert.deepEqual(rows.map(row => row.html_url), ['https://github.com/new-owner/new-name'])
  assert.equal(rows[0].owner.id, 700)
})

test('all bounded discovery sources receive a round-robin scan slot', () => {
  const items = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `search-${i}`, updated_at: '2026-09-15', discoverySourceKey: 'github-search' })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `awesome-${i}`, updated_at: '2026-09-01', discoveryOnly: true, discoverySourceKey: 'github-feed:awesome' })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `catalog-${i}`, updated_at: '2026-08-28', discoveryOnly: true, discoverySourceKey: 'github-feed:catalog' })),
  ]
  const selected = orderDiscoveryCandidates(items).slice(0, 12)
  assert.equal(selected.filter(item => item.discoverySourceKey === 'github-search').length, 4)
  assert.equal(selected.filter(item => item.discoverySourceKey === 'github-feed:awesome').length, 4)
  assert.equal(selected.filter(item => item.discoverySourceKey === 'github-feed:catalog').length, 4)
})

test('new GitHub activity cannot starve a curated feed in a bounded scan', () => {
  const recent = Array.from({ length: 20 }, (_, i) => ({ id: i, updated_at: '2026-09-15' }))
  const feed = Array.from({ length: 8 }, (_, i) => ({ id: `feed-${i}`, discoveryOnly: true, updated_at: '2026-01-01' }))
  const selected = orderDiscoveryCandidates([...recent, ...feed]).slice(0, 8)
  assert.equal(selected.filter(item => item.discoveryOnly).length, 4)
  assert.equal(selected.filter(item => !item.discoveryOnly).length, 4)
})

test('the primary large directory is scanned before search and secondary directory fallbacks', () => {
  const items = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `search-${i}`, discoverySourceKey: 'github-search', discoverySourceKeys: ['github-search'] })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `primary-${i}`, discoverySourceKey: 'github-search', discoverySourceKeys: ['github-search', 'github-feed:large-index'] })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `fallback-${i}`, discoverySourceKey: 'github-feed:small-index', discoverySourceKeys: ['github-feed:small-index'], discoveryOnly: true })),
  ]
  const ordered = orderDiscoveryCandidates(items, ['github-feed:large-index'])
  assert.deepEqual(ordered.slice(0, 8).map(item => item.id), Array.from({ length: 8 }, (_, i) => `primary-${i}`))
})

test('the configured multi-source feed contract stays explicit and bounded', () => {
  assert.doesNotThrow(() => validateDiscoveryFeedSource(yamlSourceConfig))
  assert.doesNotThrow(() => validateDiscoveryFeedSource(jsonMapSourceConfig))
  assert.throws(() => validateDiscoveryFeedSource({ ...yamlSourceConfig, format: 'executable-script' }), /unsupported/)
})

test('scheduled feed windows advance contiguously without skipping unscanned records', () => {
  const interval = 8 * 3_600_000
  assert.equal(discoveryWindowOffset(0, 8, 5), 0)
  assert.equal(discoveryWindowOffset(interval - 1, 8, 5), 0)
  assert.equal(discoveryWindowOffset(interval, 8, 5), 5)
  assert.equal(discoveryWindowOffset(interval * 2, 8, 5), 10)
  assert.throws(() => discoveryWindowOffset(-1, 8, 5), /schedule window/)
  assert.throws(() => discoveryWindowOffset(0, 0, 5), /schedule window/)
  assert.throws(() => discoveryWindowOffset(0, 8, 0), /schedule window/)
})
