import assert from 'node:assert/strict'
import test from 'node:test'
import { createCatalogGithubReader, sameCommitLineage } from '../scripts/catalog-github-reader.mjs'
const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40), d = 'd'.repeat(40), e = 'e'.repeat(40)
function metadata(repository) {
  return { databaseId: 123, nameWithOwner: repository, url: `https://github.com/${repository}`, isPrivate: false, isArchived: false, isDisabled: false,
    owner: { login: repository.split('/')[0], databaseId: 101 }, licenseInfo: { spdxId: 'MIT' },
    pushedAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z',
    defaultBranchRef: { name: 'main', target: { oid: a, committedDate: '2026-10-17T00:00:00Z' } } }
}
function mock({ object, changeMetadata = value => value, rest = () => new Response('content') } = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, init })
    if (url !== 'https://api.github.com/graphql') return rest(url, init)
    assert.equal(init.method, 'POST'); assert.ok(init.body.startsWith('{'))
    const { query } = JSON.parse(init.body); assert.ok(query.startsWith('query {'))
    const aliases = [...query.matchAll(/n(\d+): repository\(owner:("(?:\\.|[^"\\])*"),name:("(?:\\.|[^"\\])*")\)/g)]
    assert.ok(aliases.length > 0 && aliases.length <= 8)
    const data = { rateLimit: { cost: 1, remaining: 900, resetAt: '2026-10-17T01:00:00Z' } }
    for (let i = 0; i < aliases.length; i++) {
      const m = aliases[i], repository = JSON.parse(m[2]) + '/' + JSON.parse(m[3])
      const selection = query.slice(m.index + m[0].length, aliases[i + 1]?.index ?? query.length)
      const expression = /object\(expression:("(?:\\.|[^"\\])*")\)/.exec(selection)
      data[`n${m[1]}`] = expression ? { object: object?.(JSON.parse(expression[1]), repository) ?? { oid: b, entries: [] } } : changeMetadata(metadata(repository))
    }
    return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })
  }
  return { fetch, calls }
}
test('repository/Commit reads batch and share canonical snapshots instead of spending REST publication quota', async () => {
  const io = mock(), client = createCatalogGithubReader({ fetch: io.fetch, treeTransport: 'graphql', token: 'fixture-secret' })
  const repositories = Array.from({ length: 40 }, (_, i) => `https://github.com/example/plugin-${i}`)
  const primed = await client.primeRepositories(repositories); assert.ok(primed.every(r => r.status === 'fulfilled'))
  assert.equal(io.calls.length, 5)
  for (let i = 0; i < 40; i++) {
    const repo = await client.api(`repos/example/plugin-${i}`), head = await client.api(`repos/example/plugin-${i}/commits/main`)
    assert.equal(repo.license.spdx_id, 'MIT'); assert.equal(repo.owner.id, 101); assert.equal(head.sha, a)
    assert.equal((await client.api(`repos/example/plugin-${i}/commits/${a}`)).sha, a)
  }
  assert.equal(io.calls.length, 5); assert.equal(client.statistics.restRequests, 0)
  assert.ok(!JSON.stringify(client.statistics).includes('fixture-secret'))
})
test('recursive immutable trees retain every path, mode, size and blob identity', async () => {
  const io = mock({ object: expression => expression === `${a}^{tree}`
    ? { oid: b, entries: [{ name: 'lib', type: 'tree', mode: 16384, oid: c, object: {} }, { name: 'README.md', type: 'blob', mode: 33188, oid: d, object: { byteSize: 12 } }] }
    : { oid: c, entries: [{ name: 'index.js', type: 'blob', mode: 33188, oid: e, object: { byteSize: 30 } }] } })
  const client = createCatalogGithubReader({ fetch: io.fetch, treeTransport: 'graphql' })
  const tree = await client.api(`repos/example/plugin/git/trees/${a}?recursive=1`)
  assert.equal(tree.truncated, false)
  assert.deepEqual(tree.tree, [{ path: 'lib', mode: '040000', type: 'tree', sha: c }, { path: 'README.md', mode: '100644', type: 'blob', sha: d, size: 12 }, { path: 'lib/index.js', mode: '100644', type: 'blob', sha: e, size: 30 }])
  assert.equal(client.statistics.restRequests, 0)
})
test('tree limits are explicit incomplete evidence and malformed or missing objects never become complete', async () => {
  const io = mock({ object: () => ({ oid: b, entries: [1, 2].map(n => ({ name: `file-${n}`, mode: 33188, type: 'blob', oid: c, object: { byteSize: 1 } })) }) })
  const client = createCatalogGithubReader({ fetch: io.fetch, treeTransport: 'graphql' })
  assert.equal((await client.api(`repos/example/plugin/git/trees/${a}?recursive=1`, { maxTreeEntries: 1 })).truncated, true)
  for (const row of [{ name: '..', mode: 33188, type: 'blob', oid: c, object: { byteSize: 1 } }, { name: 'file', mode: 33188, type: 'blob', oid: c, object: {} }]) {
    const malformed = mock({ object: () => ({ oid: b, entries: [row] }) })
    await assert.rejects(createCatalogGithubReader({ treeTransport: 'graphql', fetch: malformed.fetch }).api(`repos/example/plugin/git/trees/${a}?recursive=1`), error => error.code === 'CATALOG_AUTOMATION_GITHUB_TREE')
  }
})
test('REST and GraphQL budgets retain publication capacity and cannot be bypassed by source retries', async () => {
  const io = mock({ rest: () => new Response('{}', { headers: { 'x-ratelimit-remaining': '250' } }) })
  const client = createCatalogGithubReader({ fetch: io.fetch, treeTransport: 'graphql' })
  await client.api(`repos/example/plugin/compare/${a}...${b}`)
  await assert.rejects(client.api(`repos/example/plugin/compare/${a}...${c}`), error => error.code === 'CATALOG_AUTOMATION_GITHUB_BUDGET')
  assert.equal(client.statistics.restRequests, 1)
  assert.equal((await client.api('repos/example/plugin')).private, false)
  const exhausted = createCatalogGithubReader({ fetch: io.fetch, treeTransport: 'graphql', graphqlLimit: 0 })
  await assert.rejects(exhausted.api('repos/example/plugin'), error => error.code === 'CATALOG_AUTOMATION_GITHUB_BUDGET')
})
test('child trees must match their immutable object ID and entry type must match mode', async () => {
  const mismatch = mock({ object: expression => expression === `${a}^{tree}`
    ? { oid: b, entries: [{ name: 'lib', type: 'tree', mode: 16384, oid: c }] }
    : { oid: d, entries: [] } })
  await assert.rejects(createCatalogGithubReader({ treeTransport: 'graphql', fetch: mismatch.fetch }).api(`repos/example/plugin/git/trees/${a}?recursive=1`), error => error.code === 'CATALOG_AUTOMATION_GITHUB_TREE')
  const badMode = mock({ object: () => ({ oid: b, entries: [{ name: 'lib', type: 'tree', mode: 33188, oid: c }] }) })
  await assert.rejects(createCatalogGithubReader({ treeTransport: 'graphql', fetch: badMode.fetch }).api(`repos/example/plugin/git/trees/${a}?recursive=1`), error => error.code === 'CATALOG_AUTOMATION_GITHUB_TREE')
})
test('source transport never sends notification mutations or reads a floating raw source', async () => {
  const io = mock(), client = createCatalogGithubReader({ fetch: io.fetch, treeTransport: 'graphql' })
  await assert.rejects(client.fetch('https://api.github.com/repos/example/plugin/issues', { method: 'POST', body: '{}' }))
  await assert.rejects(client.raw('https://github.com/example/plugin', 'main', 'index.js'))
  await assert.rejects(client.json('https://untrusted.example/file.json'))
  assert.equal(io.calls.length, 0)
})
test('cache entries have independent response bodies, per-read bounds and a bounded total size', async () => {
  const io = mock({ rest: () => new Response('0123456789') }), client = createCatalogGithubReader({ fetch: io.fetch, treeTransport: 'graphql', cacheLimit: 24 })
  const url = `https://raw.githubusercontent.com/example/plugin/${a}/index.js`
  const responses = await Promise.all([client.fetch(url), client.fetch(url)])
  assert.deepEqual(await Promise.all(responses.map(r => r.text())), ['0123456789', '0123456789'])
  assert.equal(io.calls.length, 1)
  await assert.rejects(client.raw('https://github.com/example/plugin', a, 'index.js', { maxBytes: 4 }), error => error.code === 'CATALOG_AUTOMATION_GITHUB_SOURCE_TOO_LARGE')
  for (const path of ['one.js', 'two.js', 'three.js']) await client.raw('https://github.com/example/plugin', a, path)
  assert.ok(client.statistics.cacheBytes <= 24)
})
test('public canonical identity and explicit metadata booleans are required', async () => {
  for (const mutate of [m => ({ ...m, nameWithOwner: 'different/repository' }), m => ({ ...m, isPrivate: undefined }), m => ({ ...m, defaultBranchRef: { ...m.defaultBranchRef, target: { oid: 'short' } } })]) {
    const io = mock({ changeMetadata: mutate })
    await assert.rejects(createCatalogGithubReader({ fetch: io.fetch, treeTransport: 'graphql' }).api('repos/example/plugin'), error => error.code === 'CATALOG_AUTOMATION_GITHUB_IDENTITY')
  }
})
test('only an identical full Commit pair has a local identity lineage proof', () => {
  assert.deepEqual(sameCommitLineage(a, a), { status: 'identical', total_commits: 0, ahead_by: 0, behind_by: 0 })
  for (const pair of [[a, b], ['short', 'short'], [null, null]]) assert.equal(sameCommitLineage(...pair), null)
})
test('HTTP 404 remains an optional missing-source response while oversized reads fail closed', async () => {
  const io = mock({ rest: () => new Response('{}', { status: 404 }) })
  assert.equal((await createCatalogGithubReader({ fetch: io.fetch, treeTransport: 'graphql' }).fetch(`https://raw.githubusercontent.com/example/plugin/${a}/README.md`)).status, 404)
  const big = mock({ rest: () => new Response('x'.repeat(20)) })
  await assert.rejects(createCatalogGithubReader({ fetch: big.fetch }).raw('https://github.com/example/plugin', a, 'index.js', { maxBytes: 4 }), error => error.code === 'CATALOG_AUTOMATION_GITHUB_SOURCE_TOO_LARGE')
})
test('only the bounded exact no-common-ancestor response can supply disconnected lineage evidence', async () => {
  for (const [message, expected] of [[`No common ancestor between ${a} and ${b}`, `No common ancestor between ${a} and ${b}`], ['unverified remote failure', 'GitHub returned HTTP 404']]) {
    const io = mock({ rest: () => new Response(JSON.stringify({ message }), { status: 404 }) })
    await assert.rejects(createCatalogGithubReader({ fetch: io.fetch, treeTransport: 'graphql' }).api(`repos/example/plugin/compare/${a}...${b}`, { captureNoCommonAncestor: true }), error => error.status === 404 && error.message === expected)
  }
})
test('complete recursive REST trees use one shared request instead of walking every directory', async () => {
  const payload = { sha: b, truncated: false, tree: [{ path: 'lib', mode: '040000', type: 'tree', sha: c }, { path: 'lib/index.js', mode: '100644', type: 'blob', sha: d, size: 4 }] }
  const io = mock({ rest: () => new Response(JSON.stringify(payload), { headers: { 'x-ratelimit-remaining': '999' } }) })
  const client = createCatalogGithubReader({ fetch: io.fetch })
  const url = `https://api.github.com/repos/example/plugin/git/trees/${a}?recursive=1`
  assert.deepEqual(await client.json(url), payload)
  assert.deepEqual(await (await client.fetch(url)).json(), payload)
  assert.equal(io.calls.length, 1); assert.equal(client.statistics.graphqlRequests, 0)
  assert.equal(client.statistics.remainingRest, 999)
  const limited = await client.json(url, { maxTreeEntries: 1 })
  assert.equal(limited.truncated, true)
  const malformed = mock({ rest: () => new Response('{}') })
  await assert.rejects(createCatalogGithubReader({ fetch: malformed.fetch }).json(url), error => error.code === 'CATALOG_AUTOMATION_GITHUB_TREE')
})
test('recursive trees fall back to complete GraphQL evidence when REST is reserved', async () => {
  const io = mock(), client = createCatalogGithubReader({ fetch: io.fetch, restLimit: 0 })
  const tree = await client.api(`repos/example/plugin/git/trees/${a}?recursive=1`)
  assert.deepEqual(tree, { sha: b, truncated: false, tree: [] })
  assert.equal(client.statistics.restRequests, 0); assert.equal(client.statistics.graphqlRequests, 1)
})
test('the separate search quota cannot consume or replace the core publication reserve', async () => {
  const io = mock({ rest: url => new Response('{}', { headers: { 'x-ratelimit-remaining': url.includes('/search/') ? '29' : '999' } }) })
  const client = createCatalogGithubReader({ fetch: io.fetch })
  await client.api(`repos/example/plugin/compare/${a}...${b}`)
  await client.api('search/repositories?q=dsh')
  assert.equal(client.statistics.remainingRest, 999)
  await client.api(`repos/example/plugin/compare/${a}...${c}`)
  assert.equal(client.statistics.restRequests, 3)
})
