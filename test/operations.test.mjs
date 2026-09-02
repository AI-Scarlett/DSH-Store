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

function catalog(entry = demoEntry) {
  return {
    ...validateCatalog({
      schemaVersion: 1,
      registry: {
        name: 'Fixture', repositoryUrl: 'https://github.com/example/registry', updatedAt: '2026-08-16T00:00:00Z', categories: { tools: '工具' },
        trustPolicy: { candidateInstallDisabled: true, unknownIsNotVerified: true, promotionIndependentOfVerification: true },
      },
      entries: [entry],
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
    dshHome: root, defaultProfile: 'web', catalogService: { load: async () => catalog(options.entry) },
    runner, mutationsEnabled: true,
    sourceVerifier: options.sourceVerifier ?? (async entry => ({ status: 'verified', packageName: entry.packageName })),
    sourceVerificationCacheTtlMs: options.sourceVerificationCacheTtlMs,
    sourceUpdateService: options.sourceUpdateService,
    runtimeInstanceId: options.runtimeInstanceId,
  })
}

test('source-verified update plan pins the locally approved candidate commit', async () => {
  const { root } = await fixture({ specifier: `git+https://github.com/example/dsh-demo.git#${'b'.repeat(40)}` })
  const calls = []
  const candidate = { ...demoEntry, commit: 'c'.repeat(40), version: '3.0.0' }
  const runner = {
    plugin: async (_profile, args) => { calls.push(args); return { ok: true, exitCode: 0 } },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  try {
    const operations = service(root, runner, {
      sourceUpdateService: { approvedCandidate: (_entry, commit) => {
        assert.equal(commit, candidate.commit)
        return candidate
      } },
    })
    const plan = await operations.createPlan({ action: 'update', pluginId: 'demo', sourceCommit: candidate.commit })
    assert.equal(plan.plugin.commit, candidate.commit)
    assert.equal(plan.plugin.targetVersion, '3.0.0')
    assert.equal(plan.plugin.sourceUpdate, true)
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'applied')
    assert.deepEqual(calls[0], ['add', '--ignore-scripts', `git+https://github.com/example/dsh-demo.git#${candidate.commit}`])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('marketplace self-update ignores every lifecycle script instead of widening allow-build', async () => {
  const { root, profile } = await fixture({ installed: false })
  const commit = 'd'.repeat(40)
  const managerEntry = {
    ...demoEntry,
    id: 'dsh-safe-plugin-manager',
    name: '安全插件商城',
    packageName: 'dsh-safe-plugin-manager',
    repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store',
    commit,
    version: '0.8.10',
    entryIds: ['dsh-safe-plugin-manager'],
    risk: { installScripts: [], review: 'owner-curated-not-security-audited' },
  }
  const profilePath = join(profile, 'package.json')
  const profileManifest = JSON.parse(await readFile(profilePath, 'utf8'))
  profileManifest.dependencies['dsh-safe-plugin-manager'] = `github:AI-Scarlett/DSH-Store#${'c'.repeat(40)}`
  profileManifest.dsh.profile.bundles.push('dsh-safe-plugin-manager')
  await writeFile(profilePath, `${JSON.stringify(profileManifest, null, 2)}\n`)
  const installedDir = join(profile, 'node_modules', 'dsh-safe-plugin-manager')
  await mkdir(installedDir, { recursive: true })
  await writeFile(join(installedDir, 'package.json'), JSON.stringify({ name: 'dsh-safe-plugin-manager', version: '0.8.9' }))
  const calls = []
  const runner = {
    plugin: async (_profile, args) => { calls.push(args); return { ok: true, exitCode: 0 } },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  try {
    const operations = service(root, runner, { entry: managerEntry })
    const plan = await operations.createPlan({ action: 'update', pluginId: managerEntry.id })
    assert.equal(plan.impact.lifecyclePolicy, 'ignore-all-scripts')
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'applied')
    assert.deepEqual(calls[0], ['add', '--ignore-scripts', `git+https://github.com/AI-Scarlett/DSH-Store.git#${commit}`])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('lifecycle-free plugin updates ignore unrelated Git prepare scripts already present in the Profile', async () => {
  const { root } = await fixture({ specifier: `git+https://github.com/example/dsh-demo.git#${'a'.repeat(40)}` })
  const calls = []
  const runner = {
    plugin: async (_profile, args) => {
      calls.push(args)
      if (!args.includes('--ignore-scripts')) return {
        ok: false, exitCode: 1,
        stderr: 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED unrelated-git-plugin',
      }
      return { ok: true, exitCode: 0 }
    },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  try {
    const operations = service(root, runner)
    const plan = await operations.createPlan({ action: 'update', pluginId: 'demo' })
    assert.equal(plan.impact.lifecyclePolicy, 'ignore-all-scripts')
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'applied')
    assert.deepEqual(calls, [[
      'add', '--ignore-scripts', `git+https://github.com/example/dsh-demo.git#${'b'.repeat(40)}`,
    ]])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('high-risk source update requires local acceptance and binds warnings to the typed plan', async () => {
  const { root } = await fixture({ specifier: `git+https://github.com/example/dsh-demo.git#${'b'.repeat(40)}` })
  const candidate = {
    ...demoEntry, commit: 'c'.repeat(40), version: '3.0.0',
    sourceReview: { status: 'user-review-required', warnings: ['新增 Shell 命令能力'] },
  }
  const runner = { plugin: async () => ({ ok: true, exitCode: 0 }), dumpConfig: async () => ({ ok: true, exitCode: 0 }) }
  try {
    const operations = service(root, runner, {
      sourceUpdateService: { approvedCandidate: (_entry, _commit, options) => {
        if (options.userAcceptedRisk !== true) throw Object.assign(new Error('risk not accepted'), { code: 'SOURCE_UPDATE_RISK_NOT_ACCEPTED' })
        return candidate
      } },
    })
    await assert.rejects(
      operations.createPlan({ action: 'update', pluginId: 'demo', sourceCommit: candidate.commit }),
      error => error.code === 'SOURCE_UPDATE_RISK_NOT_ACCEPTED',
    )
    const plan = await operations.createPlan({
      action: 'update', pluginId: 'demo', sourceCommit: candidate.commit, sourceRiskAccepted: true,
    })
    assert.match(plan.confirmation, /^UPDATE-RISK dsh-demo web c{12}$/)
    assert.deepEqual(plan.impact.sourceReview.warnings, ['新增 Shell 命令能力'])
    assert.equal(plan.plugin.sourceReview.status, 'user-review-required')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

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
  const calls = []
  const runner = {
    async plugin(_profile, args) {
      calls.push(args)
      if (args[0] === 'add') {
        await writeFile(join(profile, 'package.json'), '{"broken":true}\n')
        return { ok: false, exitCode: 1 }
      }
      return { ok: true, exitCode: 0 }
    },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  try {
    const operations = service(root, runner, { runtimeInstanceId: 'boot-fixture' })
    const plan = await operations.createPlan({ action: 'install', pluginId: 'demo' })
    assert.match(plan.confirmation, /INSTALL dsh-demo web/)
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'rolled-back')
    assert.equal(result.rollback, 'succeeded')
    assert.deepEqual(result.rollbackDetails, { profileFiles: 'succeeded', dependencies: 'succeeded' })
    assert.equal(await readFile(join(profile, 'package.json'), 'utf8'), before)
    assert.deepEqual(calls, [
      ['add', '--ignore-scripts', `git+https://github.com/example/dsh-demo.git#${'b'.repeat(40)}`],
      ['install', '--offline', '--ignore-scripts'],
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed GitHub prepare returns a bounded actionable diagnostic without command output', async () => {
  const { root } = await fixture({ installed: false })
  const runner = {
    async plugin(_profile, args) {
      if (args[0] === 'add') return {
        ok: false, exitCode: 1,
        stderr: 'token=must-not-leak\nERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED private/path',
      }
      return { ok: true, exitCode: 0 }
    },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  try {
    const operations = service(root, runner)
    const plan = await operations.createPlan({ action: 'install', pluginId: 'demo' })
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.error.code, 'DSH_PLUGIN_COMMAND_FAILED')
    assert.equal(result.error.diagnostic.code, 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')
    assert.match(result.error.diagnostic.message, /不一定来自当前目标插件/)
    assert.match(result.error.diagnostic.message, /不会为整个 Profile 自动放宽/)
    assert.doesNotMatch(JSON.stringify(result), /must-not-leak|private\/path/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reviewed lifecycle plugins receive an exact package-scoped pnpm build allowance', async () => {
  const { root } = await fixture({ installed: false })
  const calls = []
  const lifecycleEntry = { ...demoEntry, risk: { ...demoEntry.risk, installScripts: ['prepare'] } }
  const runner = {
    plugin: async (_profile, args) => { calls.push(args); return { ok: true, exitCode: 0 } },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  try {
    const operations = service(root, runner, { entry: lifecycleEntry })
    const plan = await operations.createPlan({ action: 'install', pluginId: 'demo' })
    assert.deepEqual(plan.impact.installScripts, ['prepare'])
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'applied')
    assert.deepEqual(calls[0], [
      'add', '--allow-build=dsh-demo', `git+https://github.com/example/dsh-demo.git#${'b'.repeat(40)}`,
    ])
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
    assert.deepEqual(calls, [['add', '--ignore-scripts', `git+https://github.com/example/dsh-demo.git#${'b'.repeat(40)}`]])
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
    const operations = service(root, runner, { runtimeInstanceId: 'boot-fixture' })
    await assert.rejects(operations.createPlan({ action: 'update', pluginId: 'demo' }), error => error.code === 'LOCAL_SOURCE_PROTECTED')
    const plan = await operations.createPlan({ action: 'migrate', pluginId: 'demo' })
    assert.equal(plan.confirmation, 'MIGRATE dsh-demo web')
    assert.equal(plan.impact.restartRequired, true)
    assert.match(plan.impact.sourceTransition, /不删除或修改原本地目录/)
    const result = await operations.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'applied')
    assert.equal(result.runtimeInstanceId, 'boot-fixture')
    assert.equal(result.targetVersion, '2.0.0')
    assert.deepEqual(calls[0], ['web', ['add', '--ignore-scripts', `git+https://github.com/example/dsh-demo.git#${'b'.repeat(40)}`]])
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
