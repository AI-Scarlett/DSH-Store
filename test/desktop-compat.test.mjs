import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { runInNewContext } from 'node:vm'
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

test('official dsh-app renderer shows a read-only handoff and makes no Host API requests', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const requests = []
  const effects = []
  const timers = []
  let ManagerPanel
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useCallback(callback) { return callback },
    useEffect(effect) { effects.push(effect) },
    useMemo(factory) { return factory() },
    useRef(current) { return { current } },
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  }
  const window = {
    location: { protocol: 'dsh-app:', origin: 'dsh-app://app', href: 'dsh-app://app/settings/plugins' },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: (...args) => { timers.push(args); return timers.length },
    clearTimeout: () => {},
    __ModuleLoader__: { load({ factory }) {
      const plugin = factory(name => name === 'react' ? React : ({ Modal: 'Modal' }))
      plugin.apply({ slots: {
        inject(_slot, register) { register() },
        register(_metadata, component) { ManagerPanel = component },
      } })
    } },
  }
  runInNewContext(source, {
    window,
    fetch: (...args) => { requests.push(args); return Promise.reject(new Error('unexpected fetch')) },
    URL,
    AbortController,
  })
  assert.equal(typeof ManagerPanel, 'function')
  const tree = ManagerPanel()
  for (const effect of effects) effect()
  await Promise.resolve()
  assert.equal(requests.length, 0)
  assert.equal(timers.length, 1, 'Desktop must not install the Host boot-recovery poller')

  const nodes = []
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    nodes.push(value)
    visit(value.children)
  }
  visit(tree)
  const text = nodes.flatMap(node => node.children || []).filter(value => typeof value === 'string').join(' ')
  assert.match(text, /dsh-app:\/\//)
  assert.match(text, /内置的“插件”页面/)
  assert.deepEqual(nodes.filter(node => node.type === 'a').map(node => node.props.href), [
    'https://dsh.store/marketplace/plugins/',
    'https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md',
  ])
  assert.equal(nodes.some(node => node.type === 'button'), false)
})
