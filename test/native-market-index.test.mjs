import assert from 'node:assert/strict'
import test from 'node:test'
import { createNativeMarketIndex, validateNativeMarketIndex } from '../src/native-market-index.mjs'

const entry = overrides => ({
  id: 'demo', status: 'approved', packageName: 'dsh-demo', version: '1.0.0', name: 'Demo', description: 'Fixture',
  repositoryUrl: 'https://github.com/example/dsh-demo', commit: 'a'.repeat(40), manifestPath: 'package.json',
  source: { updatedAt: '2026-10-15T00:00:00Z', provenance: 'github-commit' },
  compatibility: { dsh: '*', dshReleases: { 'rc.8': 'compatible', '0.2.1-alpha.4': 'unknown' } }, ...overrides,
})

test('native market only exposes approved immutable entries and exact compatible releases', () => {
  const catalog = { entries: [entry(), entry({ status: 'blocked' }), entry({ status: 'unlisted' })] }
  const value = createNativeMarketIndex(catalog)
  assert.equal(value.format, 1)
  assert.equal(value.plugins.length, 1)
  assert.equal(value.plugins[0].versions[0].engines.dsh, '0.1.0-rc.8')
  assert.equal(value.plugins[0].versions[0].source.commit, 'a'.repeat(40))
  assert.equal(value.plugins[0].versions[0].publishTimestamp, 1792022400)
  assert.equal(validateNativeMarketIndex(value, catalog), value)
  value.plugins[0].versions[0].engines.dsh = '*'
  assert.throws(() => validateNativeMarketIndex(value, catalog), /differs/)
})

test('native market excludes unknown-only declarations and preserves safe monorepo paths', () => {
  assert.equal(createNativeMarketIndex({ entries: [entry({ compatibility: { dshReleases: {} } })] }).plugins.length, 0)
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
