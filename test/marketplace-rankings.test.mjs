import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { POPULAR_LIMIT, applyRankingRefreshState, createRankingSnapshot, validateRankingSnapshot, rankingEntries, rankingPage, renderRankingRows } from '../marketplace/rankings/model.js'
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

test('new ranking snapshots omit unused Catalog presentation fields while legacy snapshots remain valid', () => {
  const data = snapshot([item('first', 20, ['tools'], { featured: true }), item('second', 10)])
  assert.ok(data.entries.every(entry => !Object.hasOwn(entry, 'featured') && !Object.hasOwn(entry, 'order')))

  const legacy = structuredClone(data)
  legacy.entries.forEach((entry, index) => { entry.featured = index === 0; entry.order = index })
  assert.equal(validateRankingSnapshot(legacy).entries.length, 2)
  assert.deepEqual(rankingEntries(legacy, 'recommended').map(entry => entry.id), ['first', 'second'])
})

test('popular sorts numerically, preserves zero, excludes unknown and uses a deterministic ID tie break', () => {
  const data = snapshot([item('b', 10), item('zero', 0), item('c', 100), item('a', 10), item('missing', undefined), item('text', '200'), item('negative', -1), item('fraction', 1.1)])
  assert.deepEqual(rankingEntries(data, 'popular').map(e => [e.id, e.stars]), [['c', 100], ['a', 10], ['b', 10], ['zero', 0]])
  assert.equal(data.entries.find(e => e.id === 'missing').stars, null)
})

test('popular is capped at 100 entries while preserving thirty-row pagination', () => {
  const data = snapshot(Array.from({ length: 137 }, (_, i) => item(`entry-${String(i).padStart(3, '0')}`, 1000 - i)))
  assert.equal(rankingEntries(data, 'popular').length, POPULAR_LIMIT)
  assert.equal(rankingPage(data, 'popular').entries.length, 30)
  assert.equal(rankingPage(data, 'popular', 4).entries.length, 10)
  assert.equal(rankingPage(data, 'popular', 4).total, 100)
})

test('daily refresh and routine builds preserve weekly chart scores until weekly refresh', () => {
  const previous = snapshot([item('alpha', 10), item('beta', 5)])
  const current = snapshot([item('alpha', 40), item('beta', 2), item('new-plugin', 25)], { starsObservedAt: '2026-10-04T05:00:00.000Z' })

  const daily = applyRankingRefreshState(current, previous, 'daily')
  assert.deepEqual(rankingEntries(daily, 'popular').map(entry => [entry.id, entry.stars]), [['alpha', 40], ['new-plugin', 25], ['beta', 2]])
  assert.deepEqual(rankingEntries(daily, 'recommended').map(entry => [entry.id, entry.stars]), [['alpha', 10], ['beta', 5]])
  assert.equal(rankingEntries(daily, 'essential')[0].id, 'alpha', 'new projects must not disrupt weekly category leaders')
  assert.equal(daily.weeklyStarsObservedAt, previous.weeklyStarsObservedAt)
  assert.equal(daily.entries.find(entry => entry.id === 'new-plugin').weeklyStars, null)

  const rebuilt = applyRankingRefreshState(current, daily, 'reuse')
  assert.deepEqual(rebuilt.entries.map(entry => [entry.id, entry.stars, entry.weeklyStars]), daily.entries.map(entry => [entry.id, entry.stars, entry.weeklyStars]))
  assert.equal(rebuilt.starsObservedAt, daily.starsObservedAt)

  const nextDay = snapshot([item('alpha', 60), item('beta', 1), item('new-plugin', 30)], { starsObservedAt: '2026-10-05T05:00:00.000Z' })
  const nextDaily = applyRankingRefreshState(nextDay, daily, 'daily')
  assert.equal(nextDaily.entries.find(entry => entry.id === 'new-plugin').weeklyStars, null)
  assert.equal(nextDaily.entries.find(entry => entry.id === 'new-plugin').weeklySnapshotMember, false)
  assert.equal(rankingEntries(nextDaily, 'essential')[0].id, 'alpha')

  const weekly = applyRankingRefreshState(current, daily, 'weekly')
  assert.deepEqual(rankingEntries(weekly, 'recommended').map(entry => [entry.id, entry.stars]), [['alpha', 40], ['new-plugin', 25], ['beta', 2]])
  assert.equal(weekly.weeklyStarsObservedAt, current.starsObservedAt)
})

