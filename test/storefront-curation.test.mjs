import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RANKING_TYPES, createRankingSnapshot, validateRankingSnapshot, normalizeStorefrontCuration,
  mergeCuration, curatedRankingEntries, rankingChoicesSnapshot, sanitizeCurationForSnapshot,
  rankingCurationChoices, renderRankingRows,
} from '../marketplace/rankings/model.js'

const observed = '2026-11-22T05:00:00.000Z'
const item = (id, stars, categories = ['tools'], extra = {}) => ({
  id, name: id, description: `About ${id}`, version: '1.0.0',
  repositoryUrl: `https://github.com/example/${id}`, commit: 'a'.repeat(40), status: 'approved',
  featured: false, categories, github: { stars }, ...extra,
})
function snapshot(entries) {
  const catalog = { registry: { updatedAt: observed, categories: { tools: '工具', memory: '记忆' } }, entries }
  const index = { entries: entries.map((entry, order) => ({ ...entry, nameZh: entry.name, nameEn: entry.id, order })) }
  return validateRankingSnapshot(createRankingSnapshot(catalog, index, { sourceCommit: 'b'.repeat(40), starsObservedAt: observed }))
}
const extra = (id, repositoryUrl, overrides = {}) => ({
  id, repositoryUrl, nameZh: `名称 ${id}`, nameEn: `Name ${id}`, description: '手动加入的公开项目',
  packageName: null, version: '', stars: 7, starsObservedAt: observed, categories: ['tools'],
  addedAt: observed, ...overrides,
})
const manual = ids => ({ mode: 'manual', ids })
const auto = () => ({ mode: 'auto', ids: [] })

function curated(boards = {}, extras = [], home = []) {
  return normalizeStorefrontCuration({
    schemaVersion: 1, revision: 3, updatedAt: observed, home: { featured: home },
    boards: Object.fromEntries(RANKING_TYPES.map(type => [type, boards[type] ?? auto()])), extras,
  })
}

test('storefront curation normalizes every board, extras and homepage picks', () => {
  const data = snapshot([item('alpha', 20), item('beta', 10)])
  const curation = curated({ popular: manual(['beta', 'alpha']) }, [
    extra('manual-example-third', 'https://github.com/example/third'),
  ], ['alpha'])
  assert.equal(curation.revision, 3)
  assert.deepEqual(curation.home.featured, ['alpha'])
  assert.deepEqual(curation.boards.popular, { mode: 'manual', ids: ['beta', 'alpha'] })
  assert.equal(curation.boards.listed.mode, 'auto')
  assert.equal(curation.extras[0].repositoryUrl, 'https://github.com/example/third')
  assert.deepEqual(curatedRankingEntries(data, 'popular', curation).map(entry => entry.id), ['beta', 'alpha'])
})

