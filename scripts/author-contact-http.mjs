// All notification writers share this client. Never retry a mutation whose
// delivery might already have succeeded; GET retries cannot send a message.
export function githubClient(token, fetcher = fetch) {
  if (typeof token !== 'string' || !token) throw new Error('GITHUB_TOKEN is required')
  const request = async (method, path, body, attempt = 1) => {
    if (!path.startsWith('/')) throw new Error('GitHub API path required')
    const response = await fetcher(`https://api.github.com${path}`, {
      method, headers: {
        accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
        'user-agent': 'dsh-store-contact-policy', 'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    if (method === 'GET' && (response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise(done => setTimeout(done, attempt * 1_000))
      return request(method, path, body, attempt + 1)
    }
    if (!response.ok) throw Object.assign(new Error(`GitHub ${method} failed: HTTP ${response.status}`), { status: response.status })
    return response.status === 204 ? null : response.json()
  }
  const paginate = async path => {
    const records = []
    for (let page = 1; page <= 30; page++) {
      const batch = await request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      if (!Array.isArray(batch)) throw new Error('invalid GitHub page')
      records.push(...batch)
      if (batch.length < 100) return records
    }
    throw new Error('GitHub page bound exceeded; refusing incomplete history')
  }
  return { request, paginate }
}
