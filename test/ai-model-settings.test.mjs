import { createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  decryptKey,
  defaultSettings,
  encryptKey,
  generateSessionToken,
  hashPassword,
  loadModelSettings,
  saveModelSettings,
  toPublicView,
  verifyPassword,
  verifySessionToken,
} from '../src/ai-model-settings.mjs'

const root = new URL('../', import.meta.url)

test('AES-256-GCM encryption and decryption round-trip with disposable key', async () => {
  const dir = await mkdtemp(fileURLToPath(new URL('.tmp-ai-test-', root)))
  try {
    const keyPath = join(dir, 'test.key')
    const secret = 'sk-test-secret-key-1234567890abcdef'
    const encrypted = await encryptKey(secret, keyPath)
    assert.match(encrypted, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/)

    const decrypted = await decryptKey(encrypted, keyPath)
    assert.equal(decrypted, secret)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Admin password hashing and verification', () => {
  const hash = hashPassword('my-admin-password')
  assert.match(hash, /^s1:[0-9a-f]{32}:[0-9a-f]{128}$/)
  assert.equal(verifyPassword('my-admin-password', hash), true)
  assert.equal(verifyPassword('wrong-password', hash), false)
  assert.equal(verifyPassword('', hash), false)
  assert.equal(verifyPassword('my-admin-password', ''), false)
})

test('legacy settings require an explicit password and fail closed without it', async () => {
  const dir = await mkdtemp(fileURLToPath(new URL('.tmp-ai-credential-migration-', root)))
  const original = process.env.DSH_ADMIN_PASSWORD
  process.env.DSH_ADMIN_PASSWORD = ''
  try {
    const isolated = await import(`../src/ai-model-settings.mjs?credential-migration=${Date.now()}-${Math.random()}`)
    const configPath = join(dir, 'legacy-settings.json')
    await writeFile(configPath, JSON.stringify({
      revision: 2,
      adminUsername: 'admin',
      adminPasswordHash: isolated.hashPassword('legacy-fixture-password'),
    }))

    const settings = await isolated.loadModelSettings(configPath)
    assert.equal(settings.adminCredentialVersion, 1)
    assert.equal(settings.adminPasswordHash, '')
    assert.equal(isolated.verifyPassword('legacy-fixture-password', settings.adminPasswordHash), false)
    assert.equal(isolated.verifyPassword('anything', ''), false)
  } finally {
    if (original === undefined) delete process.env.DSH_ADMIN_PASSWORD
    else process.env.DSH_ADMIN_PASSWORD = original
    await rm(dir, { recursive: true, force: true })
  }
})

test('legacy settings migrate to an operator-provided bootstrap password', async () => {
  const dir = await mkdtemp(fileURLToPath(new URL('.tmp-ai-credential-migration-', root)))
  const original = process.env.DSH_ADMIN_PASSWORD
  process.env.DSH_ADMIN_PASSWORD = 'fixture-bootstrap-password'
  try {
    const isolated = await import(`../src/ai-model-settings.mjs?credential-configured=${Date.now()}-${Math.random()}`)
    const configPath = join(dir, 'legacy-settings.json')
    await writeFile(configPath, JSON.stringify({
      revision: 2,
      adminUsername: 'admin',
      adminPasswordHash: isolated.hashPassword('legacy-fixture-password'),
    }))

    const settings = await isolated.loadModelSettings(configPath)
    assert.equal(settings.adminCredentialVersion, 1)
    assert.equal(isolated.verifyPassword('legacy-fixture-password', settings.adminPasswordHash), false)
    assert.equal(isolated.verifyPassword('fixture-bootstrap-password', settings.adminPasswordHash), true)
  } finally {
    if (original === undefined) delete process.env.DSH_ADMIN_PASSWORD
    else process.env.DSH_ADMIN_PASSWORD = original
    await rm(dir, { recursive: true, force: true })
  }
})

test('Session token generation and verification', () => {
  const secretKey = Buffer.from('01234567890123456789012345678901')
  const token = generateSessionToken('admin', secretKey)
  assert.ok(typeof token === 'string' && token.length > 20)

  const decoded = Buffer.from(token, 'base64url').toString('utf8')
  assert.match(decoded, /^v2:admin:/)
  const verified = verifySessionToken(token, secretKey)
  assert.equal(verified?.username, 'admin')
  assert.ok(typeof verified?.timestamp === 'number')

  const legacyPayload = `admin:${Date.now()}`
  const legacySignature = createHmac('sha256', secretKey).update(legacyPayload).digest('hex')
  const legacyToken = Buffer.from(`${legacyPayload}:${legacySignature}`).toString('base64url')
  assert.equal(verifySessionToken(legacyToken, secretKey), null)
  assert.equal(verifySessionToken('invalid-token', secretKey), null)
  assert.equal(verifySessionToken(token, Buffer.from('wrongkeywrongkeywrongkeywrongkey')), null)
})

test('Settings persistence, encryption and public view masking', async () => {
  const dir = await mkdtemp(fileURLToPath(new URL('.tmp-ai-test-', root)))
  try {
    const configPath = join(dir, 'settings.json')
    const keyPath = join(dir, 'test.key')

    const initial = await loadModelSettings(configPath)
    assert.equal(initial.enabled, true)
    assert.equal(initial.primary.encryptedKey, '')

    const saved = await saveModelSettings({
      enabled: true,
      mode: 'model-first',
      newPassword: 'admin-password-123',
      primary: {
        preset: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'sk-deepseek-real-key',
      },
      backup: {
        enabled: true,
        preset: 'qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus',
        apiKey: 'sk-qwen-backup-key',
        usePrimaryKey: false,
      },
    }, configPath, keyPath)

    assert.equal(saved.revision, 2)
    assert.match(saved.primary.encryptedKey, /^v1\./)
    assert.match(saved.backup.encryptedKey, /^v1\./)

    // Decrypt directly to verify storage
    assert.equal(await decryptKey(saved.primary.encryptedKey, keyPath), 'sk-deepseek-real-key')
    assert.equal(await decryptKey(saved.backup.encryptedKey, keyPath), 'sk-qwen-backup-key')

    // Public view must NEVER leak plain or encrypted keys
    const pub = toPublicView(saved)
    assert.equal(pub.hasPassword, true)
    assert.equal(pub.primary.hasKey, true)
    assert.equal(pub.backup.hasKey, true)
    assert.equal(pub.primary.encryptedKey, undefined)
    assert.equal(pub.backup.encryptedKey, undefined)
    assert.equal(pub.primary.apiKey, undefined)
    assert.equal(pub.backup.apiKey, undefined)
    assert.equal(typeof pub.promptPlaceholder, 'string')
    assert.ok(Array.isArray(pub.promptSuggestions))

    // Test custom prompt placeholder and suggestions persistence
    const custom = await saveModelSettings({
      promptPlaceholder: '自定义占位提示词',
      promptSuggestions: [{ label: '知网测试', query: '测试论文精读' }],
    }, configPath, keyPath)
    assert.equal(custom.promptPlaceholder, '自定义占位提示词')
    assert.deepEqual(custom.promptSuggestions, [{ label: '知网测试', query: '测试论文精读' }])
    const customPub = toPublicView(custom)
    assert.equal(customPub.promptPlaceholder, '自定义占位提示词')
    assert.deepEqual(customPub.promptSuggestions, [{ label: '知网测试', query: '测试论文精读' }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
