import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import {
  handleDshVersionRequest, handleHealthRequest, handleInventoryRequest, handleMarketRequest, handlePlanRequest, handleSourceUpdateRequest,
  handleRestartExecuteRequest, handleRestartPlanRequest, handleRuntimeRequest,
} from '../src/panel.mjs'

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
    assert.equal(payload.value.pagination.pageSize, 24)
    assert.equal(payload.value.pagination.total, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('market endpoint keeps candidate discovery records outside install operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-candidate-panel-'))
  try {
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: {}, dsh: { profile: { bundles: [] } },
    }))
    const catalog = { schemaVersion: 1, registry: { name: 'Fixture' }, source: { kind: 'fixture' }, entries: [] }
    const candidateRegistry = {
      registry: { name: 'Candidates', trustBoundary: { installActionsDisabled: true } },
      source: { kind: 'fixture' },
      entries: [{ id: 'candidate', name: 'Candidate', installable: false, allowedActions: [] }],
    }
    const res = response()
    await handleMarketRequest(request({ view: 'candidates', page: 1, pageSize: 24 }), res, {
      dshHome: root,
      catalogService: { load: async () => catalog },
      candidateService: { load: async () => candidateRegistry },
    })
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200)
    assert.equal(payload.value.entries.length, 0)
    assert.equal(payload.value.candidates[0].installable, false)
    assert.deepEqual(payload.value.candidates[0].allowedActions, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('market endpoint does not load the candidate registry outside the candidate view', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-lazy-candidate-panel-'))
  try {
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: {}, dsh: { profile: { bundles: [] } },
    }))
    let candidateLoads = 0
    const res = response()
    await handleMarketRequest(request({ view: 'market' }), res, {
      dshHome: root,
      catalogService: { load: async () => ({ schemaVersion: 1, registry: { name: 'Fixture' }, source: { kind: 'fixture' }, entries: [] }) },
      candidateService: { load: async () => { candidateLoads += 1; return { entries: [] } } },
    })
    assert.equal(res.status, 200)
    assert.equal(candidateLoads, 0)
    assert.deepEqual(JSON.parse(res.body).value.candidates, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('market endpoint keeps a 400-entry catalog response bounded to one page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-bounded-market-panel-'))
  try {
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: {}, dsh: { profile: { bundles: [] } },
    }))
    const entries = Array.from({ length: 400 }, (_, index) => ({
      id: `demo-${index}`, name: `Demo ${index}`, packageName: `dsh-demo-${index}`,
      description: 'bounded response fixture', repositoryUrl: `https://github.com/example/demo-${index}`,
      commit: 'a'.repeat(40), version: '1.0.0', categories: ['tools'], entryIds: [`demo-${index}`],
      status: 'approved', statusReason: null,
      compatibility: { dsh: '>=0.1.0-rc.8 <0.2.0', dshReleases: { 'rc.5': 'incompatible', 'rc.6': 'incompatible', 'rc.7': 'incompatible', 'rc.8': 'compatible' } },
      details: {
        pluginType: 'feature', installSource: 'github', license: 'MIT',
        permissions: { level: 'low', files: 'none', network: 'none', commands: 'none', credentials: ['none'] },
        externalDependencies: [], reviewStatus: 'automated-scan',
      },
      risk: { installScripts: [], review: 'fixture' },
    }))
    const res = response()
    await handleMarketRequest(request({ view: 'market', page: 7, pageSize: 24 }), res, {
      dshHome: root,
      catalogService: { load: async () => ({
        schemaVersion: 1, registry: { name: 'Fixture', categories: { tools: '工具' } }, source: { kind: 'fixture' }, entries,
      }) },
    })
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200)
    assert.equal(payload.value.entries.length, 24)
    assert.equal(payload.value.pagination.total, 400)
    assert.equal(payload.value.pagination.pageCount, 17)
    assert.ok(Buffer.byteLength(res.body) < 200_000, `paged response is unexpectedly large: ${Buffer.byteLength(res.body)} bytes`)
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