test('weekly refresh seeds the first baseline and legacy snapshot schemas migrate without losing scores', () => {
  const initial = snapshot([item('alpha', 8), item('beta', 0)])
  const baseline = applyRankingRefreshState(initial, null, 'weekly')
  assert.equal(baseline.weeklyStarsObservedAt, initial.starsObservedAt)
  assert.deepEqual(baseline.entries.map(entry => entry.weeklyStars), [8, 0])

  const legacy = structuredClone(initial)
  legacy.schemaVersion = 2
  delete legacy.weeklyStarsObservedAt
  legacy.entries.forEach(entry => { delete entry.weeklyStars })
  const migrated = validateRankingSnapshot(legacy)
  assert.equal(migrated.schemaVersion, 4)
  assert.equal(migrated.weeklyStarsObservedAt, legacy.starsObservedAt)
  assert.deepEqual(migrated.entries.map(entry => entry.weeklyStars), [8, 0])
  assert.ok(migrated.entries.every(entry => typeof entry.listingReason === 'string' || entry.listingStatus === 'listed'))

  const schema3 = structuredClone(initial)
  schema3.schemaVersion = 3
  schema3.entries.forEach(entry => { delete entry.listingReason })
  const migrated3 = validateRankingSnapshot(schema3)
  assert.equal(migrated3.schemaVersion, 4)
  assert.equal(migrated3.entries[0].listingReason, null)
})

test('listed chart ranks only approved full-Commit entries by daily GitHub stars and stops at 30', () => {
  const data = snapshot([
    item('unlisted-hot', 10000, ['tools'], { status: 'unlisted', statusReason: 'not reviewed' }),
    item('blocked-hot', 9000, ['tools'], { status: 'blocked', statusReason: 'blocked by policy' }),
    ...Array.from({ length: 35 }, (_, i) => item(`listed-${String(i).padStart(2, '0')}`, 100 - i)),
    item('listed-unknown', null),
    item('approved-unpinned', 200, ['tools'], { commit: 'main' }),
  ])
  const rows = rankingEntries(data, 'listed')
  assert.equal(rows.length, 30)
  assert.deepEqual(rows.slice(0, 3).map(entry => [entry.id, entry.stars]), [['listed-00', 100], ['listed-01', 99], ['listed-02', 98]])
  assert.ok(rows.every(entry => entry.listingStatus === 'listed'))
  assert.ok(!rows.some(entry => ['unlisted-hot', 'blocked-hot', 'approved-unpinned', 'listed-unknown'].includes(entry.id)))
  assert.equal(rankingPage(data, 'listed').total, 30)
  assert.equal(rankingPage(data, 'listed', 2).page, 1)
})

test('legacy featured flags do not establish recommendations or outrank observed stars', () => {
  const data = snapshot([item('first-pick', 1, ['tools'], { featured: true }), item('not-featured', 999), item('second-pick', null, ['ui'], { featured: true })])
  assert.deepEqual(rankingEntries(data, 'recommended').map(e => e.id), ['not-featured', 'first-pick'])
  assert.ok(rankingEntries(data, 'recommended').every(e => e.recommendationKind === 'community-stars'))
  const changedFlags = structuredClone(data)
  changedFlags.entries.forEach(e => { e.featured = !e.featured; e.order = 100 - e.order })
  assert.deepEqual(rankingEntries(changedFlags, 'recommended').map(e => e.id), ['not-featured', 'first-pick'])
})

