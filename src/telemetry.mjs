const DEFAULT_TIMEOUT_MS = 3_000

function normalizeEndpoint(value) {
  if (value === null || value === undefined || value === '') return null
  const url = new URL(String(value))
  if (url.protocol !== 'https:') throw new TypeError('telemetryUrl must use HTTPS')
  url.username = ''
  url.password = ''
  return url.href
}

export function createTelemetryClient(options = {}) {
  const endpoint = normalizeEndpoint(options.endpoint)
  const enabled = options.enabled === true && endpoint !== null
  const request = options.fetch ?? globalThis.fetch

  async function recordInstall({ pluginId, version }) {
    if (!enabled) return { status: 'disabled' }
    if (typeof request !== 'function') return { status: 'failed', code: 'FETCH_UNAVAILABLE' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    try {
      const response = await request(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, event: 'install', pluginId, version }),
        signal: controller.signal,
      })
      return response.ok ? { status: 'recorded' } : { status: 'failed', code: `HTTP_${response.status}` }
    } catch (error) {
      return { status: 'failed', code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' }
    } finally {
      clearTimeout(timer)
    }
  }

  return { enabled, recordInstall }
}
