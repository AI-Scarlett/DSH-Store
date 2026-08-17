const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': 'https://ai-scarlett.github.io', ...extra } })

async function catalogEntry(env, pluginId, version) {
  const response = await fetch(env.CATALOG_URL, { cf: { cacheTtl: 300, cacheEverything: true } })
  if (!response.ok) return false
  const catalog = await response.json()
  return catalog.entries?.some(entry => entry.id === pluginId && entry.version === version && entry.status === 'approved') === true
}

async function record(request, env) {
  let body
  try { body = await request.json() } catch { return json({ error: 'invalid-json' }, 400) }
  if (body?.schemaVersion !== 1 || body.event !== 'install' || !ID.test(body.pluginId ?? '') || !VERSION.test(body.version ?? '') || !UUID.test(body.receiptId ?? '')) return json({ error: 'invalid-receipt' }, 400)
  if (!await catalogEntry(env, body.pluginId, body.version)) return json({ error: 'catalog-mismatch' }, 409)
  const now = new Date().toISOString()
  const results = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO install_receipts (receipt_id, plugin_id, version, installed_at) VALUES (?, ?, ?, ?)').bind(body.receiptId, body.pluginId, body.version, now),
    env.DB.prepare('INSERT INTO install_counts (plugin_id, count, updated_at) SELECT ?, 1, ? WHERE changes() = 1 ON CONFLICT(plugin_id) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at').bind(body.pluginId, now),
  ])
  return json({ status: results[0]?.meta?.changes === 1 ? 'recorded' : 'duplicate' }, 202)
}

async function counts(env) {
  const result = await env.DB.prepare('SELECT plugin_id, count, updated_at FROM install_counts ORDER BY plugin_id').all()
  const rows = result.results ?? []
  return json({ schemaVersion: 1, updatedAt: rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, null), counts: Object.fromEntries(rows.map(row => [row.plugin_id, row.count])) }, 200, { 'cache-control': 'public, max-age=60' })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': 'https://ai-scarlett.github.io', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' } })
    if (request.method === 'GET' && url.pathname === '/v1/counts') return counts(env)
    if (request.method === 'POST' && url.pathname === '/v1/install') return record(request, env)
    if (request.method === 'GET' && url.pathname === '/health') return json({ status: 'ok' })
    return json({ error: 'not-found' }, 404)
  },
}
