import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const project = new URL('../', import.meta.url)

async function manifest() {
  return JSON.parse(await readFile(new URL('package.json', project), 'utf8'))
}

async function fixture() {
  return JSON.parse(await readFile(new URL('fixtures/official-client-packages.json', import.meta.url), 'utf8'))
}

async function clientSource() {
  return readFile(new URL('src/client.js', project), 'utf8')
}

test('every declared client dependency resolves in the official host runtime', async () => {
  const [pkg, official] = await Promise.all([manifest(), fixture()])
  const hostPackages = new Set(official.hostInventory.hostPackages)
  const seedModules = new Set(official.platformSeedModules)
  for (const name of pkg.dsh.client.inject) {
    assert.ok(hostPackages.has(name) || seedModules.has(name),
      `${name} is neither an official host client package nor a platform seed module, so the browser module loader cannot resolve it`)
  }
})

test('the declared client dependency set contains no package the host runtime dropped', async () => {
  const [pkg, official] = await Promise.all([manifest(), fixture()])
  for (const name of official.hostInventory.absentPackages) {
    assert.ok(!pkg.dsh.client.inject.includes(name),
      `${name} is absent from the official host runtime and cannot be a declared client dependency`)
    assert.equal(pkg.peerDependencies[name], undefined,
      `${name} is absent from the official host runtime and cannot be a declared peer`)
  }
})

test('the client injects only services an official package or seed module provides', async () => {
  const [pkg, official, client] = await Promise.all([manifest(), fixture(), clientSource()])
  const declared = new Set(pkg.dsh.client.inject)
  const match = /const inject = (\[[^\]]*\])/.exec(client)
  assert.ok(match, 'the client must declare its service dependencies in one place')
  const services = JSON.parse(match[1].replaceAll("'", '"'))
  assert.deepEqual(services, ['slots', 'remote', 'remote.pluginManager'])
  for (const service of services) {
    const provider = official.serviceProviders[service]
    assert.ok(provider, `${service} has no recorded official provider`)
    if (provider.package !== null) {
      assert.ok(declared.has(provider.package),
        `${service} comes from ${provider.package}; the official loader only supplies a service to a bundle that declares its package`)
    }
    if (provider.seed !== undefined) {
      assert.ok(official.platformSeedModules.includes(provider.seed),
        `${service} is seeded by ${provider.seed}, which the official platform seed table must publish`)
    }
  }
})

test('the remote service provider is declared and its peer range matches its published versions', async () => {
  const [pkg, official] = await Promise.all([manifest(), fixture()])
  const provider = '@deepseek-ai/dsh-api-remotes'
  assert.ok(pkg.dsh.client.inject.includes(provider))
  const published = new Set(official.packages[provider])
  const alternatives = pkg.peerDependencies[provider].split(' || ')
  for (const release of ['0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-alpha.2', '0.2.2-alpha.3', '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3']) {
    assert.ok(published.has(release), `${provider} must publish ${release} for the declared range to resolve`)
    assert.ok(alternatives.includes(release), `${provider} must declare ${release} explicitly`)
  }
})

test('the client hard requirement resolves to a platform seed module', async () => {
  const [official, client] = await Promise.all([fixture(), clientSource()])
  const required = [...client.matchAll(/require\('([^']+)'\)/g)].map(match => match[1])
  assert.ok(required.includes('@deepseek-ai/dsh-client-ui-primitives'))
  for (const name of required) {
    assert.ok(official.platformSeedModules.includes(name),
      `${name} is required by the client and must be a platform seed module the official frontend publishes`)
  }
})
