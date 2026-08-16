import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { validateCatalog } from '../src/catalog.mjs'
import { createOperationService } from '../src/operations.mjs'

const demoEntry = {
  id: 'demo', name: 'Demo', packageName: 'dsh-demo', description: 'demo plugin',
  repositoryUrl: 'https://github.com/example/dsh-demo', defaultBranch: 'main', manifestPath: 'package.json',
  commit: 'b'.repeat(40), version: '2.0.0', categories: ['tools'], entryIds: ['demo-entry'], status: 'approved',
  compatibility: { dsh: '>=0.1.0', node: '>=22', systems: ['Linux'], profiles: ['web'] },
  details: {
    pluginType: 'feature', installSource: 'github', license: 'MIT',
    permissions: { level: 'medium', files: 'read-only', network: 'none', commands: 'none', credentials: ['none'] },
    externalDependencies: [], reviewStatus: 'automated-scan',
  },
  risk: { installScripts: [], review: 'curated-not-security-audited' },
}

function catalog() {
  return {
    ...validateCatalog({
      schemaVersion: 1,
      registry: { name: 'Fixture', repositoryUrl: 'https://github.com/example/registry', updatedAt: '2026-08-16T00:00:00Z', categories: { tools: '工具' } },
      entries: [demoEntry],
    }),
    source: { kind: 'fixture' },
  }
}

async function fixture({ installed = true, specifier = '^1.0.0' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-ops-'))
  const profile = join(root, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  const dependencies = installed ? { 'dsh-demo': specifier } : {}
  const bundles = installed ? ['dsh-demo'] : []
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'fixture', dependencies, dsh: { profile: { bundles } } }, null, 2) + '\n')
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  if (installed) {
    await mkdir(join(profile, 'node_modules', 'dsh-demo'), { recursive: true })
    await writeFile(join(profile, 'node_modules', 'dsh-demo', 'package.json'), JSON.stringify({ name: 'dsh-demo', version: '1.0.0' }))
  }
  return { root, profile }
}

function service(root, runner, options = {}) {
  return createOperationService({
    dshHome: root, defaultProfile: 'web', catalogService: { load: async () => catalog() },
    runner, mutationsEnabled: true,
    sourceVerifier: options.sourceVerifier ?? (async entry => ({ status: 'verified', packageName: entry.packageName })),
    sourceVerificationCacheTtlMs: options.sourceVerificationCacheTtlMs,
  })
}

