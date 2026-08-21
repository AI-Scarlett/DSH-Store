import assert from 'node:assert/strict'
import test from 'node:test'
import { compareCatalogEntries, createDshReleaseContext } from '../src/catalog.mjs'

const entry = (id, latest, updatedAt, overrides = {}) => ({
  id, name: id, status: 'approved', featured: false, installCount: 0, version: '1.0.0',
  compatibility: { dshReleases: { '0.1.1-rc.1': latest } }, source: { updatedAt }, ...overrides,
})

test('trusted ranking is approved then 0.1.1-rc.1 compatibility then source freshness', () => {
  const values = [
    entry('unsupported-new', 'incompatible', '2026-08-20T00:00:00Z'),
    entry('current-old', 'compatible', '2026-08-01T00:00:00Z'),
    entry('current-new', 'compatible', '2026-08-19T00:00:00Z'),
    entry('unknown-new', 'unknown', '2026-08-20T00:00:00Z'),
    entry('blocked-current', 'compatible', '2026-08-20T00:00:00Z', { status: 'blocked' }),
  ]
  assert.deepEqual(values.sort(compareCatalogEntries).map(value => value.id), [
    'current-new', 'current-old', 'unknown-new', 'unsupported-new', 'blocked-current',
  ])
})

test('dynamic latest ranking keeps exact evidence ahead of range-only support', () => {
  const values = [
    entry('range-new', 'compatible', '2026-08-20T00:00:00Z', { compatibility: { dsh: '>=0.1.1-rc.1 <0.2.0', dshReleases: { '0.1.1-rc.1': 'compatible' } } }),
    entry('exact-old', 'compatible', '2026-08-01T00:00:00Z', { compatibility: { dsh: '>=0.1.1-rc.1 <0.2.0', dshReleases: { '0.1.1-rc.2': 'compatible' } } }),
    entry('excluded-newest', 'compatible', '2026-08-21T00:00:00Z', { compatibility: { dsh: '<0.1.1-rc.2', dshReleases: { '0.1.1-rc.1': 'compatible' } } }),
  ]
  const releaseContext = createDshReleaseContext(values, { latestVersion: '0.1.1-rc.2' })
  assert.deepEqual(values.sort((left, right) => compareCatalogEntries(left, right, { releaseContext })).map(value => value.id), [
    'exact-old', 'range-new', 'excluded-newest',
  ])
})