test('manual ordering is supported on all four boards while official slots stay protected', () => {
  const data = snapshot([
    item('store', 2000, ['tools'], { repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store' }),
    item('build-dsh-plugin', 1900, ['tools'], { repositoryUrl: 'https://github.com/AI-Scarlett/build-dsh-plugin' }),
    ...Array.from({ length: 20 }, (_, index) => item(`row-${String(index).padStart(2, '0')}`, 100 - index, ['tools'])),
  ])
  for (const type of RANKING_TYPES) {
    const choices = rankingCurationChoices(data, type)
    assert.equal(choices.limit > 0, true)
    const ids = choices.selectable.slice(0, 8).map(entry => entry.id).reverse()
    const result = curatedRankingEntries(data, type, curated({ [type]: manual(ids) }))
    if (type === 'recommended' || type === 'essential') {
      const official = result.filter(entry => entry.officialToolPick).map(entry => entry.id)
      assert.equal(official.length, 2, `${type} keeps both official tool slots`)
      assert.deepEqual(result.filter(entry => !entry.officialToolPick).map(entry => entry.id), ids)
    } else {
      assert.deepEqual(result.map(entry => entry.id), ids)
      assert.ok(result.every(entry => entry.manualCuration))
    }
  }
})

test('manual extras join popular, recommended and essential with GitHub-only status', () => {
  const data = snapshot([item('alpha', 20), item('beta', 10)])
  const extraRow = extra('manual-owner-third', 'https://github.com/owner/third', { stars: 42 })
  for (const type of ['popular', 'recommended', 'essential']) {
    const result = curatedRankingEntries(data, type, curated({ [type]: manual(['manual-owner-third', 'alpha']) }, [extraRow]))
    assert.deepEqual(result.slice(0, 2).map(entry => entry.id), ['manual-owner-third', 'alpha'])
    const row = result[0]
    assert.equal(row.source, 'manual')
    assert.equal(row.listingStatus, 'not-listed')
    assert.equal(row.stars, 42)
    assert.equal(row.manualCuration, true)
    const html = renderRankingRows([row], { type })
    assert.match(html, /手动加入榜单/)
    assert.match(html, /仅查看 GitHub/)
    assert.doesNotMatch(html, /plugins\/\?q=/)
  }
})

test('listed boards reject manual extras and non-listed snapshot entries', () => {
  assert.throws(() => curated({ listed: manual(['manual-owner-third']) }, [
    extra('manual-owner-third', 'https://github.com/owner/third'),
  ]), /Listed board cannot include manual extras/)
  const data = snapshot([item('alpha', 20), item('hidden', 5, ['tools'], { status: 'unlisted' })])
  const result = curatedRankingEntries(data, 'listed', curated({ listed: manual(['hidden', 'alpha']) }))
  assert.deepEqual(result.map(entry => entry.id), ['alpha'])
})

test('stale ids and ineligible featured picks are dropped without breaking the board', () => {
  const data = snapshot([item('alpha', 20), item('beta', 10)])
  const curation = curated({ popular: manual(['missing', 'beta', 'alpha']) }, [], ['missing', 'alpha'])
  const sanitized = sanitizeCurationForSnapshot(curation, data)
  assert.deepEqual(sanitized.curation.boards.popular.ids, ['beta', 'alpha'])
  assert.deepEqual(sanitized.curation.home.featured, ['alpha'])
  assert.deepEqual(sanitized.dropped.map(entry => entry.id).sort(), ['missing', 'missing'])
  assert.equal(sanitized.changed, true)

  const emptied = sanitizeCurationForSnapshot(curated({ listed: manual(['missing']) }), data)
  assert.deepEqual(emptied.curation.boards.listed, { mode: 'auto', ids: [] })
})

test('admin overlays merge per board and never erase committed extras', () => {
  const base = curated({ popular: manual(['alpha']), recommended: manual(['beta']) }, [
    extra('manual-owner-third', 'https://github.com/owner/third'),
  ], ['alpha'])
  const overlay = normalizeStorefrontCuration({
    sourceCommit: 'b'.repeat(40), revision: 9, updatedAt: observed,
    boards: { recommended: manual(['alpha']), essential: auto() },
  })
  const merged = mergeCuration(base, overlay)
  assert.deepEqual(merged.boards.popular.ids, ['alpha'], 'auto overlay keeps the committed board')
  assert.deepEqual(merged.boards.recommended.ids, ['alpha'], 'manual overlay wins')
  assert.equal(merged.extras.length, 1)
  assert.deepEqual(merged.home.featured, ['alpha'])
})

test('curation choices cover every board and expose automatic order for the management panel', () => {
  const data = snapshot([item('alpha', 20), item('beta', 10), item('hidden', 50, ['tools'], { status: 'unlisted' })])
  const choices = rankingChoicesSnapshot(data)
  assert.deepEqual(Object.keys(choices.boards).sort(), [...RANKING_TYPES].sort())
  assert.deepEqual(choices.boards.popular.automatic, ['hidden', 'alpha', 'beta'])
  assert.deepEqual(choices.boards.listed.selectable, ['alpha', 'beta'])
  assert.equal(choices.boards.recommended.selectable.includes('hidden'), true)
  assert.deepEqual(choices.boards.essential.automatic.map(String), ['hidden', 'alpha', 'beta'])
})

test('invalid curation fails closed instead of rendering an unvalidated board', () => {
  const data = snapshot([item('alpha', 20)])
  for (const bad of [
    { boards: { popular: { mode: 'manual', ids: ['alpha', 'alpha'] } } },
    { boards: { popular: { mode: 'manual', ids: ['bad id!'] } } },
    { boards: { popular: { mode: 'manual', ids: Array.from({ length: 101 }, (_, i) => `id-${i}`) } } },
    { extras: [extra('manual-owner-third', 'https://github.com/owner/third'), extra('manual-owner-third', 'https://github.com/owner/fourth')] },
    { extras: [extra('manual-owner-third', 'https://github.com/owner/third'), extra('manual-owner-fourth', 'https://github.com/owner/third')] },
  ]) assert.throws(() => normalizeStorefrontCuration(bad))
  assert.deepEqual(curatedRankingEntries(data, 'popular', { boards: { popular: manual(['alpha']) }, extras: [] }).map(entry => entry.id), ['alpha'])
  assert.deepEqual(curatedRankingEntries(data, 'popular', { sourceCommit: 'f'.repeat(40), boards: { popular: manual(['alpha']) }, extras: [] }).map(entry => entry.id), ['alpha'])
})