test('official DSH tools occupy distinct weekly-random top-ten slots in both charts without changing listing status', () => {
  const entries = [
    item('dsh-safe-plugin-manager', 3, ['marketplace', 'management'], {
      repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store',
    }),
    item('build-dsh-plugin', null, ['development', 'workflow', 'tools'], {
      repositoryUrl: 'https://github.com/AI-Scarlett/build-dsh-plugin', status: 'unlisted',
      statusReason: 'Held for the latest-three compatibility review.',
    }),
    ...Array.from({ length: 45 }, (_, index) => item(`ranked-${String(index).padStart(2, '0')}`, 500 - index, ['tools'])),
    item('lookalike', 9000, ['tools'], { repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store-fork' }),
  ]
  const data = snapshot(entries)
  const original = structuredClone(data)
  const officialRepos = [
    'https://github.com/AI-Scarlett/DSH-Store',
    'https://github.com/AI-Scarlett/build-dsh-plugin',
  ]
  for (const type of ['recommended', 'essential']) {
    const rows = rankingEntries(data, type)
    assert.equal(rows.length, 30)
    assert.equal(new Set(rows.map(entry => entry.id)).size, rows.length)
    const selected = officialRepos.map(repositoryUrl => {
      const matches = rows.map((entry, index) => ({ entry, rank: index + 1 }))
        .filter(({ entry }) => entry.repositoryUrl === repositoryUrl)
      assert.equal(matches.length, 1, `${type} should include ${repositoryUrl} exactly once`)
      assert.ok(matches[0].rank <= 10, `${type} should place official tools in the top ten`)
      assert.equal(matches[0].entry.officialToolPick, true)
      return matches[0]
    })
    assert.notEqual(selected[0].rank, selected[1].rank, 'official placements must be distinct')
    assert.equal(selected[0].entry.listingStatus, 'listed')
    assert.equal(selected[1].entry.listingStatus, 'not-listed')
    assert.equal(selected[1].entry.stars, null, 'weekly charts must not substitute a newer daily star count')
    const html = renderRankingRows(rows, { type, locale: 'zh' })
    const english = renderRankingRows(rows, { type, locale: 'en' })
    assert.match(html, /DSH 官方工具展示位 · 周榜随机置入前十/)
    assert.match(english, /Official DSH tool · randomized weekly top-10 placement/)
    assert.match(html, /未收录原因：<\/strong>Held for the latest-three compatibility review\./)
    assert.equal(rows.find(entry => entry.id === 'lookalike').officialToolPick, undefined,
      'a repository whose name merely contains DSH-Store must not receive an official slot')
  }

  const stable = Object.fromEntries(['recommended', 'essential'].map(type => [type, rankingEntries(data, type).map(entry => entry.id)]))
  assert.deepEqual(Object.fromEntries(['recommended', 'essential'].map(type => [type, rankingEntries(data, type).map(entry => entry.id)])), stable,
    'a repeated build from the same weekly snapshot must not reshuffle rows')
  const today = snapshot(entries.map(entry => ({
    ...entry,
    github: { stars: entry.github.stars === null ? 80 : entry.github.stars + 100 },
  })), { starsObservedAt: '2026-10-04T05:00:00.000Z' })
  const dailyRefresh = applyRankingRefreshState(today, data, 'daily')
  for (const type of ['recommended', 'essential']) {
    const beforeRows = rankingEntries(data, type)
    const beforeRanks = beforeRows.map((entry, index) => entry.officialToolPick ? [entry.id, index] : null).filter(Boolean)
    const afterRows = rankingEntries(dailyRefresh, type)
    assert.deepEqual(afterRows.map((entry, index) => entry.officialToolPick ? [entry.id, index] : null).filter(Boolean), beforeRanks,
      'daily star refreshes must not rotate weekly official placements')
  }
  const weeklyArrangements = new Set(['2026-10-03T05:00:00.000Z', '2026-10-10T05:00:00.000Z', '2026-10-17T05:00:00.000Z', '2026-10-24T05:00:00.000Z'].map(date => {
    const nextWeek = { ...data, weeklyStarsObservedAt: date }
    return ['recommended', 'essential'].map(type => {
      const rows = rankingEntries(nextWeek, type)
      return `${type}:${rows.map((entry, index) => entry.officialToolPick ? `${entry.id}@${index + 1}` : null).filter(Boolean).join(',')}`
    }).join('|')
  }))
  assert.ok(weeklyArrangements.size > 1, 'weekly snapshots should rotate the official placements')
  assert.deepEqual(data, original, 'ranking generation must not mutate the snapshot')

  const blocked = structuredClone(data)
  blocked.entries.find(entry => entry.id === 'build-dsh-plugin').reviewStatus = 'blocked'
  assert.equal(rankingEntries(blocked, 'recommended').some(entry => entry.id === 'build-dsh-plugin'), false)
  assert.equal(rankingEntries(blocked, 'essential').some(entry => entry.id === 'build-dsh-plugin'), false)
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
  for (const mutate of [d => { d.entries[0].repositoryUrl = 'javascript:alert(1)' }, d => d.entries.push(d.entries[0]), d => { d.entries[0].stars = -1 }, d => { d.entries[0].featured = 'true' }, d => { d.entries[0].categories = ['unknown'] }, d => { d.entries[0].listingReason = 'x'.repeat(601) }, d => { d.starsObservedAt = 'not-a-date' }, d => { d.catalogUpdatedAt = null }]) {
    const broken = structuredClone(data); mutate(broken); assert.throws(() => validateRankingSnapshot(broken))
  }
})

test('ranking markup escapes repository metadata, stays read-only, and supports both languages', () => {
  const data = snapshot([
    item('plugin', 5, ['tools'], { name: '<img src=x onerror=alert(1)>', description: '<script>bad()</script>' }),
    item('blocked', 4, ['tools'], { status: 'blocked', statusReason: '<script>bad()</script>' }),
  ])
  const html = renderRankingRows(data.entries, { type: 'popular', locale: 'zh' })
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|<script|dsh plugin|data-copy-target/)
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/)
  assert.match(html, /GitHub Stars/)
  assert.match(html, /\.\.\/plugins\/\?q=plugin/)
  assert.match(renderRankingRows([data.entries[0]], { type: 'popular', locale: 'en' }), /GitHub Stars/)
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
  assert.equal(external.listingStatus, 'not-listed'); assert.equal(external.version, ''); assert.equal(Object.hasOwn(external, 'featured'), false)
  assert.deepEqual(external.categories, ['tools']); assert.deepEqual(data.entries[2].categories, [])
  assert.equal(external.stars, null); assert.deepEqual(candidates, before)
  external.stars = 100
  external.weeklyStars = 100
  external.weeklySnapshotMember = true
  external.weeklyCategories = [...external.categories]
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
  const data = snapshot([item('blocked', 500, ['tools'], { status: 'blocked', statusReason: 'Automatic policy blocked installation: review runtime permissions.' })], { candidates: { entries: [candidate('external', { statusReason: 'Fixed-Commit review is pending.' })] } })
  for (const locale of ['zh', 'en']) {
    const html = renderRankingRows(data.entries, { locale })
    assert.match(html, locale === 'zh' ? /未收录/ : /Not listed/)
    assert.match(html, locale === 'zh' ? /未收录原因：/ : /Not listed because:/)
    assert.match(html, /Fixed-Commit review is pending\./)
    assert.match(html, /Automatic policy blocked installation: review runtime permissions\./)
    assert.match(html, locale === 'zh' ? /尚未核验为标准 DSH 插件/ : /compatibility unverified/)
    assert.doesNotMatch(html, /\.\.\/plugins|installCommand|dsh plugin|data-copy-target/)
    assert.match(html, /href="https:\/\/github.com\/example\/external" target="_blank" rel="noopener noreferrer"/)
    assert.doesNotMatch(html, /<small>v<\/small>/)
  }
  const listed = renderRankingRows(snapshot([item('listed', 2)]).entries)
  assert.match(listed, /已收录/); assert.match(listed, /\.\.\/plugins\/\?q=listed/)
  assert.doesNotMatch(listed, /未收录原因：|Not listed because:/)
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
    assert.match(renderRankingRows(unlisted, { type }), /未收录原因：/)
    assert.doesNotMatch(renderRankingRows(unlisted, { type }), /\.\.\/plugins|dsh plugin/)
  }
  assert.equal(rankingEntries(data, 'listed').length, 2)
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
  assert.equal(rows[0].categoryPick.observedRank, 1)
})

