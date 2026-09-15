import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverFeedCandidates, orderDiscoveryCandidates } from '../src/discovery-feeds.mjs'
const hash = 'a'.repeat(40)
const client = (source, truncated=false) => ({
  async api(path) {
    if (path.endsWith('commits/main')) return { sha: hash }
    if (path.includes('git/trees')) return { truncated, tree: [{ type:'blob', mode:'100644', path:'data/plugins/example__demo.yml' }] }
    return { html_url:'https://github.com/example/demo', owner:{id:12} }
  },
  async raw(repo, commit, path) { assert.equal(commit,hash); assert.ok(path.endsWith('.yml')); return source },
})
test('feeds retain provenance and cannot grant installation', async () => {
  const rows = await discoverFeedCandidates(client('url: https://github.com/example/demo\ninstall: execute-malicious-command\n'), { observedAt:'2026-09-15T00:00:00Z' })
  assert.equal(rows.length,1); assert.equal(rows[0].discoveryOnly,true)
  assert.match(rows[0].feedEvidence,/sha256=[a-f0-9]{64}/); assert.match(rows[0].feedEvidence,/owner=12/)
  assert.equal(rows[0].install,undefined)
})
test('feed bounds, tags, ambiguous URLs and arbitrary sources fail closed', async () => {
  await assert.rejects(discoverFeedCandidates(client('',true)), /bound/)
  await assert.rejects(discoverFeedCandidates(client(''),{limit:9}), /bounds/)
  assert.deepEqual(await discoverFeedCandidates(client('url: !!js malicious\n')),[])
  assert.deepEqual(await discoverFeedCandidates(client('url: https://other.example/plugin\n')),[])
  assert.deepEqual(await discoverFeedCandidates(client('url: https://github.com/example/demo\nurl: https://github.com/other/demo\n')),[])
})

test('new GitHub activity cannot starve older feed candidates within a bounded run', () => {
  const recent = Array.from({ length: 20 }, (_, i) => ({ id: i, updated_at: '2026-09-15' }))
  const feed = Array.from({ length: 8 }, (_, i) => ({ id: `feed-${i}`, discoveryOnly: true, updated_at: '2026-01-01' }))
  const selected = orderDiscoveryCandidates([...recent, ...feed]).slice(0, 8)
  assert.equal(selected.filter(item => item.discoveryOnly).length, 4)
  assert.equal(selected.filter(item => !item.discoveryOnly).length, 4)
})
