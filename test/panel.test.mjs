import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { handleInventoryRequest } from '../src/panel.mjs'

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

