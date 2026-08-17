import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../install-counter/src/worker.mjs'

function db() {
  const seen = new Set(); const counts = new Map()
  return { prepare(sql) { return { bind(...args) { return { sql, args } }, async all() { return { results: [...counts].map(([plugin_id, count]) => ({ plugin_id, count, updated_at: '2026-08-17T00:00:00Z' })) } } } }, async batch(statements) { const id = statements[0].args[0]; const changed = seen.has(id) ? 0 : 1; if (changed) { seen.add(id); counts.set(statements[0].args[1], (counts.get(statements[0].args[1]) ?? 0) + 1) } return [{ meta: { changes: changed } }, { meta: { changes: changed } }] } }
}

test('worker deduplicates one successful marketplace install receipt', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ entries: [{ id: 'demo', version: '1.0.0', status: 'approved' }] }))
  try {
    const DB = db(); const body = JSON.stringify({ schemaVersion: 1, event: 'install', pluginId: 'demo', version: '1.0.0', receiptId: '00000000-0000-4000-8000-000000000001' })
    const first = await worker.fetch(new Request('https://counter.test/v1/install', { method: 'POST', body, headers: { 'content-type': 'application/json' } }), { DB, CATALOG_URL: 'https://catalog.test' })
    const second = await worker.fetch(new Request('https://counter.test/v1/install', { method: 'POST', body, headers: { 'content-type': 'application/json' } }), { DB, CATALOG_URL: 'https://catalog.test' })
    assert.equal((await first.json()).status, 'recorded'); assert.equal((await second.json()).status, 'duplicate')
    const result = await worker.fetch(new Request('https://counter.test/v1/counts'), { DB })
    assert.deepEqual((await result.json()).counts, { demo: 1 })
  } finally { globalThis.fetch = original }
})
