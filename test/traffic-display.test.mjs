import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizePublicTrafficSnapshot } from '../marketplace/traffic-model.js'

const generatorPath = new URL('../deploy/generate-public-dsh-store-traffic.py', import.meta.url)

function beijingDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function lastSevenDates(today) {
  const end = new Date(`${today}T00:00:00Z`)
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end)
    day.setUTCDate(end.getUTCDate() - 6 + index)
    return day.toISOString().slice(0, 10)
  })
}

function analyticsFixture({ now = new Date(), stale = false, invalidCount = false } = {}) {
  const generated = new Date(now.getTime() - (stale ? 2 * 60 * 60 * 1000 : 60 * 1000))
  const generatedAt = generated.toISOString()
  const dates = lastSevenDates(beijingDate(generated))
  const daily = Object.fromEntries(dates.map((date, index) => [date, {
    human_pageviews: invalidCount && index === 6 ? -1 : 10 + index,
    human_unique_ips: 3 + index,
    raw_ip_sentinel: '198.51.100.23',
  }]))
  return {
    generated_at: generatedAt,
    window_days: 30,
    reports: {
      'dsh-store-cn': {
        key: 'dsh-store-cn',
        source_generated_at: generatedAt,
        daily,
        visitors: [{ masked_ip: '198.51.100.0/24', private_sentinel: 'do-not-publish' }],
        countries: [{ country: 'private-sentinel' }],
        campaigns: [{ source: 'private-sentinel' }],
      },
      domestic: { private_sentinel: 'not-the-selected-report' },
    },
  }
}

async function inTemporaryDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-traffic-test-'))
  try {
    return await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('traffic model accepts only the fresh seven-day aggregate and hides stale today totals', () => {
  const now = new Date()
  const generatedAt = new Date(now.getTime() - 60_000).toISOString()
  const today = beijingDate(now)
  const days = lastSevenDates(today).map((date, index) => ({ date, pv: index * 11, uv: index * 4 }))
  const value = {
    schemaVersion: 1,
    site: 'dsh-store-cn',
    timeZone: 'Asia/Shanghai',
    generatedAt,
    sourceUpdatedAt: generatedAt,
    fresh: true,
    today: days.at(-1),
    days,
    ignored_private_field: 'never returned',
  }
  const normalized = normalizePublicTrafficSnapshot(value, now)
  assert.ok(normalized)
  assert.equal(normalized.today.pv, 66)
  assert.deepEqual(Object.keys(normalized), ['generatedAt', 'sourceUpdatedAt', 'fresh', 'today', 'days'])
  assert.equal(normalizePublicTrafficSnapshot({ ...value, site: 'overview' }, now), null)
  assert.equal(normalizePublicTrafficSnapshot({ ...value, days: days.slice(1) }, now), null)

  const stale = normalizePublicTrafficSnapshot({ ...value, fresh: false }, now)
  assert.ok(stale)
  assert.equal(stale.today, null)
  assert.equal(stale.days.length, 7)
})

test('public snapshot generator emits only seven PV/UV rows and excludes visitor/detail fields', async () => {
  await inTemporaryDirectory(async directory => {
    const input = join(directory, 'source.json')
    const output = join(directory, 'public.json')
    await writeFile(input, JSON.stringify(analyticsFixture()), 'utf8')
    const result = spawnSync('python3', [generatorPath.pathname, '--input', input, '--output', output], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const snapshot = JSON.parse(await readFile(output, 'utf8'))
    assert.deepEqual(Object.keys(snapshot), ['schemaVersion', 'site', 'timeZone', 'generatedAt', 'sourceUpdatedAt', 'fresh', 'today', 'days'])
    assert.equal(snapshot.schemaVersion, 1)
    assert.equal(snapshot.site, 'dsh-store-cn')
    assert.equal(snapshot.fresh, true)
    assert.equal(snapshot.days.length, 7)
    assert.deepEqual(Object.keys(snapshot.days[0]), ['date', 'pv', 'uv'])
    assert.equal(snapshot.today.pv, 16)
    assert.equal(snapshot.today.uv, 9)
    const encoded = JSON.stringify(snapshot)
    assert.doesNotMatch(encoded, /198\.51\.100|private-sentinel|do-not-publish|visitors|campaigns|countries/)
  })
})

test('stale source is marked stale; malformed metrics leave the prior public snapshot intact', async () => {
  await inTemporaryDirectory(async directory => {
    const input = join(directory, 'source.json')
    const output = join(directory, 'public.json')
    await writeFile(input, JSON.stringify(analyticsFixture({ stale: true })), 'utf8')
    const staleResult = spawnSync('python3', [generatorPath.pathname, '--input', input, '--output', output], { encoding: 'utf8' })
    assert.equal(staleResult.status, 0, staleResult.stderr)
    assert.equal(JSON.parse(await readFile(output, 'utf8')).fresh, false)

    const prior = await readFile(output, 'utf8')
    await writeFile(input, JSON.stringify(analyticsFixture({ invalidCount: true })), 'utf8')
    const invalidResult = spawnSync('python3', [generatorPath.pathname, '--input', input, '--output', output], { encoding: 'utf8' })
    assert.equal(invalidResult.status, 1)
    assert.equal(await readFile(output, 'utf8'), prior)
  })
})
