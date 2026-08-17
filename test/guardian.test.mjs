import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createGuardianService } from '../src/guardian.mjs'

test('guardian status fails closed without an external heartbeat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-'))
  try {
    const service = createGuardianService({ dshHome: root })
    const status = await service.status()
    assert.equal(status.available, false)
    assert.equal(status.errorCode, 'GUARDIAN_NOT_INSTALLED')
    await assert.rejects(service.requestRestart({ profile: 'web', oldPid: 42 }), error => error.code === 'GUARDIAN_NOT_INSTALLED')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guardian installation uses a single-use plan and fixed launchctl arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-guardian-'))
  try {
    const launchAgentsDir = join(root, 'LaunchAgents'); const daemonSource = join(root, 'daemon.mjs')
    await mkdir(launchAgentsDir); await writeFile(daemonSource, 'export {}\n')
    const calls = []
    const service = createGuardianService({
      dshHome: root, launchAgentsDir, daemonSource, allowNonDarwin: true,
      restartSpec: profile => ({ nodePath: '/node', runtimeArgs: ['--import', '/loader'], cliPath: '/dsh.js', cwd: '/repo', profile }),
      execFile: async (file, args) => { calls.push([file, args]) },
    })
    const plan = await service.createInstallPlan({ profile: 'web' })
    await assert.rejects(service.executeInstall({ planId: plan.planId, confirmation: 'wrong' }), error => error.code === 'GUARDIAN_CONFIRMATION_MISMATCH')
    const accepted = await service.createInstallPlan({ profile: 'web' })
    const result = await service.executeInstall({ planId: accepted.planId, confirmation: accepted.confirmation })
    assert.equal(result.status, 'installed')
    assert.deepEqual(calls.map(item => item[1][0]), ['bootout', 'bootstrap', 'bootout'])
    const plist = await readFile(join(launchAgentsDir, 'com.ai-scarlett.dsh-guardian.plist'), 'utf8')
    assert.match(plist, /<string>\/node<\/string>/)
    assert.doesNotMatch(plist, /bash|-c/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