test('HTML metadata and bilingual chart copy do not advertise unsupported Store picks', async () => {
  const html = await readFile(new URL('../marketplace/rankings/index.html', import.meta.url), 'utf8')
  const client = await readFile(new URL('../marketplace/rankings/rankings.js', import.meta.url), 'utf8')
  const model = await readFile(new URL('../marketplace/rankings/model.js', import.meta.url), 'utf8')
  for (const source of [html, client]) {
    assert.doesNotMatch(source, /商城精选|Store picks|Editorial picks first|保留人工精选|preserves editorial picks/)
    assert.match(source, /旧的重点展示标记不作为(?:推荐)?依据/)
  }
  assert.match(client, /clearly labelled official-tool slots are display placements, not star ranks or Store reviews/)
  assert.match(client, /DSH Store 与 DSH 插件开发放入前十随机位置/)
  assert.match(model, /DSH 官方工具展示位 · 周榜随机置入前十/)
  assert.match(client, /Daily · Top 100/)
  assert.match(client, /tab\.listed/)
  assert.match(client, /Updated weekly/)
  assert.match(client, /常规网站构建不会刷新榜单分数/)
  assert.match(client, /weeklyStarsObservedAt/)
  const version = html.match(/rankings\.js\?v=([\w-]+)/)?.[1]
  assert.ok(version)
  assert.ok(client.includes(`model.js?v=${version}`))
})
