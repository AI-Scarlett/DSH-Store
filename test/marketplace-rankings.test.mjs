import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRankingSnapshot, validateRankingSnapshot, rankingEntries, rankingPage, renderRankingRows } from '../marketplace/rankings/model.js'
const observed = '2026-10-03T05:00:00.000Z'
const item = (id, stars, categories = ['tools'], extra = {}) => ({
  id, name: id, description: `About ${id}`, version: '1.0.0', repositoryUrl: `https://github.com/example/${id}`,
  commit: 'a'.repeat(40), status: 'approved', featured: false, categories, github: { stars }, ...extra,
})
function snapshot(entries, options = {}) {
  const catalog = { registry: { updatedAt: observed, categories: { tools: '工具', memory: '记忆', ui: '界面', empty: '无插件' } }, entries }
  const index = { entries: entries.map((entry, order) => ({ ...entry, nameZh: entry.name, nameEn: entry.id, order })) }
  return validateRankingSnapshot(createRankingSnapshot(catalog, index, { sourceCommit: 'b'.repeat(40), starsObservedAt: observed, ...options }))
}

test('rankings include all Catalog statuses but only approved pinned entries are labelled listed', () => {
  const entries = [item('approved', 20), item('blocked', 999, ['tools'], { status: 'blocked' }), item('hidden', 1000, ['ui'], { status: 'unlisted', featured: true }), item('unpinned', 12, ['tools'], { commit: 'main' })]
  const before = structuredClone(entries)
  const data = snapshot(entries)
  assert.deepEqual(data.entries.map(entry => [entry.id, entry.listingStatus]), [['approved', 'listed'], ['blocked', 'not-listed'], ['hidden', 'not-listed'], ['unpinned', 'not-listed']])
  assert.equal(rankingEntries(data, 'popular')[0].id, 'hidden')
  assert.equal(rankingEntries(data, 'recommended')[0].id, 'hidden')
  assert.deepEqual(entries, before)
})

test('popular sorts numerically, preserves zero, excludes unknown and uses a deterministic ID tie break', () => {
  const data = snapshot([item('b', 10), item('zero', 0), item('c', 100), item('a', 10), item('missing', undefined), item('text', '200'), item('negative', -1), item('fraction', 1.1)])
  assert.deepEqual(rankingEntries(data, 'popular').map(e => [e.id, e.stars]), [['c', 100], ['a', 10], ['b', 10], ['zero', 0]])
  assert.equal(data.entries.find(e => e.id === 'missing').stars, null)
})

test('legacy featured flags do not establish recommendations or outrank observed stars', () => {
  const data = snapshot([item('first-pick', 1, ['tools'], { featured: true }), item('not-featured', 999), item('second-pick', null, ['ui'], { featured: true })])
  assert.deepEqual(rankingEntries(data, 'recommended').map(e => e.id), ['not-featured', 'first-pick'])
  assert.ok(rankingEntries(data, 'recommended').every(e => e.recommendationKind === 'community-stars'))
  const changedFlags = structuredClone(data)
  changedFlags.entries.forEach(e => { e.featured = !e.featured; e.order = 100 - e.order })
  assert.deepEqual(rankingEntries(changedFlags, 'recommended').map(e => e.id), ['not-featured', 'first-pick'])
})

test('featured unlisted records need positive star evidence and blocked or rejected records cannot bypass filtering', () => {
  const data = snapshot([
    item('unlisted-featured', 179, ['tools'], { status: 'unlisted', featured: true }),
    item('zero-featured', 0, ['tools'], { status: 'unlisted', featured: true }),
    item('unknown-featured', null, ['tools'], { featured: true }),
    item('blocked-featured', 999, ['tools'], { status: 'blocked', featured: true }),
  ], { candidates: { entries: [candidate('rejected', { status: 'rejected' })] } })
  data.entries.at(-1).stars = 1000
  const rows = rankingEntries(data, 'recommended')
  assert.deepEqual(rows.map(e => e.id), ['unlisted-featured'])
  for (const locale of ['zh', 'en']) {
    const html = renderRankingRows(rows, { type: 'recommended', locale })
    assert.match(html, locale === 'zh' ? /入榜依据：GitHub 179 星/ : /Basis: 179 GitHub stars/)
    assert.match(html, locale === 'zh' ? /未收录/ : /Not listed/)
    assert.match(html, locale === 'zh' ? /非商城评测推荐/ : /not a Store review/)
    assert.doesNotMatch(html, /商城精选|Store pick|\.\.\/plugins|data-copy-target/)
  }
  // A status change must remove the row, not preserve a former recommendation.
  data.entries[0].reviewStatus = 'blocked'
  assert.equal(rankingEntries(data, 'recommended').length, 0)
})

