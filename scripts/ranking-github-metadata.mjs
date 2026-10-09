// Read-only, bounded GraphQL batches keep discovery rankings below REST request quotas.
// This module never loads a manifest, follows repository redirects, or executes project code.
const REPOSITORY = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/
const BATCH_SIZE = 40
const MAX_RESPONSE_BYTES = 256 * 1024

export async function enrichRankingSnapshot(input, { token, request = fetch, now = () => new Date().toISOString(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!token) throw new Error('A GitHub token is required for ranking metadata')
  if (!Array.isArray(input.entries) || input.entries.length > 10000) throw new Error('Ranking population exceeds bound')
  const output = structuredClone(input)
  const repositories = new Map()
  for (const entry of output.entries) {
    const match = REPOSITORY.exec(entry.repositoryUrl)
    if (!match) throw new Error('Non-canonical ranking repository')
    const key = entry.repositoryUrl.toLowerCase()
    if (!repositories.has(key)) repositories.set(key, { key, owner: match[1], name: match[2] })
    entry.stars = null
  }
  const repos = [...repositories.values()]
  const stars = new Map()
  let stopped = false
  let requests = 0
  for (let start = 0; start < repos.length && !stopped; start += BATCH_SIZE) {
    const batch = repos.slice(start, start + BATCH_SIZE)
    const query = `query RankingStars { ${batch.map((repo, i) => `r${i}: repository(owner: ${JSON.stringify(repo.owner)}, name: ${JSON.stringify(repo.name)}) { url isPrivate stargazerCount }`).join('\n')} }`
    let body
    for (let attempt = 0; attempt < 3; attempt++) {
      requests++
      try {
        const response = await request('https://api.github.com/graphql', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'dsh-store-ranking-builder' },
          body: JSON.stringify({ query }),
        })
        if ([401, 403, 429].includes(response.status)) { stopped = true; break }
        if (!response.ok) throw new Error('Ranking metadata unavailable')
        if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error('Ranking metadata response too large')
        const reader = response.body.getReader()
        const chunks = []
        let length = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            length += value.byteLength
            if (length > MAX_RESPONSE_BYTES) throw new Error('Ranking metadata response too large')
            chunks.push(value)
          }
        } finally { await reader.cancel() }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        break
      } catch {
        // Never expose API bodies, credentials or request errors in build logs.
        if (attempt < 2) await sleep(500 * (attempt + 1))
      }
    }
    if (!body) continue
    if (body.errors !== undefined && !Array.isArray(body.errors)) continue
    const errors = body.errors || []
    if (errors.some(error => error.type === 'RATE_LIMITED')) stopped = true
    if (errors.some(error => !Array.isArray(error.path) || !error.path.length)) {
      continue
    }
    if (!body.data) continue
    const failedAliases = new Set(errors.map(error => error.path[0]))
    batch.forEach((repo, i) => {
      const value = body.data[`r${i}`]
      if (failedAliases.has(`r${i}`) || !value || value.isPrivate !== false
        || typeof value.url !== 'string' || value.url.toLowerCase() !== repo.key
        || !Number.isSafeInteger(value.stargazerCount) || value.stargazerCount < 0) return
      stars.set(repo.key, value.stargazerCount)
    })
  }
  for (const entry of output.entries) entry.stars = stars.get(entry.repositoryUrl.toLowerCase()) ?? null
  output.starsObservedAt = stars.size ? now() : null
  return { snapshot: output, summary: { repositories: repos.length, fetched: stars.size, missing: repos.length - stars.size, requests, stopped } }
}
