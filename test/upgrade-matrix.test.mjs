import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolveDshUpgradeMatrix } from '../scripts/resolve-dsh-upgrade-matrix.mjs'

test('client peer declarations match the official Host pre-install contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const clients = manifest.dsh.client.inject
  assert.equal(clients.length, 4)
  const runtime = '@deepseek-ai/dsh-client-runtime'
  assert.ok(clients.includes(runtime))
  const runtimeAlternatives = manifest.peerDependencies[runtime].split(' || ')
  assert.ok(runtimeAlternatives.includes('>=0.1.0-rc.6 <0.2.0'))
  for (const release of ['0.2.1-alpha.1', '0.2.1-alpha.2']) {
    assert.ok(runtimeAlternatives.includes(release), `Host pre-install check requires runtime ${release}`)
  }
  for (const name of clients.filter(value => value !== runtime)) {
    const alternatives = manifest.peerDependencies[name].split(' || ')
    for (const release of ['0.2.0-rc.2', '0.2.1-alpha.1', '0.2.1-alpha.2']) {
      assert.ok(alternatives.includes(release), `${name} must explicitly support published ${release}`)
    }
    assert.ok(alternatives.includes('>=0.1.0-rc.6 <0.2.0'), `${name} retains its historical bound`)
    assert.equal(alternatives.filter(value => value.includes('0.2.1')).length, 2)
    assert.ok(!alternatives.includes('*'))
  }
})

test('upgrade matrix uses the exact ordered official latest-three release window', async () => {
  const result = await resolveDshUpgradeMatrix(async options => {
    assert.equal(options.releaseCount, 3)
    return {
      authority: 'official-github-releases-and-npm-published-versions',
      releaseCount: 3,
      latestVersion: '0.1.7-rc.1',
      releases: ['0.1.7-alpha.1', '0.1.7-alpha.2', '0.1.7-rc.1'],
      channels: [
        { tag: 'latest', kind: 'preview', version: '0.1.7-rc.1' },
        { tag: 'next', kind: 'preview', version: '0.2.0-rc.1' },
      ],
    }
  })
  assert.deepEqual(result, {
    latestVersion: '0.1.7-rc.1',
    releases: ['0.1.7-alpha.1', '0.1.7-alpha.2', '0.1.7-rc.1'],
    previousReleases: ['0.1.7-alpha.1', '0.1.7-alpha.2'],
    nextVersion: '0.2.0-rc.1',
  })
})

test('upgrade matrix fails closed on incomplete or unordered official release evidence', async () => {
  await assert.rejects(
    resolveDshUpgradeMatrix(async () => ({
      authority: 'official-github-releases-and-npm-published-versions',
      releaseCount: 3,
      latestVersion: '0.1.7-rc.1',
      releases: ['0.1.7-alpha.1', '0.1.7-rc.1'],
      channels: [],
    })),
    /complete ordered latest-three window/,
  )
  await assert.rejects(
    resolveDshUpgradeMatrix(async () => ({
      authority: 'untrusted',
      releaseCount: 3,
      latestVersion: '0.1.7-alpha.2',
      releases: ['0.1.7-alpha.1', '0.1.7-alpha.2', '0.1.7-rc.1'],
      channels: [],
    })),
    /complete ordered latest-three window/,
  )
})

test('runtime workflow has one timeout and keeps the expensive disposable smoke bounded', async () => {
  const workflow = await readFile(new URL('../.github/workflows/upgrade-matrix.yml', import.meta.url), 'utf8')
  const runtime = workflow.split('\n  runtime:\n')[1]?.split('\n  previous-latest-three:\n')[0]
  assert.ok(runtime)
  assert.equal(runtime.match(/^\s+timeout-minutes:/gm)?.length, 1)
  assert.match(runtime, /timeout-minutes: 20/)
  assert.equal(workflow.match(/DSH_TEST_PLUGIN_SPEC: github:AI-Scarlett\/DSH-Store#/g)?.length, 3)
  const smoke = await readFile(new URL('../scripts/test-disposable-upgrade.mjs', import.meta.url), 'utf8')
  assert.match(smoke, /assert\.equal\(after, baselineConfig/)
  const nextChannel = workflow.split('\n  next-channel:\n')[1]
  assert.ok(nextChannel)
  assert.match(nextChannel, /needs\.resolve\.outputs\.next_version != ''/)
  assert.match(nextChannel, /@deepseek-ai\/dsh@\$DSH_VERSION/)
  assert.match(nextChannel, /scripts\/test-disposable-upgrade\.mjs/)
})

test('next channel must be a well-formed preview and newer than the active latest-three target', async () => {
  const resolve = async channels => resolveDshUpgradeMatrix(async () => ({
    authority: 'official-github-releases-and-npm-published-versions',
    releaseCount: 3,
    latestVersion: '0.1.7-rc.2',
    releases: ['0.1.7-alpha.2', '0.1.7-rc.1', '0.1.7-rc.2'],
    channels,
  }))
  assert.equal((await resolve([{ tag: 'next', kind: 'preview', version: '0.2.0-rc.1' }])).nextVersion, '0.2.0-rc.1')
  assert.equal((await resolve([{ tag: 'next', kind: 'preview', version: '0.1.6-rc.1' }])).nextVersion, null)
  await assert.rejects(resolve([{ tag: 'next', kind: 'stable', version: '0.2.0' }]), /next channel is malformed/)
  await assert.rejects(resolve([{ tag: 'next', kind: 'preview', version: 'not-a-version' }]), /next channel is malformed/)
  await assert.rejects(resolve([
    { tag: 'next', kind: 'preview', version: '0.2.0-rc.1' },
    { tag: 'next', kind: 'preview', version: '0.2.0-rc.2' },
  ]), /duplicate next channels/)
})