test('missing, stale or unknown recommendation kinds never fall back to a Store endorsement', () => {
  const entry = snapshot([item('plugin', 1200, ['tools'], { featured: true })]).entries[0]
  for (const variant of [entry, { ...entry, recommendationKind: 'editorial' },
    { ...entry, recommendationKind: '<script>bad()</script>' },
    ...[null, 0, '1200', -1].map(stars => ({ ...entry, stars, recommendationKind: 'community-stars' })),
    { ...entry, reviewStatus: 'blocked', recommendationKind: 'community-stars' }]) {
    for (const locale of ['zh', 'en']) {
      const html = renderRankingRows([variant], { type: 'recommended', locale })
      assert.match(html, locale === 'zh' ? /暂无可核验的推荐依据/ : /Recommendation basis unavailable/)
      assert.doesNotMatch(html, /商城精选|Store pick|<script>|Basis:|入榜依据：/i)
    }
  }
  const rows = rankingEntries(snapshot([item('plugin', 1200)]), 'recommended')
  assert.match(renderRankingRows(rows, { type: 'recommended' }), /GitHub 1,200 星/)
  assert.match(renderRankingRows(rows, { type: 'recommended', locale: 'en' }), /1,200 GitHub stars/)
})

test('must-haves selects each category star leader, collapses duplicate winners, and exposes ties', () => {
  const data = snapshot([item('winner', 100, ['tools', 'memory']), item('runner', 50), item('b', 30, ['ui']), item('a', 30, ['ui'])])
  const winners = rankingEntries(data, 'essential')
  assert.deepEqual(winners.filter(e => e.wins.length).map(e => e.id), ['winner', 'a'])
  assert.deepEqual(winners[0].wins.map(c => c.id), ['tools', 'memory'])
  assert.equal(winners[1].wins[0].tied, true)
  assert.equal(winners[0].wins.some(c => c.id === 'empty'), false)
})

test('incomplete category counters do not manufacture a category champion', () => {
  const data = snapshot([item('known', 9, ['tools']), item('unknown', null, ['tools']), item('ui-known', 0, ['ui'])])
  assert.deepEqual(rankingEntries(data, 'essential').filter(e => e.wins.length).map(e => e.id), ['ui-known'])
  assert.equal(rankingEntries(data, 'popular').length, 2)
})

test('missing collection timestamp cannot misrepresent counters as fresh stars', () => {
  const data = snapshot([item('first', 20, ['tools'], { featured: true })], { starsObservedAt: null })
  assert.equal(data.entries[0].stars, null)
  assert.equal(rankingEntries(data, 'popular').length, 0)
  assert.equal(rankingEntries(data, 'essential').length, 0)
  assert.equal(rankingEntries(data, 'recommended').length, 0)
})

test('rankings paginate by thirty, normalize invalid/out-of-range pages and do not mutate their snapshot', () => {
  const data = snapshot(Array.from({ length: 43 }, (_, i) => item(`item-${i}`, 100 - i)))
  const before = structuredClone(data)
  assert.equal(rankingPage(data, 'popular').entries.length, 30)
  assert.equal(rankingPage(data, 'popular', 2).entries[0].stars, 70)
  assert.equal(rankingPage(data, 'popular', 999).entries.length, 13)
  assert.equal(rankingPage(data, 'popular', NaN).page, 1)
  assert.equal(rankingPage(data, 'popular', -2).page, 1)
  assert.deepEqual(data, before)
  assert.throws(() => rankingEntries(data, 'untrusted'))
})

test('malformed snapshots, duplicate IDs and executable repository links fail closed', () => {
  const data = snapshot([item('plugin', 2)])
  for (const mutate of [d => { d.entries[0].repositoryUrl = 'javascript:alert(1)' }, d => d.entries.push(d.entries[0]), d => { d.entries[0].stars = -1 }, d => { d.entries[0].featured = 'true' }, d => { d.entries[0].categories = ['unknown'] }, d => { d.starsObservedAt = 'not-a-date' }, d => { d.catalogUpdatedAt = null }]) {
    const broken = structuredClone(data); mutate(broken); assert.throws(() => validateRankingSnapshot(broken))
  }
})

