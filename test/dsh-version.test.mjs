import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDshVersionService } from '../src/dsh-version.mjs'

async function fixture(version = '0.1.0-rc.7') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-version-'))
  const cliRoot = join(root, 'apps', 'cli')
  const cliPath = join(cliRoot, 'src', 'bin.ts')
  await mkdir(join(cliRoot, 'src'), { recursive: true })
  await writeFile(join(cliRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  await writeFile(cliPath, '')
  return { root, cliPath }
}

test('DSH version check detects a newer official preview tag and keeps the stable channel explicit', async () => {
  const { root, cliPath } = await fixture()
  let requests = 0
  try {
    const service = createDshVersionService({
      cliPath, now: () => Date.parse('2026-08-18T09:00:00Z'),
      fetch: async (url, options) => {
        requests += 1
        assert.equal(url, 'https://registry.npmjs.org/@deepseek-ai%2Fdsh')
        assert.equal(options.headers.accept, 'application/vnd.npm.install-v1+json')
        return new Response(JSON.stringify({
          name: '@deepseek-ai/dsh',
          'dist-tags': { latest: '0.1.1-rc.2', next: '0.2.0-next.1', alpha: '0.1.2-alpha.5' },
          versions: { '0.1.1-rc.2': {}, '0.1.2-alpha.5': {}, '0.2.0-next.1': {} },
        }))
      },
    })
    assert.equal(service.peek(), null)
    const value = await service.inspect()
    assert.equal(value.currentVersion, '0.1.0-rc.7')
    assert.equal(value.latestVersion, '0.1.2-alpha.5')
    assert.equal(value.stableVersion, '0.1.1-rc.2')
    assert.equal(value.releaseChannel, 'preview')
    assert.equal(value.releaseTag, 'alpha')
    assert.equal(value.status, 'update-available')
    assert.equal(value.installationKind, 'source-checkout')
    assert.equal(value.upgrade.executable, false)
    assert.deepEqual(value.upgrade.command, ['npm', 'install', '--global', '@deepseek-ai/dsh@0.1.2-alpha.5'])
    assert.match(value.upgrade.reason, /不会修改 DSH 源码/)
    assert.equal(value.latestSource, 'npm-official:alpha')
    assert.equal(value.registryUrl, 'https://registry.npmjs.org/@deepseek-ai%2Fdsh')
    assert.equal(value.cacheTtlMs, 10 * 60_000)
    assert.equal(service.peek().latestVersion, '0.1.2-alpha.5')
    assert.equal(service.peek().cacheStatus, 'peek')
    assert.equal((await service.inspect()).cacheStatus, 'hit')
    assert.equal(requests, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('DSH version check fails closed on an untrusted registry identity', async () => {
  const { root, cliPath } = await fixture('0.1.0-rc.7')
  try {
    const service = createDshVersionService({
      cliPath, fetch: async () => new Response(JSON.stringify({ name: 'other-package', 'dist-tags': {}, versions: {} })),
    })
    await assert.rejects(service.inspect(), error => error.code === 'DSH_VERSION_REGISTRY_INVALID')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('DSH version check resolves a global launcher symlink before locating the package', async () => {
  const { root, cliPath } = await fixture('0.1.1-rc.2')
  try {
    const launcherDir = join(root, 'bin')
    const launcherPath = join(launcherDir, 'dsh')
    await mkdir(launcherDir)
    await symlink(cliPath, launcherPath)
    const service = createDshVersionService({
      cliPath: launcherPath,
      fetch: async () => new Response(JSON.stringify({
        name: '@deepseek-ai/dsh',
        'dist-tags': { latest: '0.1.1-rc.2' },
        versions: { '0.1.1-rc.2': {} },
      })),
    })
    const value = await service.inspect()
    assert.equal(value.currentVersion, '0.1.1-rc.2')
    assert.equal(value.status, 'current')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
