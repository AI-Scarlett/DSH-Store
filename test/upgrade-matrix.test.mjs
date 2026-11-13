import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolveDshUpgradeMatrix } from '../scripts/resolve-dsh-upgrade-matrix.mjs'

test('client peer declarations match the official Host pre-install contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const clients = manifest.dsh.client.inject
  assert.equal(clients.length, 6)
  const remotes = '@deepseek-ai/dsh-api-remotes'
  assert.ok(clients.includes(remotes), 'the remote service provider must be a declared static dependency')
  assert.ok(!clients.includes('@deepseek-ai/dsh-client-runtime'),
    'the standalone dsh-client-runtime line stopped publishing after 0.1.1-rc.2')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-client-runtime'], undefined)
  for (const release of ['0.2.1-alpha.1', '0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-alpha.4', '0.2.1-alpha.5', '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-alpha.2', '0.2.2-alpha.3', '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3']) {
    assert.ok(manifest.peerDependencies[remotes].split(' || ').includes(release),
      `the remote service provider must explicitly support published ${release}`)
  }
  for (const name of clients) {
    const alternatives = manifest.peerDependencies[name].split(' || ')
    for (const release of ['0.2.0-rc.2', '0.2.1-alpha.1', '0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-alpha.4', '0.2.1-alpha.5', '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-alpha.2', '0.2.2-alpha.3', '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3']) {
      assert.ok(alternatives.includes(release), `${name} must explicitly support published ${release}`)
    }
    assert.ok(alternatives.includes('>=0.1.0-rc.6 <0.2.0'), `${name} retains its historical bound`)
    assert.equal(alternatives.filter(value => value.includes('0.2.1')).length, 10)
    assert.ok(!alternatives.includes('*'))
  }
})

test('every declared client dependency publishes every version its peer range names', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const fixture = JSON.parse(await readFile(new URL('fixtures/official-client-packages.json', import.meta.url), 'utf8'))
  const latestThree = ['0.2.2-alpha.2', '0.2.2-alpha.3', '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3']
  for (const name of manifest.dsh.client.inject) {
    const published = new Set(fixture.packages[name])
    assert.ok(published.size > 0, `${name} must be a known official client package`)
    for (const release of manifest.peerDependencies[name].split(' || ')) {
      if (!/^\d+\.\d+\.\d+/.test(release)) continue
      assert.ok(published.has(release),
        `${name} names ${release} in its peer range but publishes no such version, so the range cannot resolve`)
    }
    for (const release of latestThree) {
      assert.ok(published.has(release), `${name} must publish the live latest-three release ${release}`)
    }
  }
})

test('the remote service the client injects is provided by a declared package', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const fixture = JSON.parse(await readFile(new URL('fixtures/official-client-packages.json', import.meta.url), 'utf8'))
  const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const services = ['slots', 'remote', 'remote.pluginManager']
  assert.match(client, /const inject = \['slots', 'remote', 'remote\.pluginManager'\]/)
  for (const service of services) {
    const provider = fixture.serviceProviders[service]
    assert.ok(provider, `${service} must have a recorded official provider`)
    if (provider.package === null) continue
    assert.ok(manifest.dsh.client.inject.includes(provider.package),
      `${service} comes from ${provider.package}, which the client must declare as a static dependency`)
  }
  assert.equal(fixture.serviceProviders['remote.pluginManager'].package, '@deepseek-ai/dsh-api-remotes')
})

test('RC support is exact across the host and published UI peers without future prerelease claims', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const uiClients = manifest.dsh.client.inject
  for (const range of [manifest.dsh.compatibility.dsh, manifest.engines.dsh,
    ...uiClients.map(name => manifest.peerDependencies[name])]) {
    for (const release of ['0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-alpha.2', '0.2.2-alpha.3', '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3']) assert.ok(range.split(' || ').includes(release))
    assert.ok(!range.includes('*'))
    assert.ok(!range.split(' || ').some(part => /^>=0\.2\./.test(part)))
  }
  assert.equal(manifest.version, '0.9.47')
  assert.ok(['unknown', 'compatible'].includes(manifest.dsh.compatibility.dshReleases['0.2.1-rc.1']))
  assert.equal(manifest.dsh.compatibility.dshReleases['0.2.2-rc.1'], 'compatible')
  assert.equal(manifest.dsh.compatibility.dshOperations['0.2.1-rc.1'].rollback, 'unknown')
  assert.equal(manifest.dsh.compatibility.dshReleases['0.2.1-rc.3'], 'compatible')
  assert.deepEqual(manifest.dsh.compatibility.dshOperations['0.2.1-rc.3'], {
    install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'unknown',
  })
  assert.equal(manifest.dsh.compatibility.dshReleases['0.2.1-rc.4'], 'compatible')
  assert.deepEqual(manifest.dsh.compatibility.dshOperations['0.2.1-rc.4'], {
    install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'unknown',
  })
  assert.equal(manifest.dsh.compatibility.dshReleases['0.2.1-rc.5'], 'compatible')
  assert.deepEqual(manifest.dsh.compatibility.dshOperations['0.2.1-rc.5'], {
    install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'unknown',
  })
  assert.equal(manifest.dsh.compatibility.dshReleases['0.2.2-alpha.2'], 'compatible')
  assert.deepEqual(manifest.dsh.compatibility.dshOperations['0.2.2-alpha.2'], {
    install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'unknown',
  })
  assert.equal(manifest.dsh.compatibility.dshReleases['0.2.2-alpha.3'], 'compatible')
  assert.deepEqual(manifest.dsh.compatibility.dshOperations['0.2.2-alpha.3'], {
    install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'unknown',
  })
  assert.equal(manifest.dsh.compatibility.dshReleases['0.2.2-rc.1'], 'compatible')
  assert.deepEqual(manifest.dsh.compatibility.dshOperations['0.2.2-rc.1'], {
    install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'unknown',
  })
})