test('ranking markup escapes repository metadata, stays read-only, and supports both languages', () => {
  const data = snapshot([item('plugin', 5, ['tools'], { name: '<img src=x onerror=alert(1)>', description: '<script>bad()</script>' })])
  const rows = rankingEntries(data, 'essential')
  const html = renderRankingRows(rows, { type: 'essential', locale: 'zh' })
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|<script|dsh plugin|data-copy-target/)
  assert.match(html, /工具 · 星标第一/)
  assert.match(html, /\.\.\/plugins\/\?q=plugin/)
  assert.match(renderRankingRows(rows, { type: 'essential', locale: 'en' }), /Tools · #1/)
})

test('ranking builder rejects mismatched Catalog index status rather than publishing a stale listing label', () => {
  const entries = [item('plugin', 4)]
  const catalog = { registry: { updatedAt: observed, categories: {} }, entries }
  assert.throws(() => createRankingSnapshot(catalog, { entries: [{ ...entries[0], status: 'unlisted' }] }, { starsObservedAt: observed }), /identity mismatch/)
})

const candidate = (id, extra = {}) => ({ id, name: id, description: 'Discovered project', repositoryUrl: `https://github.com/example/${id}`, status: 'reviewing', topics: ['dsh-plugin', 'tools'], ...extra })

test('candidate-only projects join without a version, featured flag or fabricated admission', () => {
  const candidates = { registry: { updatedAt: observed }, entries: [candidate('external'), candidate('rejected', { status: 'rejected', topics: ['dsh-plugin', 'not-a-category'] })] }
  const before = structuredClone(candidates)
  const data = snapshot([item('listed', 5)], { candidates })
  assert.deepEqual(data.entries.map(e => e.id), ['listed', 'candidate:external', 'candidate:rejected'])
  const external = data.entries[1]
  assert.equal(external.listingStatus, 'not-listed'); assert.equal(external.version, ''); assert.equal(external.featured, false)
  assert.deepEqual(external.categories, ['tools']); assert.deepEqual(data.entries[2].categories, [])
  assert.equal(external.stars, null); assert.deepEqual(candidates, before)
  external.stars = 100
  assert.equal(rankingEntries(data, 'popular')[0].id, external.id)
  assert.equal(rankingEntries(data, 'essential')[0].id, external.id)
  assert.equal(rankingEntries(data, 'recommended').find(e => e.id === external.id).recommendationKind, 'community-stars')
})

test('candidate repository duplicates do not shadow Catalog status; ID collisions stay distinct', () => {
  const data = snapshot([item('plugin', 9, ['tools'], { status: 'blocked' })], { candidates: { entries: [candidate('duplicate', { repositoryUrl: 'https://github.com/Example/Plugin' }), candidate('plugin', { repositoryUrl: 'https://github.com/other/plugin' })] } })
  assert.equal(data.entries.length, 2)
  assert.equal(data.entries[0].listingStatus, 'not-listed')
  assert.equal(data.entries[0].reviewStatus, 'blocked')
  assert.equal(data.entries[1].id, 'candidate:plugin')
})

test('unlisted rows never link to Store details or install actions and both locales show status', () => {
  const data = snapshot([item('blocked', 500, ['tools'], { status: 'blocked' })], { candidates: { entries: [candidate('external')] } })
  for (const locale of ['zh', 'en']) {
    const html = renderRankingRows(data.entries, { locale })
    assert.match(html, locale === 'zh' ? /未收录/ : /Not listed/)
    assert.match(html, locale === 'zh' ? /尚未核验为标准 DSH 插件/ : /compatibility unverified/)
    assert.doesNotMatch(html, /\.\.\/plugins|installCommand|dsh plugin|data-copy-target/)
    assert.match(html, /href="https:\/\/github.com\/example\/external" target="_blank" rel="noopener noreferrer"/)
    assert.doesNotMatch(html, /<small>v<\/small>/)
  }
  const listed = renderRankingRows(snapshot([item('listed', 2)]).entries)
  assert.match(listed, /已收录/); assert.match(listed, /\.\.\/plugins\/\?q=listed/)
})

