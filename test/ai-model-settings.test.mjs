import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
  assert.equal(verifyPassword('my-admin-password', ''), true)
})

test('Session token generation and verification', () => {
  const secretKey = Buffer.from('01234567890123456789012345678901')
  const token = generateSessionToken('admin', secretKey)
  assert.ok(typeof token === 'string' && token.length > 20)

  const verified = verifySessionToken(token, secretKey)
  assert.equal(verified?.username, 'admin')
  assert.ok(typeof verified?.timestamp === 'number')

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
