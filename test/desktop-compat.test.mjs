import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { resolveHostOptions } from '../src/index.mjs'
import { createRuntimeStatus } from '../src/runtime.mjs'
import {
  handleExecuteRequest, handleGuardianExecuteRequest, handleGuardianPlanRequest,
  handleGuardianRequest, handleInventoryRequest, handlePlanRequest,
  handleRestartExecuteRequest, handleRestartPlanRequest, handleRuntimeRequest,
} from '../src/panel.mjs'

function request(body = {}, intent = null) {
  const req = Readable.from([JSON.stringify(body)])
  req.method = 'POST'
  req.headers = {
    host: '127.0.0.1:40000', origin: 'http://127.0.0.1:40000',
    'content-type': 'application/json',
    ...(intent ? { 'x-dsh-safe-intent': intent } : {}),
  }
  return req
}

function response() {
  return {
    status: null, body: '',
    writeHead(status) { this.status = status },
    end(value = '') { this.body += String(value) },
  }
}

test('official Desktop context binds inventory to Desktop and disables Store mutations', () => {
  const ctx = { profileContext: { name: 'desktop', home: '/disposable/dsh-home', installAnchor: '/disposable/runtime/package.json' } }
  const options = resolveHostOptions(ctx, { defaultProfile: 'web', dshHome: '/wrong-home', mutationsEnabled: true })
  assert.equal(options.defaultProfile, 'desktop')
  assert.equal(options.dshHome, ctx.profileContext.home)
  assert.equal(options.dshManifestPath, ctx.profileContext.installAnchor)
  assert.equal(options.mutationsEnabled, false)
  assert.equal(options.desktopMode, true)
  assert.equal(options.dshCliPath, null)
  const runtime = createRuntimeStatus({ profile: 'desktop', desktopMode: true, restartCommand: [] })
  assert.equal(runtime.restartSupported, false)
  assert.equal(runtime.restartMode, 'official-desktop')
  assert.deepEqual(runtime.restartCommand, [])
})

test('Desktop rejects every Store write endpoint before calling a mutation service', async () => {
  const forbidden = () => { throw new Error('mutation service must not run') }
  const options = {
    desktopMode: true,
    operationService: { createPlan: forbidden, start: forbidden },
    restartService: { createPlan: forbidden, execute: forbidden },
    guardianService: { createInstallPlan: forbidden, executeInstall: forbidden },
  }
  const endpoints = [
    [handlePlanRequest, 'plan'], [handleExecuteRequest, 'execute'],
    [handleRestartPlanRequest, 'restart-plan'], [handleRestartExecuteRequest, 'restart-execute'],
    [handleGuardianPlanRequest, 'guardian-plan'], [handleGuardianExecuteRequest, 'guardian-execute'],
  ]
  for (const [handler, intent] of endpoints) {
    const res = response()
    await handler(request({ profile: 'web' }, intent), res, options)
    assert.equal(res.status, 409)
    assert.equal(JSON.parse(res.body).error.code, 'DESKTOP_MUTATION_UNSUPPORTED')
  }
})

test('Desktop inventory reads its own Profile and refuses a forged Web Profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-store-desktop-'))
  try {
    const dir = join(root, 'profiles', 'desktop')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'fixture-desktop', dependencies: {}, dsh: { profile: { bundles: [] } },
    }))
    const options = { desktopMode: true, defaultProfile: 'desktop', dshHome: root }
    const ok = response()
    await handleInventoryRequest(request(), ok, options)
    assert.equal(ok.status, 200)
    assert.equal(JSON.parse(ok.body).value.profile, 'desktop')
    const denied = response()
    await handleInventoryRequest(request({ profile: 'web' }), denied, options)
    assert.equal(denied.status, 409)
    const runtime = response()
    await handleRuntimeRequest(request({ profile: 'web' }), runtime, {
      ...options, runtimeStatus: createRuntimeStatus({ profile: 'desktop', desktopMode: true }),
    })
    assert.equal(JSON.parse(runtime.body).error.code, 'DESKTOP_PROFILE_MISMATCH')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Desktop Guardian status reports official ownership without probing launchd', async () => {
  const res = response()
  await handleGuardianRequest(request(), res, { desktopMode: true, guardianService: { status: () => { throw new Error('must not probe') } } })
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.body).value.errorCode, 'OFFICIAL_DESKTOP_OWNS_HOST')
})
