// Public GitHub reads only. Batch metadata through GraphQL and cache complete
// recursive REST trees. A bounded GraphQL fallback preserves the PR reserve.
const OID = /^[a-f0-9]{40}$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const MAX_BYTES = 4 * 1024 * 1024
const error = (message, code = 'HTTP', status) => Object.assign(new Error(message), { code: `CATALOG_AUTOMATION_GITHUB_${code}`, ...(status ? { status } : {}) })
export function sameCommitLineage(base, head) {
  return OID.test(base ?? '') && base === head ? { status: 'identical', total_commits: 0, ahead_by: 0, behind_by: 0 } : null
}
async function boundedText(response, maximum = MAX_BYTES) {
  if (Number(response.headers?.get?.('content-length')) > maximum) throw error('GitHub response exceeds its read bound', 'SOURCE_TOO_LARGE')
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maximum) throw error('GitHub response exceeds its read bound', 'SOURCE_TOO_LARGE')
    return text
  }
  const reader = response.body.getReader(), chunks = []; let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break
      size += value.length
      if (size > maximum) { await reader.cancel(); throw error('GitHub response exceeds its read bound', 'SOURCE_TOO_LARGE') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}
export function createCatalogGithubReader(options = {}) {
  const request = options.fetch ?? globalThis.fetch, token = options.token ?? process.env.GITHUB_TOKEN ?? ''
  const timeoutMs = options.timeoutMs ?? 15_000
  const stats = { restRequests: 0, restLimit: options.restLimit ?? 650, publicationReserve: options.publicationReserve ?? 250, remainingRest: null, graphqlRequests: 0, graphqlLimit: options.graphqlLimit ?? 700, remainingGraphql: null, cacheHits: 0, cacheBytes: 0, cacheLimit: options.cacheLimit ?? 64 * 1024 * 1024 }
  const cache = new Map(), pending = []; let scheduled = false
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-safe-plugin-manager-catalog-automation', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) }
  async function network(url, init = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await request(url, { ...init, headers: { ...headers, ...(init.method === 'POST' ? { 'content-type': 'application/json' } : {}) }, signal: controller.signal })
      return { response, text: await boundedText(response, init.maxBytes ?? MAX_BYTES) }
    }
    catch (cause) { if (String(cause?.code ?? '').startsWith('CATALOG_AUTOMATION_GITHUB_')) throw cause; throw error(cause?.name === 'AbortError' ? 'GitHub read timed out' : 'GitHub read failed', cause?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK') }
    finally { clearTimeout(timer) }
  }
  function memo(key, worker) {
    if (cache.has(key)) {
      stats.cacheHits++; const item = cache.get(key); cache.delete(key); cache.set(key, item); return item.promise
    }
    const item = { bytes: 0, promise: null }
    item.promise = Promise.resolve().then(worker).then(value => {
      if (cache.get(key) === item) {
        item.bytes = Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value))
        stats.cacheBytes += item.bytes
        while (stats.cacheBytes > stats.cacheLimit || cache.size > 10000) {
          const first = cache.keys().next().value, removed = cache.get(first)
          cache.delete(first); stats.cacheBytes -= removed.bytes
        }
      }
      return value
    }).catch(cause => { if (cache.get(key) === item) { cache.delete(key); stats.cacheBytes -= item.bytes }; throw cause })
    cache.set(key, item); return item.promise
  }
  async function graphql(items) {
    if (stats.graphqlRequests >= stats.graphqlLimit || stats.remainingGraphql !== null && stats.remainingGraphql <= 150) throw error('GraphQL source budget reserved for publication', 'BUDGET')
    stats.graphqlRequests++
    const query = 'query { ' + items.map((item, i) => {
      const [owner, name] = item.repository.split('/')
      return `n${i}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { ${item.selection} }`
    }).join(' ') + ' rateLimit { cost remaining resetAt } }'
    const { response, text } = await network('https://api.github.com/graphql', { method: 'POST', body: JSON.stringify({ query }) })
    if (!response.ok) throw error(`GitHub GraphQL returned HTTP ${response.status}`, 'HTTP', response.status)
    let document
    try { document = JSON.parse(text) } catch (cause) { if (cause.code) throw cause; throw error('GitHub GraphQL returned invalid JSON', 'JSON') }
    if (Number.isSafeInteger(document.data?.rateLimit?.remaining)) stats.remainingGraphql = document.data.rateLimit.remaining
    const general = document.errors?.find(item => !Array.isArray(item.path) || !/^n[0-9]+$/.test(item.path[0] ?? ''))
    for (let i = 0; i < items.length; i++) {
      const failure = general ?? document.errors?.find(item => item.path?.[0] === `n${i}`)
      const value = document.data?.[`n${i}`]
      if (failure || !value) items[i].reject(error('GitHub repository query could not be verified', 'HTTP', failure?.type === 'NOT_FOUND' || !value && !failure ? 404 : 502))
      else items[i].resolve(value)
    }
  }
  async function flush() {
    try {
      while (pending.length) {
        const batch = pending.splice(0, 8)
        try { await graphql(batch) } catch (cause) { for (const item of batch) item.reject(cause) }
      }
    } finally { scheduled = false }
  }
  function query(repository, selection) {
    if (!REPOSITORY.test(repository)) return Promise.reject(error('Invalid canonical repository', 'IDENTITY'))
    return new Promise((resolve, reject) => {
      pending.push({ repository, selection, resolve, reject })
      if (!scheduled) { scheduled = true; setTimeout(() => { void flush() }, 2) }
    })
  }
  function repositorySnapshot(repository) {
    return memo(`repository:${repository.toLowerCase()}`, async () => {
      const value = await query(repository, 'databaseId nameWithOwner url isPrivate isArchived isDisabled pushedAt updatedAt owner { login ... on User { databaseId } ... on Organization { databaseId } } licenseInfo { spdxId } defaultBranchRef { name target { oid ... on Commit { committedDate } } }')
      if (value.nameWithOwner?.toLowerCase() !== repository.toLowerCase() || value.url !== `https://github.com/${value.nameWithOwner}`
        || !Number.isSafeInteger(value.databaseId) || !Number.isSafeInteger(value.owner?.databaseId)
        || ['isPrivate', 'isArchived', 'isDisabled'].some(key => typeof value[key] !== 'boolean')) throw error('Canonical repository identity changed', 'IDENTITY')
      const ref = value.defaultBranchRef
      if (ref && (typeof ref.name !== 'string' || !ref.name || ref.name.length > 1024 || !OID.test(ref.target?.oid ?? '') || !Number.isFinite(Date.parse(ref.target?.committedDate)))) throw error('Default branch Commit is incomplete', 'IDENTITY')
      return {
        metadata: { id: value.databaseId, full_name: value.nameWithOwner, html_url: value.url, private: value.isPrivate, archived: value.isArchived, disabled: value.isDisabled,
          default_branch: ref?.name ?? '', owner: { id: value.owner.databaseId, login: value.owner.login }, license: value.licenseInfo ? { spdx_id: value.licenseInfo.spdxId } : null, pushed_at: value.pushedAt, updated_at: value.updatedAt },
        head: ref ? { sha: ref.target.oid, commit: { committer: { date: ref.target.committedDate }, author: { date: ref.target.committedDate } } } : null,
      }
    })
  }
  async function commit(repository, ref) {
    const snapshot = await repositorySnapshot(repository)
    if (ref === snapshot.metadata.default_branch || ref === snapshot.head?.sha) {
      if (!snapshot.head) throw error('Default branch has no Commit', 'HTTP', 404)
      return snapshot.head
    }
    return memo(`commit:${repository.toLowerCase()}:${ref}`, async () => {
      // The expression is a JSON string in a fixed read-only query, never code.
      const value = await query(repository, `object(expression:${JSON.stringify(ref)}) { ... on Commit { oid committedDate } }`)
      if (!OID.test(value.object?.oid ?? '') || OID.test(ref) && value.object.oid !== ref) throw error('Fixed Commit is unavailable', 'HTTP', 404)
      return { sha: value.object.oid, commit: { committer: { date: value.object.committedDate }, author: { date: value.object.committedDate } } }
    })
  }
  async function tree(repository, sha, maximumEntries = 20000) {
    if (!OID.test(sha) || !Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 50000) throw error('Invalid immutable tree request', 'IDENTITY')
    return memo(`tree:${repository.toLowerCase()}:${sha}:${maximumEntries}`, async () => {
      let queue = [{ expression: `${sha}^{tree}`, path: '', depth: 0 }]
      const entries = []; let root = null, truncated = false
      while (queue.length && !truncated) {
        const batch = queue.splice(0, 8)
        const rows = await Promise.all(batch.map(async directory => {
          const value = await query(repository, `object(expression:${JSON.stringify(directory.expression)}) { ... on Tree { oid entries { name type mode oid object { ... on Blob { byteSize } } } } }`)
          if (!OID.test(value.object?.oid ?? '') || !Array.isArray(value.object.entries)
            || OID.test(directory.expression) && value.object.oid !== directory.expression) throw error('Immutable tree is incomplete or its identity changed', 'TREE')
          return { directory, value: value.object }
        }))
        for (const { directory, value } of rows) {
          root ??= value.oid
          for (const row of value.entries) {
            if (typeof row.name !== 'string' || !row.name || /[\/\\\0]/.test(row.name) || ['.', '..'].includes(row.name)
              || !OID.test(row.oid ?? '') || !Number.isSafeInteger(row.mode)
              || !({ tree: [16384], blob: [33188, 33261, 40960], commit: [57344] }[row.type] ?? []).includes(row.mode)) throw error('Invalid immutable tree entry', 'TREE')
            const path = directory.path ? `${directory.path}/${row.name}` : row.name
            if (row.type === 'blob' && (!Number.isSafeInteger(row.object?.byteSize) || row.object.byteSize < 0)) throw error('Blob size is unknown', 'TREE')
            entries.push({ path, mode: row.mode.toString(8).padStart(6, '0'), type: row.type, sha: row.oid, ...(row.type === 'blob' ? { size: row.object.byteSize } : {}) })
            if (entries.length > maximumEntries || directory.depth >= 40) { truncated = true; break }
            if (row.type === 'tree') queue.push({ expression: row.oid, path, depth: directory.depth + 1 })
          }
          if (truncated) break
        }
      }
      return { sha: root, truncated, tree: entries }
    })
  }
  async function read(url, settings = {}) {
    const parsed = new URL(url)
    if (!['https://api.github.com', 'https://raw.githubusercontent.com'].includes(parsed.origin)) throw error('Unapproved public source authority', 'IDENTITY')
    if (parsed.hostname === 'raw.githubusercontent.com' && !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[a-f0-9]{40}\//.test(parsed.pathname)) throw error('Raw source must use a fixed Commit', 'IDENTITY')
    const key = parsed.href + ':treeLimit=' + (settings.maxTreeEntries ?? 20000)
    const result = await memo(key, async () => {
      const match = /^\/repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(parsed.pathname)
      let value
      if (parsed.hostname === 'api.github.com' && match) {
        const repository = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`, rest = match[3] ?? ''
        if (!rest && !parsed.search) value = (await repositorySnapshot(repository)).metadata
        else if (rest.startsWith('commits/') && !parsed.search) value = await commit(repository, decodeURIComponent(rest.slice(8)))
        else if (/^git\/trees\/[a-f0-9]{40}$/.test(rest) && parsed.search === '?recursive=1'
          && (options.treeTransport === 'graphql' || stats.restRequests >= stats.restLimit
            || stats.remainingRest !== null && stats.remainingRest <= stats.publicationReserve)) {
          value = await tree(repository, rest.split('/').at(-1), settings.maxTreeEntries ?? 20000)
        }
      }
      if (value !== undefined) {
        const text = JSON.stringify(value)
        if (Buffer.byteLength(text) > (settings.maxBytes ?? MAX_BYTES)) throw error('GitHub metadata exceeds its read bound', 'SOURCE_TOO_LARGE')
        return text
      }
      if (parsed.hostname === 'api.github.com') {
        if (stats.restRequests >= stats.restLimit || stats.remainingRest !== null && stats.remainingRest <= stats.publicationReserve) throw error('REST source budget reserved for the checked PR and publication', 'BUDGET')
        stats.restRequests++
      }
      const { response, text } = await network(parsed.href, { maxBytes: settings.maxBytes ?? MAX_BYTES })
      if (parsed.hostname === 'api.github.com') {
        const remaining = response.headers?.get?.('x-ratelimit-remaining')
        // Search has its own small quota; it must never replace core capacity.
        if (!parsed.pathname.startsWith('/search/') && remaining !== null && remaining !== undefined && /^\d+$/.test(remaining)) stats.remainingRest = Number(remaining)
      }
      if (!response.ok) {
        let message = `GitHub returned HTTP ${response.status}`
        if (response.status === 404 && settings.captureNoCommonAncestor === true && Buffer.byteLength(text) <= 4096) {
          try { const body = JSON.parse(text); if (/^No common ancestor between [a-f0-9]{40} and [a-f0-9]{40}\.?$/.test(body.message)) message = body.message } catch {}
        }
        throw error(message, 'HTTP', response.status)
      }
      if (parsed.hostname === 'api.github.com' && /^\/repos\/[^/]+\/[^/]+\/git\/trees\/[a-f0-9]{40}$/.test(parsed.pathname) && parsed.search === '?recursive=1') {
        let value
        try { value = JSON.parse(text) } catch { throw error('GitHub returned an invalid immutable tree', 'TREE') }
        if (!OID.test(value?.sha ?? '') || typeof value.truncated !== 'boolean' || !Array.isArray(value.tree)) throw error('GitHub returned an incomplete immutable tree', 'TREE')
        const maximum = settings.maxTreeEntries ?? 20000
        if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 50000) throw error('Invalid immutable tree bound', 'TREE')
        if (value.tree.length > maximum) return JSON.stringify({ ...value, truncated: true, tree: value.tree.slice(0, maximum + 1) })
      }
      return text
    })
    if (Buffer.byteLength(result) > (settings.maxBytes ?? MAX_BYTES)) throw error('Cached source exceeds this read bound', 'SOURCE_TOO_LARGE')
    return result
  }
  return {
    statistics: stats,
    primeRepositories: repositories => Promise.allSettled([...new Set(repositories.map(url => url.replace(/^https:\/\/github\.com\//, '')))].map(repositorySnapshot)),
    fetch: async (url, init = {}) => {
      if (init.method && init.method !== 'GET') throw error('The source adapter accepts GET reads only', 'IDENTITY')
      try { return new Response(await read(String(url)), { headers: { 'content-type': 'application/json' } }) }
      catch (cause) { if (Number.isInteger(cause.status)) return new Response('{}', { status: cause.status }); throw cause }
    },
    json: async (url, settings) => JSON.parse(await read(url, settings)),
    api: async (path, settings) => JSON.parse(await read(`https://api.github.com/${path.replace(/^\//, '')}`, settings)),
    raw: (repositoryUrl, sha, path, settings) => read(`https://raw.githubusercontent.com/${repositoryUrl.replace(/^https:\/\/github\.com\//, '')}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`, settings),
  }
}
