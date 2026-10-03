import assert from 'node:assert/strict'
import test from 'node:test'
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

test('rankings only include approved pinned Catalog entries and do not mutate input', () => {
  const entries = [item('approved', 20), item('candidate', 999, ['tools'], { status: 'candidate' }), item('hidden', 1000, ['ui'], { status: 'unlisted', featured: true }), item('unpinned', 12, ['tools'], { commit: 'main' })]
  const before = structuredClone(entries)
  const data = snapshot(entries)
  assert.deepEqual(data.entries.map(entry => entry.id), ['approved'])
  assert.deepEqual(entries, before)
})

test('popular sorts numerically, preserves zero, excludes unknown and uses a deterministic ID tie break', () => {
  const data = snapshot([item('b', 10), item('zero', 0), item('c', 100), item('a', 10), item('missing', undefined), item('text', '200'), item('negative', -1), item('fraction', 1.1)])
  assert.deepEqual(rankingEntries(data, 'popular').map(e => [e.id, e.stars]), [['c', 100], ['a', 10], ['b', 10], ['zero', 0]])
  assert.equal(data.entries.find(e => e.id === 'missing').stars, null)
})

test('recommendations use featured flag and Catalog order, not star count', () => {
  const data = snapshot([item('first-pick', 1, ['tools'], { featured: true }), item('not-featured', 999), item('second-pick', null, ['ui'], { featured: true })])
  assert.deepEqual(rankingEntries(data, 'recommended').map(e => e.id), ['first-pick', 'second-pick'])
})

test('must-haves selects each category star leader, collapses duplicate winners, and exposes ties', () => {
  const data = snapshot([item('winner', 100, ['tools', 'memory']), item('runner', 50), item('b', 30, ['ui']), item('a', 30, ['ui'])])
  const winners = rankingEntries(data, 'essential')
  assert.deepEqual(winners.map(e => e.id), ['winner', 'a'])
  assert.deepEqual(winners[0].wins.map(c => c.id), ['tools', 'memory'])
  assert.equal(winners[1].wins[0].tied, true)
  assert.equal(winners[0].wins.some(c => c.id === 'empty'), false)
})

test('incomplete category counters do not manufacture a category champion', () => {
  const data = snapshot([item('known', 9, ['tools']), item('unknown', null, ['tools']), item('ui-known', 0, ['ui'])])
  assert.deepEqual(rankingEntries(data, 'essential').map(e => e.id), ['ui-known'])
  assert.equal(rankingEntries(data, 'popular').length, 2)
})

test('missing collection timestamp cannot misrepresent counters as fresh stars', () => {
  const data = snapshot([item('first', 20, ['tools'], { featured: true })], { starsObservedAt: null })
  assert.equal(data.entries[0].stars, null)
  assert.equal(rankingEntries(data, 'popular').length, 0)
  assert.equal(rankingEntries(data, 'essential').length, 0)
  assert.equal(rankingEntries(data, 'recommended').length, 1)
})

test('rankings paginate by twenty, normalize invalid/out-of-range pages and do not mutate their snapshot', () => {
  const data = snapshot(Array.from({ length: 43 }, (_, i) => item(`item-${i}`, 100 - i)))
  const before = structuredClone(data)
  assert.equal(rankingPage(data, 'popular').entries.length, 20)
  assert.equal(rankingPage(data, 'popular', 2).entries[0].stars, 80)
  assert.equal(rankingPage(data, 'popular', 999).entries.length, 3)
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

test('ranking builder rejects mismatched index identity instead of ranking stale approval', () => {
  const entries = [item('plugin', 4)]
  const catalog = { registry: { updatedAt: observed, categories: {} }, entries }
  assert.throws(() => createRankingSnapshot(catalog, { entries: [{ ...entries[0], status: 'unlisted' }] }, { starsObservedAt: observed }), /identity mismatch/)
})
