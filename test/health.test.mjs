import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkProfileHealth } from '../src/health.mjs'

const catalogEntry = {
  id: 'demo', name: 'Demo', packageName: 'dsh-demo', commit: 'a'.repeat(40), version: '1.0.0',
  details: { permissions: { level: 'high', files: 'write', network: 'specified-services', commands: 'none', credentials: ['api-key'] } },
  risk: { installScripts: ['prepare'] },
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-health-'))
  const profileDir = join(root, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'cordis.patch.yml'), '# user patch\n')
  return root
}

function inventory(plugins) {
  return { plugins, diagnostics: [] }
}

function plugin(overrides = {}) {
  return {
    packageName: 'dsh-demo', declaredAsBundle: true,
    declaredSpecifier: `git+https://github.com/example/demo.git#${'a'.repeat(40)}`,
    source: 'git', official: false, installed: true, version: '1.0.0', ...overrides,
  }
}

test('health report requires explicit per-permission user decisions', async () => {
  const root = await fixture()
  try {
    const base = {
      dshHome: root, profile: 'web', inventory: inventory([plugin()]),
      catalog: { entries: [catalogEntry] }, runner: { dumpConfig: async () => ({ ok: true }) },
    }
    const pending = await checkProfileHealth(base)
    assert.equal(pending.schemaVersion, 2)
    assert.equal(pending.status, 'action-required')
    assert.deepEqual(pending.plugins[0].permissions.pending, ['files', 'network', 'credentials'])
    assert.match(pending.verdict, /不能直接判定通过/)
    const revision = pending.plugins[0].permissions.decisionRevision
    assert.match(revision, /^[a-f0-9]{64}$/)

    const accepted = await checkProfileHealth({
      ...base, permissionDecisions: {
        'dsh-demo': { schemaVersion: 1, revision, decisions: { files: true, network: true, credentials: true } },
      },
    })
    assert.equal(accepted.plugins[0].permissions.status, 'accepted')
    assert.equal(accepted.plugins[0].status, 'warning')
    assert.equal(accepted.status, 'warning')

    const denied = await checkProfileHealth({
      ...base, permissionDecisions: {
        'dsh-demo': { schemaVersion: 1, revision, decisions: { files: false, network: true, credentials: true } },
      },
    })
    assert.equal(denied.status, 'blocked-by-user')
    assert.deepEqual(denied.plugins[0].permissions.denied, ['files'])

    const changed = await checkProfileHealth({
      ...base,
      inventory: inventory([plugin({ declaredSpecifier: `git+https://github.com/example/demo.git#${'b'.repeat(40)}` })]),
      catalog: { entries: [{ ...catalogEntry, commit: 'b'.repeat(40), version: '1.0.1' }] },
      permissionDecisions: {
        'dsh-demo': { schemaVersion: 1, revision, decisions: { files: true, network: true, credentials: true } },
      },
    })
    assert.equal(changed.plugins[0].permissions.status, 'review-required')
    assert.notEqual(changed.plugins[0].permissions.decisionRevision, revision)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('health report includes catalog-external installed plugins with unknown permission choice', async () => {
  const root = await fixture()
  try {
    const base = {
      dshHome: root, profile: 'web',
      inventory: inventory([plugin({ packageName: 'outside-plugin', declaredSpecifier: '^1.0.0', source: 'npm' })]),
      catalog: { entries: [] }, runner: { dumpConfig: async () => ({ ok: true }) },
    }
    const pending = await checkProfileHealth(base)
    assert.equal(pending.summary.uncatalogued, 1)
    assert.equal(pending.plugins[0].permissions.status, 'unknown')
    const denied = await checkProfileHealth({
      ...base,
      permissionDecisions: {
        'outside-plugin': {
          schemaVersion: 1, revision: pending.plugins[0].permissions.decisionRevision, decisions: { acceptUnknown: false },
        },
      },
    })
    assert.equal(denied.plugins[0].status, 'blocked-by-user')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
