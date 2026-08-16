import assert from 'node:assert/strict'
import test from 'node:test'
import { createTelemetryClient } from '../src/telemetry.mjs'

test('install telemetry is opt-in and sends no device or profile identifier', async () => {
  let request = null
  const disabled = createTelemetryClient({ endpoint: 'https://example.test/install', fetch: async () => new Response(null, { status: 204 }) })
  assert.deepEqual(await disabled.recordInstall({ pluginId: 'demo', version: '1.0.0' }), { status: 'disabled' })

  const enabled = createTelemetryClient({
    endpoint: 'https://example.test/install', enabled: true,
    fetch: async (url, options) => { request = { url, options }; return new Response(null, { status: 204 }) },
  })
  assert.deepEqual(await enabled.recordInstall({ pluginId: 'demo', version: '1.0.0' }), { status: 'recorded' })
  assert.deepEqual(JSON.parse(request.options.body), { schemaVersion: 1, event: 'install', pluginId: 'demo', version: '1.0.0' })
  assert.equal(request.options.body.includes('profile'), false)
  assert.equal(request.options.body.includes('machine'), false)
})
