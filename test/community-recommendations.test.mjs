import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { loadCatalogFromFiles } from '../src/catalog.mjs'
import { handleMarketRequest } from '../src/panel.mjs'
import { communityRecommendationEntries, communityRecommendationPage, validateCommunityRecommendations } from '../marketplace/lib/community-recommendations.js'
import { createRankingSnapshot, rankingEntries, rankingPage, renderRankingRows, applyRankingRefreshState } from '../marketplace/rankings/model.js'
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))

test('verified recommendation labels match reviewed package manifests and do not repeat repository headings', async () => {
  const [registry, plan] = await Promise.all([
    json('../registry/community-recommendations.json'),
    json('../docs/ops/community-recommendation-ranking-name-fix-plan-20261021.json'),
  ])
  const byId = new Map(registry.entries.map(entry => [entry.id, entry]))
  assert.match(plan.baseCommit, /^[a-f0-9]{40}$/)
  assert.equal(plan.change.verifiedPackageNames.length, 17)
  for (const expected of plan.change.verifiedPackageNames) {
    const entry = byId.get(expected.id)
    assert.ok(entry, `recommendation ${expected.id} exists`)
    assert.equal(entry.name, expected.name, `${expected.repository} ${expected.manifestPath}`)
    assert.notEqual(entry.name.toLowerCase(), expected.repository.toLowerCase())
  }
})

test('all interactive plugins remain on both recommendation surfaces across every page with admission unchanged', async () => {
  const [catalog, index, registry, policy, candidates] = await Promise.all([
    loadCatalogFromFiles(), json('../registry/catalog-index.json'), json('../registry/community-recommendations.json'),
    json('../registry/automation-policy.json'), json('../registry/candidates.json'),
  ])
  const original = JSON.stringify(catalog)
  const selected = communityRecommendationEntries(registry, index.entries, policy.search.excludedRepositories)
  assert.ok(selected.length > 100)
  const ranking = applyRankingRefreshState(createRankingSnapshot(catalog, index, {
    communityRecommendations: registry, excludedRepositories: policy.search.excludedRepositories, candidates,
  }), null, 'reuse')
  const expected = new Set(selected.map(entry => entry.catalogId ?? entry.id))
  const ranked = rankingEntries(ranking, 'recommended').filter(entry => entry.communityRecommendation)
  assert.deepEqual(new Set(ranked.map(entry => entry.id)), expected)
  const pages = Array.from({ length: Math.ceil(ranked.length / 30) }, (_, i) => rankingPage(ranking, 'recommended', i + 1).entries).flat()
  assert.deepEqual(new Set(pages.filter(entry => entry.communityRecommendation).map(entry => entry.id)), expected)
  const denied = ranked.find(entry => entry.reviewStatus === 'blocked')
  assert.ok(denied)
  const html = renderRankingRows([denied], { type: 'recommended' })
  assert.match(html, /作者互动推荐/)
  assert.match(html, /未收录原因/)
  assert.match(html, /仅查看 GitHub/)
  assert.doesNotMatch(html, /href="\.\.\/plugins\//)
  const root = await mkdtemp(join(tmpdir(), 'dsh-recommendations-'))
  try {
    await mkdir(join(root, 'profiles/web'), { recursive: true })
    await writeFile(join(root, 'profiles/web/package.json'), JSON.stringify({ name: 'fixture', dependencies: {}, dsh: { profile: { bundles: [] } } }))
    const received = []
    for (let page = 1; page <= Math.ceil(selected.length / 20); page++) {
      const req = Readable.from([JSON.stringify({ view: 'market', featuredOnly: true, page })])
      req.method = 'POST'; req.headers = { host: 'localhost', 'content-type': 'application/json' }
      const res = { status: null, body: '', writeHead(status) { this.status = status }, end(body) { this.body = String(body) } }
      await handleMarketRequest(req, res, {
        dshHome: root, communityRecommendations: registry, automationPolicy: policy,
        catalogService: { loadIndex: async () => index, loadDetails: async ids => catalog.entries.filter(entry => ids.includes(entry.id)) },
        candidateService: { load: async () => candidates },
      })
      assert.equal(res.status, 200, res.body)
      const value = JSON.parse(res.body).value
      assert.equal(value.pagination.total, selected.length)
      for (const row of value.recommendations) {
        received.push(row.entry.id)
        if (row.kind === 'catalog' && row.entry.status !== 'approved') assert.ok(!row.entry.allowedActions.includes('install'))
        if (row.kind === 'candidate') assert.equal(row.entry.allowedActions, undefined)
      }
    }
    assert.deepEqual(new Set(received), expected)
    assert.equal(received.length, expected.size)
    assert.equal(JSON.stringify(catalog), original)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('evidence identity drift and duplicate records fail closed; exclusions and final-page search are respected', () => {
  const base = { id: 'a', catalogId: 'a', repositoryUrl: 'https://github.com/example/a', manifestPath: 'package.json', name: 'A', categories: ['tools'], basis: 'author-interaction', userId: 1, evidenceUrl: 'https://github.com/AI-Scarlett/DSH-Store/issues/1', occurredAt: '2026-10-16T00:00:00Z' }
  const registry = { schemaVersion: 1, updatedAt: base.occurredAt, entries: [base] }
  assert.throws(() => validateCommunityRecommendations({ ...registry, entries: [base, base] }), /Invalid/)
  assert.throws(() => communityRecommendationEntries(registry, [{ id: 'a', repositoryUrl: 'https://github.com/other/a' }]), /identity mismatch/)
  assert.deepEqual(communityRecommendationEntries(registry, [], [{ repositoryUrl: base.repositoryUrl }]), [])
  const entries = Array.from({ length: 65 }, (_, i) => ({ ...base, id: String(i), name: `Plugin ${i}` }))
  assert.equal(communityRecommendationPage(entries, { page: 4 }).entries.length, 5)
  assert.equal(communityRecommendationPage(entries, { query: 'Plugin 64' }).entries[0].id, '64')
})

test('recommendation names cannot reuse repair-request titles or float beside a matching Catalog repository', () => {
  const base = { id: 'a', catalogId: null, repositoryUrl: 'https://github.com/example/a', manifestPath: 'package.json', name: '作者修复请求：example/a（DSH STORE）', categories: [], basis: 'author-interaction', userId: 1, evidenceUrl: 'https://github.com/AI-Scarlett/DSH-Store/issues/1', occurredAt: '2026-10-16T00:00:00Z' }
  const registry = { schemaVersion: 1, updatedAt: base.occurredAt, entries: [base] }
  assert.throws(() => validateCommunityRecommendations(registry), /Invalid community recommendation evidence/)
  assert.throws(() => validateCommunityRecommendations({ ...registry, entries: [{ ...base, name: 'Example/a' }] }), /Invalid community recommendation evidence/)
  const named = { ...registry, entries: [{ ...base, name: 'Example Plugin' }] }
  assert.throws(() => communityRecommendationEntries(named, [{ id: 'example-plugin', repositoryUrl: base.repositoryUrl }]), /must bind Catalog identity/)
})
