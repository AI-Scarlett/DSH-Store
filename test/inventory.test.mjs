import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  classifySpecifier,
  readProfileInventory,
  resolveProfileDirectory,
  validateProfileName,
} from '../src/inventory.mjs'

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-plugin-manager-'))
  const profile = join(root, 'profiles', 'web')
  await mkdir(join(profile, 'node_modules', 'demo-plugin'), { recursive: true })
  await mkdir(join(root, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-base'), { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { 'demo-plugin': '^1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'demo-plugin'] } },
  }, null, 2))
  await writeFile(join(profile, 'node_modules', 'demo-plugin', 'package.json'), JSON.stringify({
    name: 'demo-plugin', version: '1.2.3', description: 'fixture plugin',
    repository: { url: 'https://example.test/demo-plugin.git' },
  }))
  await writeFile(join(root, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-base', version: '0.1.0-rc.5',
  }))
  return { root, profile }
}

test('profile names fail closed on traversal and separators', () => {
  assert.equal(validateProfileName('web-dev_1.0'), 'web-dev_1.0')
  for (const value of ['../web', 'a/b', 'a\\b', '..', '']) {
    assert.throws(() => validateProfileName(value))
  }
  assert.equal(resolveProfileDirectory('/tmp/dsh-fixture', 'web'), '/tmp/dsh-fixture/profiles/web')
})

test('specifier classification distinguishes npm, git, and local sources', () => {
  assert.equal(classifySpecifier('^1.2.3'), 'npm')
  assert.equal(classifySpecifier('github:owner/repo'), 'git')
  assert.equal(classifySpecifier('git+https://example.test/repo.git'), 'git')
  assert.equal(classifySpecifier('link:../plugin'), 'link')
  assert.equal(classifySpecifier('file:../plugin'), 'file')
  assert.equal(classifySpecifier(null), 'bundle')
})

test('inventory merges bundle order and dependencies without writing fixture files', async () => {
  const { root, profile } = await makeFixture()
  try {
    const manifestPath = join(profile, 'package.json')
    const before = await readFile(manifestPath, 'utf8')
    const snapshot = await readProfileInventory({ dshHome: root, profile: 'web' })
    const after = await readFile(manifestPath, 'utf8')
    assert.equal(after, before)
    assert.equal(snapshot.mode, 'read-only')
    assert.deepEqual(snapshot.bundleOrder, ['@deepseek-ai/dsh-base', 'demo-plugin'])
    assert.equal(snapshot.plugins.length, 2)
    const official = snapshot.plugins.find(item => item.packageName === '@deepseek-ai/dsh-base')
    const demo = snapshot.plugins.find(item => item.packageName === 'demo-plugin')
    assert.equal(official.official, true)
    assert.equal(official.version, '0.1.0-rc.5')
    assert.equal(demo.official, false)
    assert.equal(demo.source, 'npm')
    assert.equal(demo.version, '1.2.3')
    assert.equal(demo.runtime.status, 'unverified')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