test('source verification success is reused only for the same immutable catalog fingerprint', async () => {
  const { root } = await fixture({ installed: false })
  const runner = { plugin: async () => ({ ok: true }), dumpConfig: async () => ({ ok: true }) }
  let calls = 0
  try {
    const operations = service(root, runner, {
      sourceVerifier: async entry => {
        calls += 1
        return { status: 'verified', packageName: entry.packageName, verifiedAt: new Date().toISOString() }
      },
    })
    const first = await operations.createPlan({ action: 'install', pluginId: 'demo' })
    const second = await operations.createPlan({ action: 'install', pluginId: 'demo' })
    assert.equal(first.sourceVerification.cacheStatus, 'fresh')
    assert.equal(second.sourceVerification.cacheStatus, 'memory-cache')
    assert.equal(calls, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('source verification exposes safe actionable error categories without the verifier message', async () => {
  const { root } = await fixture({ installed: false })
  const runner = { plugin: async () => ({ ok: true }), dumpConfig: async () => ({ ok: true }) }
  try {
    const operations = service(root, runner, {
      sourceVerifier: async () => {
        throw Object.assign(new Error('secret upstream diagnostic'), { code: 'SOURCE_VERIFICATION_NETWORK' })
      },
    })
    await assert.rejects(
      operations.createPlan({ action: 'install', pluginId: 'demo' }),
      error => error.code === 'SOURCE_VERIFICATION_NETWORK'
        && /GitHub 网络暂时不可用/.test(error.message)
        && !/secret upstream diagnostic/.test(error.message),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('disable and enable require a typed plan and preserve external patch content', async () => {
  const { root, profile } = await fixture()
  const runner = { plugin: async () => ({ ok: true }), dumpConfig: async () => ({ ok: true, exitCode: 0 }) }
  try {
    const operations = service(root, runner)
    const disable = await operations.createPlan({ action: 'disable', pluginId: 'demo' })
    assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), '[]\n')
    const applied = await operations.execute({ planId: disable.planId, confirmation: disable.confirmation })
    assert.equal(applied.status, 'applied')
    assert.match(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), /id: demo-entry/)
    const enable = await operations.createPlan({ action: 'enable', pluginId: 'demo' })
    await operations.execute({ planId: enable.planId, confirmation: enable.confirmation })
    assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), '[]\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed GitHub install restores exact profile files', async () => {
  const { root, profile } = await fixture({ installed: false })
  const before = await readFile(join(profile, 'package.json'), 'utf8')
  let calls = 0
  const runner = {
    async plugin(_profile, args) {
      calls += 1
      if (args[0] === 'add') {
        await writeFile(join(profile, 'package.json'), '{"broken":true}\n')
        return { ok: false, exitCode: 1 }
      }
      return { ok: true, exitCode: 0 }
    },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  try {
    const operations = service(root, runner)
    const plan = await operations.createPlan({ action: 'install', pluginId: 'demo' })
    assert.match(plan.confirmation, /INSTALL dsh-demo web/)
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'rolled-back')
    assert.equal(result.rollback, 'succeeded')
    assert.deepEqual(result.rollbackDetails, { profileFiles: 'succeeded', dependencies: 'succeeded' })
    assert.equal(await readFile(join(profile, 'package.json'), 'utf8'), before)
    assert.equal(calls, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing pnpm reports a precise failure and does not run an unnecessary dependency restore', async () => {
  const { root, profile } = await fixture({ specifier: 'link:/tmp/dsh-demo-local-source' })
  const before = await readFile(join(profile, 'package.json'), 'utf8')
  const calls = []
  const runner = {
    async plugin(_profile, args) {
      calls.push(args)
      return { ok: false, exitCode: 127 }
    },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  try {
    const operations = service(root, runner)
    const plan = await operations.createPlan({ action: 'migrate', pluginId: 'demo' })
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'rolled-back')
    assert.equal(result.error.code, 'DSH_PNPM_NOT_FOUND')
    assert.equal(result.error.exitCode, 127)
    assert.equal(result.rollback, 'succeeded')
    assert.deepEqual(result.rollbackDetails, { profileFiles: 'succeeded', dependencies: 'not-required' })
    assert.deepEqual(calls, [['add', `git+https://github.com/example/dsh-demo.git#${'b'.repeat(40)}`]])
    assert.equal(await readFile(join(profile, 'package.json'), 'utf8'), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local development links require an explicit migration plan', async () => {
  const { root } = await fixture({ specifier: 'link:/tmp/dsh-demo-local-source' })
  const calls = []
  const runner = {
    async plugin(profile, args) {
      calls.push([profile, args])
      return { ok: true, exitCode: 0 }
    },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  try {
    const operations = service(root, runner)
    await assert.rejects(operations.createPlan({ action: 'update', pluginId: 'demo' }), error => error.code === 'LOCAL_SOURCE_PROTECTED')
    const plan = await operations.createPlan({ action: 'migrate', pluginId: 'demo' })
    assert.equal(plan.confirmation, 'MIGRATE dsh-demo web')
    assert.equal(plan.impact.restartRequired, true)
    assert.match(plan.impact.sourceTransition, /不删除或修改原本地目录/)
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'applied')
    assert.deepEqual(calls[0], ['web', ['add', `git+https://github.com/example/dsh-demo.git#${'b'.repeat(40)}`]])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('marketplace migration rejects non-local package sources', async () => {
  const { root } = await fixture()
  const runner = { plugin: async () => ({ ok: true }), dumpConfig: async () => ({ ok: true }) }
  try {
    const operations = service(root, runner)
    await assert.rejects(operations.createPlan({ action: 'migrate', pluginId: 'demo' }), error => error.code === 'MIGRATION_NOT_REQUIRED')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('operation plans are single-use and fail on confirmation mismatch', async () => {
  const { root } = await fixture()
  const runner = { plugin: async () => ({ ok: true }), dumpConfig: async () => ({ ok: true }) }
  try {
    const operations = service(root, runner)
    const plan = await operations.createPlan({ action: 'disable', pluginId: 'demo' })
    await assert.rejects(operations.execute({ planId: plan.planId, confirmation: 'wrong' }), /confirmation/)
    await assert.rejects(operations.execute({ planId: plan.planId, confirmation: plan.confirmation }), /missing or already used/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent Profile changes invalidate the plan before backup or mutation', async () => {
  const { root, profile } = await fixture()
  const runner = { plugin: async () => ({ ok: true }), dumpConfig: async () => ({ ok: true }) }
  try {
    const operations = service(root, runner)
    const plan = await operations.createPlan({ action: 'disable', pluginId: 'demo' })
    const manifestPath = join(profile, 'package.json')
    const changed = (await readFile(manifestPath, 'utf8')).replace('"fixture"', '"changed"')
    await writeFile(manifestPath, changed)
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'rolled-back')
    assert.equal(result.error.code, 'PRECONDITION_CHANGED')
    assert.equal(result.rollback, 'not-required')
    assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), '[]\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('health failure restores a managed enable-disable transaction', async () => {
  const { root, profile } = await fixture()
  const runner = { plugin: async () => ({ ok: true }), dumpConfig: async () => ({ ok: false, exitCode: 1 }) }
  try {
    const operations = service(root, runner)
    const plan = await operations.createPlan({ action: 'disable', pluginId: 'demo' })
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'rolled-back')
    assert.equal(result.error.code, 'HEALTH_CHECK_FAILED')
    assert.equal(result.rollback, 'succeeded')
    assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), '[]\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