test('snapshot validation rejects missing or contradictory status and candidate recommendations', () => {
  const data = snapshot([item('listed', 1)], { candidates: { entries: [candidate('external')] } })
  for (const mutate of [d => delete d.entries[0].listingStatus, d => { d.entries[1].listingStatus = 'listed' }, d => { d.entries[1].featured = true }, d => { d.entries[0].reviewStatus = 'rejected' }, d => { d.candidatesUpdatedAt = 'bad' }]) {
    const broken = structuredClone(data); mutate(broken); assert.throws(() => validateRankingSnapshot(broken))
  }
})

test('generic AI discoveries without DSH relevance are not mistaken for plugins', () => {
  const data = snapshot([], { candidates: { entries: [
    candidate('generic-ai', { topics: ['deepseek', 'llm'] }),
    candidate('no-signal', { topics: ['dsh-plugin-candidate'] }),
    candidate('dsh-by-topic', { topics: ['deepseek-harness'] }),
    candidate('dsh-by-description', { topics: [], description: 'A DSH plugin for notes' }),
  ] } })
  assert.deepEqual(data.entries.map(e => e.id), ['candidate:dsh-by-topic', 'candidate:dsh-by-description'])
  assert.ok(data.entries.every(e => e.listingStatus === 'not-listed'))
})

test('all charts show thirty unique rows without granting admission or editorial status', () => {
  const data = snapshot(Array.from({ length: 85 }, (_, i) => item(`entry-${String(i).padStart(2, '0')}`, 1000 - i, [['tools'], ['memory'], ['ui']][i % 3], { status: i < 2 ? 'approved' : 'unlisted', featured: i < 2 })))
  const before = structuredClone(data)
  for (const type of ['popular', 'recommended', 'essential']) {
    const rows = rankingPage(data, type).entries
    assert.equal(rows.length, 30)
    assert.equal(new Set(rows.map(e => e.id)).size, 30)
    const unlisted = rows.filter(e => e.listingStatus === 'not-listed')
    assert.ok(unlisted.length > 0)
    assert.doesNotMatch(renderRankingRows(unlisted, { type }), /\.\.\/plugins|dsh plugin/)
  }
  const recommended = rankingEntries(data, 'recommended')
  assert.equal(recommended.filter(e => e.recommendationKind === 'editorial').length, 0)
  assert.equal(recommended.filter(e => e.recommendationKind === 'community-stars').length, 30)
  assert.match(renderRankingRows(recommended, { type: 'recommended' }), /入榜依据：GitHub 1,000 星/)
  assert.doesNotMatch(renderRankingRows(recommended, { type: 'recommended' }), /商城精选/)
  const supplements = rankingEntries(data, 'essential').filter(e => e.categoryPick)
  assert.equal(supplements.length, 27)
  assert.match(renderRankingRows(supplements, { type: 'essential' }), /分类高星补充/)
  assert.doesNotMatch(renderRankingRows(supplements, { type: 'essential' }), /星标第一/)
  assert.deepEqual(data, before)
})

test('small and incomplete populations stay honest; blocked projects are not auto-recommended', () => {
  const data = snapshot([item('known', 90), item('unknown', null), item('blocked', 900, ['tools'], { status: 'blocked' })])
  assert.equal(rankingEntries(data, 'recommended').length, 1)
  const rows = rankingEntries(data, 'essential')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].wins.length, 0)
  assert.equal(rows[0].categoryPick.observedRank, 2)
})

test('HTML metadata and bilingual chart copy do not advertise unsupported Store picks', async () => {
  const html = await readFile(new URL('../marketplace/rankings/index.html', import.meta.url), 'utf8')
  const client = await readFile(new URL('../marketplace/rankings/rankings.js', import.meta.url), 'utf8')
  for (const source of [html, client]) {
    assert.doesNotMatch(source, /商城精选|Store picks|Editorial picks first|保留人工精选|preserves editorial picks/)
    assert.match(source, /旧的重点展示标记不作为推荐依据/)
  }
  assert.match(client, /automated selection, not a Store review or admission/)
  const version = html.match(/rankings\.js\?v=([\w-]+)/)?.[1]
  assert.ok(version)
  assert.ok(client.includes(`model.js?v=${version}`))
})
