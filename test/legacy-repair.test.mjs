import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  LEGACY_REPAIR_ERROR, LEGACY_REPAIR_PACKAGE, createLegacyRepairService, legacyRepairSpecifier,
} from '../src/legacy-repair.mjs'

const OLD_COMMIT = '0bc733064bfc8ff16f6e8144188a7ac563092e12'
const TARGET_COMMIT = 'b'.repeat(40)
const TARGET_VERSION = '0.8.10'

function targetManifest(overrides = {}) {
  return {
    name: LEGACY_REPAIR_PACKAGE,
    version: TARGET_VERSION,
    type: 'module',
    main: './src/index.mjs',
    bin: { 'dsh-store-repair': './bin/dsh-store-repair.mjs' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    scripts: { check: 'node --check src/index.mjs' },
    ...overrides,
  }
}

function response(manifest = targetManifest()) {
  return new Response(JSON.stringify(manifest), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function fixture({ guardian = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-store-legacy-repair-'))
  const profileDir = join(root, 'profiles', 'web')
  const managerDir = join(profileDir, 'node_modules', LEGACY_REPAIR_PACKAGE)
  const blockerDir = join(profileDir, 'node_modules', 'dsh-plugin-agent-workflow')
  await mkdir(managerDir, { recursive: true })
  await mkdir(blockerDir, { recursive: true })
  const packageDocument = {
    name: 'fixture-profile',
    dependencies: {
      [LEGACY_REPAIR_PACKAGE]: `github:AI-Scarlett/DSH-Store#${OLD_COMMIT}`,
      'dsh-plugin-agent-workflow': `github:example/dsh-plugin-agent-workflow#${'a'.repeat(40)}`,
    },
    dsh: { profile: { bundles: [LEGACY_REPAIR_PACKAGE, 'dsh-plugin-agent-workflow'] } },
  }
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify(packageDocument, null, 2)}\n`)
  await writeFile(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await writeFile(join(profileDir, 'pnpm-workspace.yaml'), "packages:\n  - .\nallowBuilds:\n  'dsh-better-sidebar@0.12.2': true\n")
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(managerDir, 'package.json'), JSON.stringify({
    ...targetManifest(), version: '0.8.5', bin: undefined,
  }))
  await writeFile(join(managerDir, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(blockerDir, 'package.json'), JSON.stringify({
    name: 'dsh-plugin-agent-workflow', version: '0.1.0', scripts: { prepare: 'npm run build' },
  }))
  if (guardian) {
    const guardianDir = join(root, 'dsh-safe-plugin-manager', 'guardian')
    await mkdir(guardianDir, { recursive: true })
    await writeFile(join(guardianDir, 'status.json'), `${JSON.stringify({
      schemaVersion: 1, installed: true, available: true, state: 'healthy',
      heartbeatAt: '2026-09-02T08:00:00.000Z', profile: 'web', pid: 12345,
      owner: 'guardian', stableForMs: 60_000, health: { profile: 'web', bootId: 'old-boot' },
    })}\n`)
  }
  return { root, profileDir }
}

async function applyTarget(profileDir) {
  const profilePath = join(profileDir, 'package.json')
  const profile = JSON.parse(await readFile(profilePath, 'utf8'))
  profile.dependencies[LEGACY_REPAIR_PACKAGE] = legacyRepairSpecifier(TARGET_COMMIT)
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`)
  const managerDir = join(profileDir, 'node_modules', LEGACY_REPAIR_PACKAGE)
  await writeFile(join(managerDir, 'package.json'), JSON.stringify(targetManifest()))
  await writeFile(join(managerDir, 'cordis.patch.yml'), '[]\n')
}

function service(root, runner, options = {}) {
  return createLegacyRepairService({
    dshHome: root, runner, now: options.now ?? (() => Date.parse('2026-09-02T08:00:05.000Z')),
    fetch: options.fetch ?? (async () => response()),
    randomUUID: (() => { let value = 0; return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}` })(),
    delay: options.delay, restartTimeoutMs: options.restartTimeoutMs ?? 5_000, restartPollMs: 1,
  })
}

test('legacy repair creates a fixed plan that exposes blockers without returning Profile contents', async () => {
  const { root } = await fixture()
  const runner = { command: '/fixture/dsh', plugin: async () => ({ ok: true }), dumpConfig: async () => ({ ok: true }) }
  try {
    const repair = service(root, runner)
    const plan = await repair.createPlan({ profile: 'web', target: { commit: TARGET_COMMIT, version: TARGET_VERSION } })
    assert.equal(plan.current.version, '0.8.5')
    assert.equal(plan.target.commit, TARGET_COMMIT)
    assert.equal(plan.impact.command.file, '/fixture/dsh')
    assert.deepEqual(plan.impact.command.args, [
      'plugin', '--profile', 'web', 'add', '--ignore-scripts', legacyRepairSpecifier(TARGET_COMMIT),
    ])
    assert.equal(plan.impact.lifecyclePolicy, 'ignore-all-scripts')
    assert.deepEqual(plan.detectedLifecyclePackages, [{
      packageName: 'dsh-plugin-agent-workflow', version: '0.1.0', scripts: ['prepare'],
    }])
    assert.equal(JSON.stringify(plan).includes('npm run build'), false)
    assert.match(plan.confirmation, /^REPAIR DSH STORE web 0\.8\.10 b{7}$/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy repair updates with ignore-scripts, checks config and leaves an explicit restart gate without Guardian', async () => {
  const { root, profileDir } = await fixture()
  const calls = []
  const runner = {
    command: '/fixture/dsh',
    plugin: async (_profile, args) => { calls.push(args); await applyTarget(profileDir); return { ok: true, exitCode: 0 } },
    dumpConfig: async profile => { calls.push(['dump-config', profile]); return { ok: true, exitCode: 0 } },
  }
  try {
    const repair = service(root, runner)
    const plan = await repair.createPlan({ profile: 'web', target: { commit: TARGET_COMMIT, version: TARGET_VERSION } })
    const result = await repair.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'applied-restart-required')
    assert.deepEqual(calls[0], ['add', '--ignore-scripts', legacyRepairSpecifier(TARGET_COMMIT)])
    assert.deepEqual(calls[1], ['dump-config', 'web'])
    const installed = JSON.parse(await readFile(join(profileDir, 'node_modules', LEGACY_REPAIR_PACKAGE, 'package.json'), 'utf8'))
    assert.equal(installed.version, TARGET_VERSION)
    assert.ok((await readFile(join(result.backupDir, 'manifest.json'), 'utf8')).includes(OLD_COMMIT))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy repair restores exact Profile files and dependencies after the official command fails', async () => {
  const { root, profileDir } = await fixture()
  const before = await Promise.all(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']
    .map(name => readFile(join(profileDir, name))))
  const calls = []
  const runner = {
    command: '/fixture/dsh',
    plugin: async (_profile, args) => {
      calls.push(args)
      if (args[0] === 'add') {
        await applyTarget(profileDir)
        return { ok: false, exitCode: 1, stderr: `${LEGACY_REPAIR_ERROR}: blocked` }
      }
      return { ok: true, exitCode: 0 }
    },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  try {
    const repair = service(root, runner)
    const plan = await repair.createPlan({ profile: 'web', target: { commit: TARGET_COMMIT, version: TARGET_VERSION } })
    const result = await repair.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'rolled-back')
    assert.equal(result.error.diagnostic, LEGACY_REPAIR_ERROR)
    assert.equal(result.rollback, 'profile-restored')
    assert.equal(result.dependencyRestore, 'succeeded')
    assert.deepEqual(calls[1], ['install', '--offline', '--ignore-scripts'])
    const after = await Promise.all(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']
      .map(name => readFile(join(profileDir, name))))
    assert.deepEqual(after.map(bytes => createHash('sha256').update(bytes).digest('hex')),
      before.map(bytes => createHash('sha256').update(bytes).digest('hex')))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy repair rolls back a completed package update when DSH config composition fails', async () => {
  const { root, profileDir } = await fixture()
  const before = await Promise.all(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']
    .map(name => readFile(join(profileDir, name))))
  const calls = []
  const runner = {
    command: '/fixture/dsh',
    plugin: async (_profile, args) => {
      calls.push(args)
      if (args[0] === 'add') await applyTarget(profileDir)
      return { ok: true, exitCode: 0 }
    },
    dumpConfig: async profile => {
      calls.push(['dump-config', profile])
      return { ok: false, exitCode: 1 }
    },
  }
  try {
    const repair = service(root, runner)
    const plan = await repair.createPlan({ profile: 'web', target: { commit: TARGET_COMMIT, version: TARGET_VERSION } })
    const result = await repair.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'rolled-back')
    assert.equal(result.error.code, 'REPAIR_CONFIG_FAILED')
    assert.equal(result.rollback, 'profile-restored')
    assert.equal(result.dependencyRestore, 'succeeded')
    assert.deepEqual(calls, [
      ['add', '--ignore-scripts', legacyRepairSpecifier(TARGET_COMMIT)],
      ['dump-config', 'web'],
      ['install', '--offline', '--ignore-scripts'],
    ])
    const after = await Promise.all(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']
      .map(name => readFile(join(profileDir, name))))
    assert.deepEqual(after.map(bytes => createHash('sha256').update(bytes).digest('hex')),
      before.map(bytes => createHash('sha256').update(bytes).digest('hex')))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy repair rejects concurrent Profile changes before backup or package mutation', async () => {
  const { root, profileDir } = await fixture()
  let calls = 0
  const runner = { command: '/fixture/dsh', plugin: async () => { calls += 1; return { ok: true } }, dumpConfig: async () => ({ ok: true }) }
  try {
    const repair = service(root, runner)
    const plan = await repair.createPlan({ profile: 'web', target: { commit: TARGET_COMMIT, version: TARGET_VERSION } })
    await writeFile(join(profileDir, 'cordis.patch.yml'), '# concurrent change\n')
    const result = await repair.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'rolled-back')
    assert.equal(result.error.code, 'REPAIR_PRECONDITION_CHANGED')
    assert.equal(result.backupDir, null)
    assert.equal(calls, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy repair refuses a target with lifecycle scripts or a mismatched manifest', async () => {
  const { root } = await fixture()
  const runner = { command: '/fixture/dsh', plugin: async () => ({ ok: true }), dumpConfig: async () => ({ ok: true }) }
  try {
    const scripted = service(root, runner, { fetch: async () => response(targetManifest({ scripts: { prepare: 'npm run build' } })) })
    await assert.rejects(
      scripted.createPlan({ profile: 'web', target: { commit: TARGET_COMMIT, version: TARGET_VERSION } }),
      error => error.code === 'REPAIR_TARGET_HAS_SCRIPTS',
    )
    const mismatch = service(root, runner, { fetch: async () => response(targetManifest({ version: '9.9.9' })) })
    await assert.rejects(
      mismatch.createPlan({ profile: 'web', target: { commit: TARGET_COMMIT, version: TARGET_VERSION } }),
      error => error.code === 'REPAIR_SOURCE_MISMATCH',
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy repair writes a Guardian request and waits for a different healthy Boot ID', async () => {
  const { root, profileDir } = await fixture({ guardian: true })
  let delayed = false
  const runner = {
    command: '/fixture/dsh',
    plugin: async () => { await applyTarget(profileDir); return { ok: true, exitCode: 0 } },
    dumpConfig: async () => ({ ok: true, exitCode: 0 }),
  }
  const repair = service(root, runner, {
    delay: async () => {
      if (delayed) return
      delayed = true
      const path = join(root, 'dsh-safe-plugin-manager', 'guardian', 'status.json')
      await writeFile(path, `${JSON.stringify({
        schemaVersion: 1, installed: true, available: true, state: 'healthy',
        heartbeatAt: '2026-09-02T08:00:05.000Z', profile: 'web', pid: 54321,
        owner: 'guardian', stableForMs: 30_000, health: { profile: 'web', bootId: 'new-boot' },
      })}\n`)
    },
  })
  try {
    const plan = await repair.createPlan({ profile: 'web', target: { commit: TARGET_COMMIT, version: TARGET_VERSION } })
    assert.equal(plan.guardian.available, true)
    const result = await repair.execute({ planId: plan.planId, confirmation: plan.confirmation })
    assert.equal(result.status, 'applied-runtime-verified')
    assert.equal(result.restart, 'verified')
    const request = JSON.parse(await readFile(join(root, 'dsh-safe-plugin-manager', 'guardian', 'request.json'), 'utf8'))
    assert.equal(request.profile, 'web')
    assert.equal(request.previousBootId, 'old-boot')
  } finally { await rm(root, { recursive: true, force: true }) }
})
