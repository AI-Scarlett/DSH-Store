import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('serve-marketplace API endpoints handle recommendations, admin settings, and auth', async () => {
  const dir = await mkdtemp(fileURLToPath(new URL('.tmp-serve-test-', root)))
  const testPort = 49152 + Math.floor(Math.random() * 5000)

  const child = spawn(process.execPath, ['scripts/serve-marketplace.mjs'], {
    cwd: fileURLToPath(root),
    env: {
      ...process.env,
      DSH_MARKETPLACE_PORT: String(testPort),
      MODEL_SETTINGS_CONFIG_PATH: join(dir, 'settings.json'),
      MODEL_SETTINGS_KEY_PATH: join(dir, 'test.key'),
      PLUGIN_CATALOG_DB_PATH: join(dir, 'plugin-catalog.sqlite3'),
      PLUGIN_CATALOG_SYNC_INTERVAL_MS: '0',
      DSH_ADMIN_USERNAME: 'admin',
      DSH_ADMIN_PASSWORD: 'dsh2026admin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', data => {
        if (data.toString().includes('DSH plugin marketplace:')) resolve()
      })
      child.on('error', reject)
      setTimeout(() => reject(new Error('Server failed to start within 5s')), 5000)
    })

    const baseUrl = `http://127.0.0.1:${testPort}`

    // 1. Static homepage
    const homeRes = await fetch(`${baseUrl}/marketplace/`)
    assert.equal(homeRes.status, 200)
    const homeHtml = await homeRes.text()
    assert.ok(homeHtml.includes('ai-task-panel'))
    assert.ok(homeHtml.includes('unified-hero-form'))
    assert.ok(homeHtml.includes('floating-assistant-modal'))
    assert.ok(homeHtml.includes('插件助手'))
    assert.ok(!homeHtml.includes('模型后台'))
    assert.ok(!homeHtml.includes('ai-admin-shortcut'))

    // 2. Static admin
    const adminRes = await fetch(`${baseUrl}/marketplace/admin/`)
    assert.equal(adminRes.status, 200)
    const adminHtml = await adminRes.text()
    assert.ok(adminHtml.includes('大模型配置管理后台'))
    assert.ok(adminHtml.includes('admin-login-view'))
    assert.ok(adminHtml.includes('prompt-placeholder-input'))
    assert.ok(adminHtml.includes('suggestions-list-container'))

    // 3. AI Recommend API
    const recRes = await fetch(`${baseUrl}/api/ai/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '微信机器人' }),
    })
    assert.equal(recRes.status, 200)
    const recData = await recRes.json()
    assert.equal(recData.ok, true)
    assert.ok(recData.plugins.length > 0)
    assert.ok(recData.plugins[0].installCommand.startsWith('dsh plugin add '))

    // 4. The recommendation index is server-side SQLite and records its Catalog source.
    const catalogStatusRes = await fetch(`${baseUrl}/api/ai/catalog-status`)
    assert.equal(catalogStatusRes.status, 200)
    const catalogStatus = await catalogStatusRes.json()
    assert.equal(catalogStatus.ok, true)
    assert.equal(catalogStatus.backend, 'sqlite-fts5')
    assert.ok(catalogStatus.entryCount > 0)
    assert.match(catalogStatus.catalogSha256, /^[a-f0-9]{64}$/)

    // 5. Public AI Config API
    const pubConfigRes = await fetch(`${baseUrl}/api/ai/public-config`)
    assert.equal(pubConfigRes.status, 200)
    const pubConfigData = await pubConfigRes.json()
    assert.equal(pubConfigData.ok, true)
    assert.ok(typeof pubConfigData.promptPlaceholder === 'string')
    assert.ok(Array.isArray(pubConfigData.promptSuggestions))

    // 5. Admin Settings unauthenticated GET should fail (401)
    const unauthGetRes = await fetch(`${baseUrl}/api/admin/model-settings`)
    assert.equal(unauthGetRes.status, 401)

    // 6. Admin Login with wrong credentials should fail (401)
    const badLoginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
    })
    assert.equal(badLoginRes.status, 401)

    // 7. Admin Login with correct credentials should succeed (200)
    const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'dsh2026admin' }),
    })
    assert.equal(loginRes.status, 200)
    const loginData = await loginRes.json()
    assert.equal(loginData.ok, true)
    assert.ok(typeof loginData.token === 'string')
    const sessionToken = loginData.token

    // 8. Admin Model Settings GET with valid session token
    const getSettingsRes = await fetch(`${baseUrl}/api/admin/model-settings`, {
      headers: { 'x-admin-token': sessionToken },
    })
    assert.equal(getSettingsRes.status, 200)
    const settingsData = await getSettingsRes.json()
    assert.equal(settingsData.ok, true)
    assert.equal(settingsData.settings.adminUsername, 'admin')
    assert.equal(settingsData.settings.hasPassword, true)
    assert.equal(settingsData.settings.primary.apiKey, undefined)
    assert.equal(settingsData.settings.primary.encryptedKey, undefined)

    // 9. Admin Model Settings POST with session token (update username & password)
    const postSettingsRes = await fetch(`${baseUrl}/api/admin/model-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': sessionToken,
      },
      body: JSON.stringify({
        enabled: true,
        mode: 'model-first',
        newUsername: 'superadmin',
        newPassword: 'new-secure-password-2026',
        promptPlaceholder: '自定义占位提示文案',
        promptSuggestions: [
          { label: '自定义示例1', query: '需求1' },
          { label: '自定义示例2', query: '需求2' },
        ],
        primary: {
          preset: 'deepseek',
          label: 'DeepSeek 主模型',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          apiKey: 'sk-deepseek-mock-secret',
        },
        backup: {
          enabled: true,
          preset: 'qwen',
          label: '通义千问 备用模型',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen-plus',
          usePrimaryKey: false,
          apiKey: 'sk-qwen-mock-secret',
        },
      }),
    })
    assert.equal(postSettingsRes.status, 200)
    const savedData = await postSettingsRes.json()
    assert.equal(savedData.ok, true)
    assert.equal(savedData.settings.adminUsername, 'superadmin')
    assert.equal(savedData.settings.hasPassword, true)
    assert.equal(savedData.settings.promptPlaceholder, '自定义占位提示文案')
    assert.equal(savedData.settings.promptSuggestions.length, 2)
    assert.equal(savedData.settings.primary.hasKey, true)
    assert.equal(savedData.settings.backup.hasKey, true)

    // 10. Login with new credentials succeeds
    const newLoginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', password: 'new-secure-password-2026' }),
    })
    assert.equal(newLoginRes.status, 200)
    const newLoginData = await newLoginRes.json()
    assert.equal(newLoginData.ok, true)
    assert.equal(newLoginData.username, 'superadmin')

    // 11. Old credentials should now fail
    const oldLoginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'dsh2026admin' }),
    })
    assert.equal(oldLoginRes.status, 401)

  } finally {
    child.kill('SIGTERM')
    await rm(dir, { recursive: true, force: true })
  }
})

