import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { handleHealthRequest, handleInventoryRequest, handleMarketRequest, handlePlanRequest } from '../src/panel.mjs'

function request(body, headers = {}) {
  const req = Readable.from([JSON.stringify(body)])
  req.method = 'POST'
  req.headers = {
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    'content-type': 'application/json',
    ...headers,
  }
  return req
}

function response() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(value = '') { this.body += String(value) },
  }
}

test('inventory endpoint returns a narrow read-only snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-panel-'))
  try {
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: {}, dsh: { profile: { bundles: [] } },
    }))
    const req = request({ profile: 'web' })
    const res = response()
    await handleInventoryRequest(req, res, { dshHome: root })
    assert.equal(res.status, 200)
    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.value.mode, 'read-only')
    assert.equal(payload.value.profile, 'web')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('inventory endpoint rejects a cross-origin request', async () => {
  const req = request({}, { origin: 'https://attacker.example' })
  const res = response()
  await handleInventoryRequest(req, res, { dshHome: '/unused' })
  assert.equal(res.status, 403)
  assert.equal(JSON.parse(res.body).ok, false)
})

test('market endpoint joins the GitHub catalog with installed state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-market-panel-'))
  try {
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(join(profileDir, 'node_modules', 'dsh-demo'), { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: { 'dsh-demo': '^1.0.0' }, dsh: { profile: { bundles: ['dsh-demo'] } },
    }))
    await writeFile(join(profileDir, 'node_modules', 'dsh-demo', 'package.json'), JSON.stringify({ name: 'dsh-demo', version: '1.0.0' }))
    const catalog = {
      schemaVersion: 1,
      registry: { name: 'Fixture' }, source: { kind: 'fixture' },
      entries: [{
        id: 'demo', name: 'Demo', packageName: 'dsh-demo', description: 'demo', repositoryUrl: 'https://github.com/example/demo',
        commit: 'a'.repeat(40), version: '2.0.0', categories: ['tools'], entryIds: ['demo'], status: 'approved',
        statusReason: null, compatibility: { dsh: null, node: null }, risk: { installScripts: [], review: 'fixture' },
      }],
    }
    const req = request({ query: 'demo' })
    const res = response()
    await handleMarketRequest(req, res, { dshHome: root, catalogService: { load: async () => catalog } })
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200)
    assert.equal(payload.value.entries[0].installed, true)
    assert.equal(payload.value.entries[0].updateAvailable, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('plan endpoint requires explicit operation intent header', async () => {
  let called = false
  const operationService = { createPlan: async () => { called = true; return { planId: 'one' } } }
  const denied = response()
  await handlePlanRequest(request({ action: 'install' }), denied, { operationService })
  assert.equal(denied.status, 403)
  assert.equal(called, false)
  const allowed = response()
  await handlePlanRequest(request({ action: 'install' }, { 'x-dsh-safe-intent': 'plan' }), allowed, { operationService })
  assert.equal(allowed.status, 200)
  assert.equal(JSON.parse(allowed.body).value.planId, 'one')
})

test('health endpoint audits installed catalog plugins and forwards permission choices', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-health-panel-'))
  try {
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(join(profileDir, 'node_modules', 'dsh-demo'), { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: { 'dsh-demo': 'git+https://github.com/example/demo.git#' + 'a'.repeat(40) },
      dsh: { profile: { bundles: ['dsh-demo'] } },
    }))
    await writeFile(join(profileDir, 'cordis.patch.yml'), '# fixture\n')
    await writeFile(join(profileDir, 'node_modules', 'dsh-demo', 'package.json'), JSON.stringify({ name: 'dsh-demo', version: '1.0.0' }))
    const catalog = { entries: [{
      id: 'demo', name: 'Demo', packageName: 'dsh-demo', commit: 'a'.repeat(40), version: '1.0.0',
      details: { permissions: { level: 'medium', files: 'read-only', network: 'none', commands: 'none', credentials: ['none'] } },
      risk: { installScripts: [] },
    }] }
    const req = request({ permissionDecisions: { 'dsh-demo': { files: true } } })
    const res = response()
    await handleHealthRequest(req, res, {
      dshHome: root, defaultProfile: 'web', catalogService: { load: async () => catalog },
      runner: { dumpConfig: async () => ({ ok: true }) },
    })
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200)
    assert.equal(payload.value.schemaVersion, 2)
    assert.equal(payload.value.plugins[0].permissions.status, 'accepted')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