test('upgrade matrix uses the exact ordered official latest-three release window', async () => {
  const result = await resolveDshUpgradeMatrix(async options => {
    assert.equal(options.releaseCount, 3)
    return {
      authority: 'official-github-releases-and-npm-published-versions',
      releaseCount: 3,
      latestVersion: '0.2.2-alpha.3',
      releases: ['0.2.1-rc.5', '0.2.2-alpha.2', '0.2.2-alpha.3'],
      channels: [
        { tag: 'latest', kind: 'preview', version: '0.2.1-rc.5' },
        { tag: 'next', kind: 'preview', version: '0.2.1-rc.5' },
        { tag: 'alpha', kind: 'preview', version: '0.2.2-alpha.3' },
      ],
    }
  })
  assert.deepEqual(result, {
    latestVersion: '0.2.2-alpha.3',
    releases: ['0.2.1-rc.5', '0.2.2-alpha.2', '0.2.2-alpha.3'],
    previousReleases: ['0.2.1-rc.5', '0.2.2-alpha.2'],
    nextVersion: null,
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
  assert.match(smoke, /signal: AbortSignal\.timeout\(60000\)/)
  const nextChannel = workflow.split('\n  next-channel:\n')[1]
  assert.ok(nextChannel)
  assert.match(nextChannel, /needs\.resolve\.outputs\.next_version != ''/)
  assert.match(nextChannel, /@deepseek-ai\/dsh@\$DSH_VERSION/)
  assert.match(nextChannel, /scripts\/test-disposable-upgrade\.mjs/)
  const registryWorkflow = await readFile(new URL('../.github/workflows/registry.yml', import.meta.url), 'utf8')
  assert.match(registryWorkflow, /verify-dsh-upgrade-plan\.mjs docs\/ops\/dsh-native-market-rc5-desktop-20261030\.json/)
  assert.match(registryWorkflow, /verify-dsh-upgrade-plan\.mjs docs\/ops\/dsh-native-market-desktop-authority-20261101\.json/)
  assert.match(registryWorkflow, /verify-dsh-upgrade-plan\.mjs docs\/ops\/dsh-native-market-desktop-blocked-check-20261101\.json/)
  assert.match(registryWorkflow, /verify-dsh-upgrade-plan\.mjs docs\/ops\/dsh-native-market-desktop-guidance-ranking-20261103\.json/)
})

test('next channel must be a well-formed preview and newer than the active latest-three target', async () => {
  const resolve = async channels => resolveDshUpgradeMatrix(async () => ({
    authority: 'official-github-releases-and-npm-published-versions',
    releaseCount: 3,
    releases: ['0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3'],
    latestVersion: '0.2.1-rc.3',
    channels,
  }))
  assert.equal((await resolve([{ tag: 'next', kind: 'preview', version: '0.2.2-alpha.1' }])).nextVersion, '0.2.2-alpha.1')
  assert.equal((await resolve([{ tag: 'next', kind: 'preview', version: '0.2.1-rc.2' }])).nextVersion, null)
  await assert.rejects(resolve([{ tag: 'next', kind: 'stable', version: '0.2.0' }]), /next channel is malformed/)
  await assert.rejects(resolve([{ tag: 'next', kind: 'preview', version: 'not-a-version' }]), /next channel is malformed/)
  await assert.rejects(resolve([
    { tag: 'next', kind: 'preview', version: '0.2.0-rc.1' },
    { tag: 'next', kind: 'preview', version: '0.2.0-rc.2' },
  ]), /duplicate next channels/)
})

test('matrix resolver passes the short-lived credential only to authority fetch and never outputs it', async () => {
  const result = await resolveDshUpgradeMatrix(async options => {
    assert.equal(options.githubToken, 'fixture-short-lived-token')
    assert.equal(options.releaseCount, 3)
    return { authority: 'official-github-releases-and-npm-published-versions', releaseCount: 3,
      releases: ['0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3'], latestVersion: '0.2.1-rc.3', channels: [] }
  }, { githubToken: 'fixture-short-lived-token' })
  assert.doesNotMatch(JSON.stringify(result), /fixture-short-lived-token/)
})