test('source update endpoint checks only an installed catalog plugin through the Host service', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-source-update-panel-'))
  try {
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(join(profileDir, 'node_modules', 'dsh-demo'), { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: { 'dsh-demo': 'git#old' }, dsh: { profile: { bundles: ['dsh-demo'] } },
    }))
    await writeFile(join(profileDir, 'node_modules', 'dsh-demo', 'package.json'), JSON.stringify({ name: 'dsh-demo', version: '1.0.0' }))
    const entry = { id: 'demo', packageName: 'dsh-demo' }
    let inspected = null
    const res = response()
    await handleSourceUpdateRequest(request({ pluginId: 'demo' }), res, {
      dshHome: root,
      catalogService: { load: async () => ({ entries: [entry] }) },
      sourceUpdateService: { inspect: async (selected, installed) => {
        inspected = { selected, installed }
        return { status: 'current' }
      } },
    })
    assert.equal(res.status, 200)
    assert.equal(inspected.selected, entry)
    assert.equal(inspected.installed.version, '1.0.0')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('DSH version endpoint is read-only and forwards only the refresh choice', async () => {
  let received = null
  const res = response()
  await handleDshVersionRequest(request({ refresh: true }), res, {
    dshVersionService: { inspect: async options => {
      received = options
      return { schemaVersion: 1, currentVersion: '0.1.0-rc.7', latestVersion: '0.1.0-rc.7', status: 'current' }
    } },
  })
  assert.equal(res.status, 200)
  assert.deepEqual(received, { force: true })
  assert.equal(JSON.parse(res.body).value.status, 'current')
})

test('runtime endpoint is read-only and restart endpoints require separate intents', async () => {
  const runtimeStatus = {
    schemaVersion: 1, profile: 'web', bootId: 'boot-one', startedAt: '2026-08-17T00:00:00Z',
    restartCommand: ['dsh', 'web'], restartSupported: false,
  }
  const runtimeResponse = response()
  await handleRuntimeRequest(request({}), runtimeResponse, { defaultProfile: 'web', runtimeStatus })
  assert.equal(runtimeResponse.status, 200)
  assert.equal(JSON.parse(runtimeResponse.body).value.bootId, 'boot-one')

  let planCalled = false
  let executeCalled = false
  const restartService = {
    createPlan: () => { planCalled = true; return { planId: 'restart-one' } },
    execute: () => { executeCalled = true; return { status: 'restart-scheduled' } },
  }
  const deniedPlan = response()
  await handleRestartPlanRequest(request({}), deniedPlan, { restartService })
  assert.equal(deniedPlan.status, 403)
  assert.equal(planCalled, false)
  const allowedPlan = response()
  await handleRestartPlanRequest(request({}, { 'x-dsh-safe-intent': 'restart-plan' }), allowedPlan, { restartService })
  assert.equal(allowedPlan.status, 200)
  const deniedExecute = response()
  await handleRestartExecuteRequest(request({}), deniedExecute, { restartService })
  assert.equal(deniedExecute.status, 403)
  assert.equal(executeCalled, false)
  const allowedExecute = response()
  await handleRestartExecuteRequest(request({}, { 'x-dsh-safe-intent': 'restart-execute' }), allowedExecute, { restartService })
  assert.equal(allowedExecute.status, 200)
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
    const options = {
      dshHome: root, defaultProfile: 'web', catalogService: { load: async () => catalog },
      runner: { dumpConfig: async () => ({ ok: true }) },
    }
    const initialRes = response()
    await handleHealthRequest(request({}), initialRes, options)
    const initialPayload = JSON.parse(initialRes.body)
    const revision = initialPayload.value.plugins[0].permissions.decisionRevision
    const req = request({
      permissionDecisions: {
        'dsh-demo': { schemaVersion: 1, revision, decisions: { files: true } },
      },
    })
    const res = response()
    await handleHealthRequest(req, res, options)
    const payload = JSON.parse(res.body)
    assert.equal(res.status, 200)
    assert.equal(payload.value.schemaVersion, 2)
    assert.equal(payload.value.plugins[0].permissions.status, 'accepted')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
