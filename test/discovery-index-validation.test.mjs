import assert from 'node:assert/strict'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { validateDiscoveryIndexSnapshot } from '../src/discovery-index-validation.mjs'

function snapshot() {
  return {
    schemaVersion: 1,
    source: {
      name: 'dsh.so public discovery index',
      url: 'https://www.dsh.so/plugins-index.json',
      generatedAt: '2026-10-13T00:19:35.310Z',
      recordCount: 1,
      license: { spdx: 'CC-BY-4.0', attribution: 'dsh.so — DSH Developer Hub (https://www.dsh.so)' },
    },
    entries: [{
      sourceIndex: 0, sourceId: 'plugin-one', alias: '@example/plugin-one', name: 'Plugin One',
      description: 'A bounded description.', stars: 12, categories: ['developer-tools'], kind: 'dsh-plugin',
      repositoryUrl: 'https://github.com/example/plugin-one', detailUrl: 'https://www.dsh.so/artifact/plugin-one/',
    }],
  }
}

function encoded(value = snapshot()) {
  const raw = Buffer.from(`${JSON.stringify(value)}\n`)
  return { raw, gzip: gzipSync(raw) }
}

test('validates the discovery snapshot schema and exact gzip transport copy', () => {
  const { raw, gzip } = encoded()
  assert.deepEqual(validateDiscoveryIndexSnapshot(raw, gzip), {
    recordCount: 1, rawBytes: raw.length, gzipBytes: gzip.length,
  })
})

test('rejects malformed index metadata, rows and unsafe source URLs', () => {
  for (const mutate of [
    value => { value.source.recordCount = 2 },
    value => { value.entries[0].sourceIndex = 1 },
    value => { value.entries[0].repositoryUrl = 'https://example.com/evil/plugin' },
    value => { value.entries[0].detailUrl = 'https://attacker.invalid/artifact/plugin-one/' },
    value => { value.entries[0].categories = ['../outside'] },
    value => { value.entries[0].unexpected = true },
  ]) {
    const value = snapshot()
    mutate(value)
    const { raw, gzip } = encoded(value)
    assert.throws(() => validateDiscoveryIndexSnapshot(raw, gzip))
  }
})

test('rejects corrupted gzip and a gzip copy for different JSON bytes', () => {
  const { raw, gzip } = encoded()
  assert.throws(() => validateDiscoveryIndexSnapshot(raw, Buffer.from('not gzip')), /gzip/)
  const other = Buffer.from(`${JSON.stringify(snapshot())} `)
  assert.throws(() => validateDiscoveryIndexSnapshot(raw, gzipSync(other)), /does not exactly match/)
})
