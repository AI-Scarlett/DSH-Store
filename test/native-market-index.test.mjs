import assert from 'node:assert/strict'
import test from 'node:test'
import { createNativeMarketIndex, validateNativeMarketIndex } from '../src/native-market-index.mjs'

const entry = overrides => ({
  id: 'demo', status: 'approved', packageName: 'dsh-demo', version: '1.0.0', name: 'Demo', description: 'Fixture',
  repositoryUrl: 'https://github.com/example/dsh-demo', commit: 'a'.repeat(40), manifestPath: 'package.json',
  source: { updatedAt: '2026-10-15T00:00:00Z', provenance: 'github-commit' },
  compatibility: { dsh: '*', dshReleases: { 'rc.8': 'compatible', '0.2.1-alpha.4': 'unknown' } }, ...overrides,
})

test('native market only exposes approved immutable entries and leaves compatibility checks to DSH', () => {
  const catalog = { entries: [entry(), entry({ status: 'blocked' }), entry({ status: 'unlisted' })] }
  const value = createNativeMarketIndex(catalog)
  assert.equal(value.format, 1)
  assert.equal(value.plugins.length, 1)
  assert.equal(value.plugins[0].versions[0].engines, undefined)
  assert.deepEqual(value.plugins[0].metadata.labels, ['dsh-install-check', 'store-compatibility-review'])
  assert.match(value.description.zh, /最终由 DSH 检查/)
  assert.equal(value.plugins[0].versions[0].source.commit, 'a'.repeat(40))
  assert.equal(value.plugins[0].versions[0].publishTimestamp, 1792022400)
  assert.equal(validateNativeMarketIndex(value, catalog), value)
  value.plugins[0].versions[0].source.commit = 'b'.repeat(40)
  assert.throws(() => validateNativeMarketIndex(value, catalog), /differs/)
})

test('native market includes unknown-only declarations with a review label and preserves safe monorepo paths', () => {
  const unknown = createNativeMarketIndex({ entries: [entry({ compatibility: {
    dshReleases: {}, latestWindow: { state: 'recheck-required', releases: ['0.2.2-alpha.2'] },
  } })] })
  assert.equal(unknown.plugins.length, 1)
  assert.deepEqual(unknown.plugins[0].metadata.labels, ['dsh-install-check', 'store-compatibility-review'])
  const current = createNativeMarketIndex({ entries: [entry({ compatibility: {
    dshReleases: { '0.2.2-alpha.2': 'compatible' },
    latestWindow: { state: 'current', releases: ['0.2.2-alpha.2'] },
  } })] })
  assert.deepEqual(current.plugins[0].metadata.labels, ['dsh-install-check'])
  const value = createNativeMarketIndex({ entries: [entry({ installPath: 'packages/demo', manifestPath: 'packages/demo/package.json' })] })
  assert.equal(value.plugins[0].versions[0].source.path, 'packages/demo')
  assert.equal(value.plugins[0].repository.directory, 'packages/demo')
})

test('native market fails closed on changed identity, unsafe paths, floating sources and unknown timestamps', () => {
  for (const changes of [{ commit: 'main' }, { source: {} }, { installPath: '../demo' }, { packageName: 'DEMO' }, { manifestPath: 'other.json' }]) {
    assert.throws(() => createNativeMarketIndex({ entries: [entry(changes)] }))
  }
  assert.throws(() => createNativeMarketIndex({ entries: [entry(), entry()] }), /duplicated/)
})
