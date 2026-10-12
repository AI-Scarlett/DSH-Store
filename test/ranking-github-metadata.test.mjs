import assert from 'node:assert/strict'
import test from 'node:test'
import { enrichRankingSnapshot } from '../scripts/ranking-github-metadata.mjs'

const date = '2026-10-04T03:00:00.000Z'
const entry = id => ({ id, repositoryUrl: `https://github.com/example/${id}`, stars: 999 })
const input = (...ids) => ({ entries: ids.map(entry), starsObservedAt: '2026-01-01T00:00:00Z' })
const response = value => new Response(JSON.stringify(value), { status: 200 })
const options = request => ({ token: 'fixture-only', request, now: () => date, sleep: async () => {} })
const value = (id, stars = 10, extra = {}) => ({ url: `https://github.com/example/${id}`, isPrivate: false, stargazerCount: stars, ...extra })

test('ranking metadata uses bounded read-only batches and deduplicates repository requests', async () => {
  const source = input(...Array.from({ length: 42 }, (_, i) => `item-${i}`))
  source.entries.push({ ...source.entries[0], id: 'second-package' })
  const original = structuredClone(source)
  let calls = 0
  const { snapshot, summary } = await enrichRankingSnapshot(source, options(async (url, init) => {
    calls++
    assert.equal(url, 'https://api.github.com/graphql')
    assert.equal(init.redirect, 'error')
    assert.equal(init.method, 'POST')
    const { query } = JSON.parse(init.body)
    assert.match(query, /^query RankingStars/); assert.doesNotMatch(query, /mutation|manifest|install|build/)
    const matches = [...query.matchAll(/r(\d+): repository\(owner: "example", name: "([^"]+)"\)/g)]
    assert.ok(matches.length <= 40)
    return response({ data: Object.fromEntries(matches.map(([, alias, id]) => [`r${alias}`, value(id, 0)])) })
  }))
  assert.equal(calls, 2); assert.equal(summary.repositories, 42)
  assert.equal(summary.fetched, 42); assert.equal(snapshot.entries.length, 43)
  assert.ok(snapshot.entries.every(e => e.stars === 0)); assert.equal(snapshot.starsObservedAt, date)
  assert.deepEqual(source, original)
})

test('missing, private, renamed, failed and malformed repositories never manufacture counters', async () => {
  const { snapshot } = await enrichRankingSnapshot(input('ok', 'missing', 'private', 'renamed', 'bad-stars', 'error'), options(async () => response({
    data: { r0: value('ok', 0), r1: null, r2: value('private', 4, { isPrivate: true }), r3: value('different', 99), r4: value('bad-stars', '44'), r5: value('error', 7) },
    errors: [{ path: ['r5'], type: 'NOT_FOUND', message: 'untrusted response not logged' }],
  })))
  assert.deepEqual(snapshot.entries.map(e => e.stars), [0, null, null, null, null, null])
})

test('rate or auth rejection stops further batches and preserves explicit unknown values', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0
    const { snapshot, summary } = await enrichRankingSnapshot(input(...Array.from({ length: 100 }, (_, i) => `item-${i}`)), options(async () => { calls++; return new Response('', { status }) }))
    assert.equal(calls, 1); assert.equal(summary.stopped, true)
    assert.equal(snapshot.starsObservedAt, null); assert.ok(snapshot.entries.every(e => e.stars === null))
  }
  let calls = 0
  const result = await enrichRankingSnapshot(input(...Array.from({ length: 50 }, (_, i) => `item-${i}`)), options(async () => { calls++; return response({ errors: [{ type: 'RATE_LIMITED' }] }) }))
  assert.equal(calls, 1); assert.equal(result.summary.stopped, true)
})

test('transient errors retry within a bound; oversized and malformed responses remain unknown', async () => {
  let calls = 0
  const recovered = await enrichRankingSnapshot(input('ok'), options(async () => { calls++; if (calls < 2) throw new Error('private network detail'); return response({ data: { r0: value('ok', 3) } }) }))
  assert.equal(calls, 2); assert.equal(recovered.snapshot.entries[0].stars, 3)
  for (const request of [async () => new Response('x'.repeat(262145)), async () => new Response('{bad'), async () => { throw new Error('network') }]) {
    const result = await enrichRankingSnapshot(input('unknown'), options(request))
    assert.equal(result.summary.requests, 3); assert.equal(result.snapshot.entries[0].stars, null)
    assert.equal(result.snapshot.starsObservedAt, null)
  }
})

test('unsafe URLs and unbounded populations fail before any network request', async () => {
  const opts = options(async () => { throw new Error('must not be requested') })
  await assert.rejects(enrichRankingSnapshot({ entries: [{ repositoryUrl: 'https://github.com/example/repo?token=secret' }] }, opts), /Non-canonical/)
  await assert.rejects(enrichRankingSnapshot({ entries: Array(10001) }, opts), /bound/)
  await assert.rejects(enrichRankingSnapshot(input('ok')), /token/)
})
