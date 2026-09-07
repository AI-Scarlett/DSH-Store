import assert from 'node:assert/strict'
import test from 'node:test'
import { DSH_RELEASES_URL, fetchOfficialDshReleaseWindow, officialDshReleaseWindow } from '../src/dsh-release-policy.mjs'

const metadata = {
  name: '@deepseek-ai/dsh', 'dist-tags': { latest: '0.1.2-rc.1', alpha: '0.1.2-alpha.5' },
  versions: { '0.1.2-alpha.4': {}, '0.1.2-alpha.5': {}, '0.1.2-rc.1': {} },
}
const release = (version = '0.1.3-alpha.1') => ({
  tag_name: `dsh-v${version}`, draft: false, prerelease: true,
  published_at: '2026-09-04T11:34:32Z',
  html_url: `https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v${version}`,
})

test('published GitHub release advances latest-three while npm remains behind', () => {
  const result = officialDshReleaseWindow(metadata, 3, [release()])
  assert.deepEqual(result.releases, ['0.1.2-alpha.5', '0.1.2-rc.1', '0.1.3-alpha.1'])
  assert.equal(result.npmVersion, '0.1.2-rc.1')
  assert.equal(result.npmAvailable, false)
  assert.equal(result.releaseChannel, 'preview')
})

test('drafts, unrelated tags and future major.minor previews cannot displace the supported line', () => {
  const result = officialDshReleaseWindow(metadata, 3, [
    { ...release(), draft: true }, { ...release(), tag_name: 'python-v9.0.0' }, release('0.2.0-alpha.1'),
  ])
  assert.equal(result.latestVersion, '0.1.2-rc.1')
  assert.equal(result.releaseChannel, 'preview', 'a prerelease on npm latest is not a stable release')
})

test('wrong official release identity and incomplete authority fail closed', async () => {
  assert.throws(() => officialDshReleaseWindow(metadata, 3, [{ ...release(), html_url: 'https://github.com/other/repo' }]), /identity/)
  await assert.rejects(fetchOfficialDshReleaseWindow({
    fetch: async url => url === DSH_RELEASES_URL ? new Response('', { status: 429 }) : Response.json(metadata),
  }), /releases returned HTTP 429/)
})

test('a GitHub release cannot restore a deprecated npm version', () => {
  const value = { ...metadata, versions: { ...metadata.versions, '0.1.3-alpha.1': { deprecated: 'withdrawn' } } }
  const result = officialDshReleaseWindow(value, 3, [release()])
  assert.equal(result.latestVersion, '0.1.2-rc.1')
  assert.equal(result.channels.find(channel => channel.tag === 'latest').kind, 'preview')
})

test('bounded release fetch sends the optional token only to GitHub', async () => {
  const seen = []
  const result = await fetchOfficialDshReleaseWindow({
    githubToken: 'synthetic-test-token',
    fetch: async (url, options) => {
      seen.push([url, options.headers.authorization, options.redirect])
      return Response.json(url === DSH_RELEASES_URL ? [release()] : metadata)
    },
  })
  assert.equal(result.latestVersion, '0.1.3-alpha.1')
  assert.equal(seen[0][1], undefined)
  assert.deepEqual(seen[1], [DSH_RELEASES_URL, 'Bearer synthetic-test-token', 'error'])
})

test('oversized streamed authority responses are cancelled before buffering the remainder', async () => {
  let cancelled = false
  await assert.rejects(fetchOfficialDshReleaseWindow({ maxBytes: 32, fetch: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(64)) },
    cancel() { cancelled = true },
  })) }), /exceeded/)
  assert.equal(cancelled, true)
})
