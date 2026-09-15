import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
const cli = resolve(process.argv[2])
const buildRoot = process.argv[3] ? resolve(process.argv[3]) : null
// Keep file dependencies on the fixture drive: pnpm 10 on Windows cannot
// resolve the cross-drive file-source layout. This remains a disposable sibling.
const root = await mkdtemp(join(dirname(resolve('.')), 'store-e3-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)))
Object.assign(env, { DSH_HOME: join(root, 'home'), DSH_AGENTS_HOME: join(root, 'agents'), DSH_TELEMETRY_DISABLED: '1', npm_config_cache: join(root, 'cache'), CI: 'true' })
const run = args => new Promise((resolveRun, reject) => execFile(process.execPath, [cli, ...args], { cwd: root, env, timeout: 180000, maxBuffer: 6 * 1024 * 1024 }, (error, stdout, stderr) => {
  if (error) return reject(Object.assign(new Error('Official CLI failed'), { exitCode: error.code, codes: [...new Set((String(stdout) + String(stderr)).match(/\b(?:ERR_[A-Z0-9_]+|ENOENT|EPERM|EACCES|EBUSY|ENOSPC|EINVAL)\b/g) ?? [])], stage: args.slice(0, 4).join(' ') }))
  resolveRun(stdout)
}))
let child
try {
  await mkdir(env.DSH_HOME, { recursive: true })
  await run(['--profile', 'web', '--dump-config'])
  await run(['plugin', '--profile', 'web', 'add', '--ignore-scripts', '--config.auto-install-peers=false', `file:${resolve('.')}`])
  if (buildRoot) await run(['plugin', '--profile', 'web', 'add', '--ignore-scripts', `file:${buildRoot}`])
  const config = await run(['--profile', 'web', '--dump-config'])
  assert.ok(config.includes('dsh-safe-plugin-manager'))
  if (buildRoot) assert.ok(config.includes('dsh-build-plugin-skill-provider'))
  const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done))
  const port = server.address().port; await new Promise(done => server.close(done))
  child = spawn(process.execPath, [cli, 'web', '--no-open', '--port', String(port)], { cwd: root, env, stdio: ['ignore','pipe','pipe'] })
  const launch = await new Promise((done, reject) => {
    let buffer = ''; const timer = setTimeout(() => reject(new Error('startup-timeout')), 90000)
    function append(chunk) {
      buffer = (buffer + chunk.toString()).slice(-65536)
      const match = /dsh web: (http:\/\/[^\s]+)/.exec(buffer)
      if (match) { clearTimeout(timer); done(match[1]); buffer = '' }
    }
    child.stdout.on('data', append); child.stderr.on('data', append)
    child.once('error', () => { clearTimeout(timer); reject(new Error('startup-spawn-failed')) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`startup-exited-${code}`)) })
  })
  const base = `http://127.0.0.1:${port}`
  const request = (path, cookie, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(10000) })
  const denied = await request('/api2/dsh-safe-plugin-manager/runtime'); assert.equal(denied.status, 401)
  const login = await fetch(launch, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  assert.ok([302, 303].includes(login.status))
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  let runtime
  for (let attempt=0; attempt<15; attempt++) {
    const res = await request('/api2/dsh-safe-plugin-manager/runtime', cookie)
    if (res.status === 200) { runtime = await res.json(); break }
    await new Promise(done => setTimeout(done, 500))
  }
  assert.equal(runtime?.ok, true); assert.equal(runtime.value.profile, 'web'); assert.ok(runtime.value.bootId)
  const inventory = await request('/api2/dsh-safe-plugin-manager/inventory', cookie); assert.equal(inventory.status, 200)
  const data = await inventory.json(); assert.ok(data.value.plugins.some(item => item.packageName === 'dsh-safe-plugin-manager'))
  const operations = await request('/api2/dsh-safe-plugin-manager/operations', cookie, 'GET'); assert.equal(operations.status, 200)
  const forged = await fetch(base + '/api2/dsh-safe-plugin-manager/runtime', { method: 'POST', headers: { cookie, origin: 'https://evil.invalid', 'content-type': 'application/json' }, body: '{}' }); assert.equal(forged.status, 403)
  const client = await request('/api2/dsh-safe-plugin-manager/activation', cookie); assert.equal(client.status, 200)
  child.kill('SIGTERM'); await new Promise(done => child.once('exit', done)); child = null
  await run(['plugin', '--profile', 'web', 'remove', 'dsh-safe-plugin-manager'])
  const after = await run(['--profile', 'web', '--dump-config']); assert.ok(!after.includes('name: dsh-safe-plugin-manager'))
  console.log(JSON.stringify({ status: 'passed', cliVersion: (await run(['--version'])).trim(), install: true, dumpConfig: true, startup: true, unauthenticated: 401, authenticated: 200, crossOrigin: 403, journal: true, activation: true, uninstall: true, buildBundle: Boolean(buildRoot), realProfile: 'unchanged' }))
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', message: error.message, stage: error.stage, exitCode: error.exitCode, codes: error.codes })); process.exitCode = 1
} finally {
  if (child && child.exitCode === null) { child.kill('SIGKILL'); await new Promise(done => child.once('exit', done)) }
  await rm(root, { recursive: true, force: true })
}
