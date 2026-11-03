import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const DEFAULT_CONFIG_PATH = process.env.MODEL_SETTINGS_CONFIG_PATH ? resolve(process.env.MODEL_SETTINGS_CONFIG_PATH) : resolve(projectRoot, ".local/model-settings.json")
export const DEFAULT_KEY_PATH = process.env.MODEL_SETTINGS_KEY_PATH ? resolve(process.env.MODEL_SETTINGS_KEY_PATH) : resolve(projectRoot, ".local/model-settings.key")

export const MODEL_PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    maxTokens: 2048,
    timeoutSeconds: 30,
    temperature: 0.3,
  },
  {
    id: 'minimax',
    name: 'MiniMax 国内',
    protocol: 'openai-chat',
    baseUrl: 'https://api.minimax.cn/v1',
    model: 'MiniMax-M3',
    maxTokens: 2048,
    timeoutSeconds: 30,
    temperature: 0.3,
  },
  {
    id: 'qwen',
    name: '通义千问 (Qwen)',
    protocol: 'openai-chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    maxTokens: 2048,
    timeoutSeconds: 30,
    temperature: 0.3,
  },
  {
    id: 'openai',
    name: 'OpenAI 官方',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    maxTokens: 2048,
    timeoutSeconds: 30,
    temperature: 0.3,
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 2048,
    timeoutSeconds: 30,
    temperature: 0.3,
  },
  {
    id: 'custom',
    name: '自定义 OpenAI 兼容接口',
    protocol: 'openai-chat',
    baseUrl: '',
    model: '',
    maxTokens: 2048,
    timeoutSeconds: 30,
    temperature: 0.3,
  },
]

export const DEFAULT_SYSTEM_PROMPT = `你是一名精通 DeepSeek Harness (DSH) 插件生态的官方架构师与选型专家。
你的职责是深入理解用户的实际业务、任务与工作流需求，结合 DSH Store 已收录并严格审查的插件目录，为用户推荐最适合的插件组合。

对于每个推荐的插件，你需要明确提供：
1. 插件名称与用途简述
2. 匹配理由（它如何解决用户的需求）
3. 精准的官方固定 Commit 安装命令（格式为 dsh plugin add @author/name 或包名）
4. 权限与安全声明（网络、文件系统、自动化脚本等）

请保持回答严谨、专业、实用。禁止捏造不存在的插件名称或未收录的虚假命令。`

export function defaultSettings() {
  return {
    revision: 1,
    enabled: true,
    mode: 'model-first', // 'model-first' | 'rules-first'
    dailyLimit: 0, // 0 = 不限
    perVisitorHourlyLimit: 50,
    adminPasswordHash: '', // SHA-256 of admin password, empty = prompt to set
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    primary: {
      preset: 'deepseek',
      label: 'DeepSeek 主模型',
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      timeoutSeconds: 30,
      maxTokens: 2048,
      temperature: 0.3,
      encryptedKey: '',
    },
    backup: {
      enabled: false,
      preset: 'qwen',
      label: '通义千问 备用模型',
      protocol: 'openai-chat',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      timeoutSeconds: 30,
      maxTokens: 2048,
      temperature: 0.3,
      usePrimaryKey: false,
      encryptedKey: '',
    },
  }
}

let cachedEncryptionKey = null

export async function getEncryptionKey(customKeyPath = DEFAULT_KEY_PATH) {
  if (process.env.MODEL_SETTINGS_ENCRYPTION_KEY) {
    const raw = process.env.MODEL_SETTINGS_ENCRYPTION_KEY.trim()
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      return Buffer.from(raw, 'hex')
    }
    return createHash('sha256').update(raw).digest()
  }

  if (cachedEncryptionKey) return cachedEncryptionKey

  try {
    const bytes = await readFile(customKeyPath)
    if (bytes.length === 32) {
      cachedEncryptionKey = bytes
      return bytes
    }
  } catch {}

  const newKey = randomBytes(32)
  await mkdir(dirname(customKeyPath), { recursive: true, mode: 0o700 })
  await writeFile(customKeyPath, newKey, { mode: 0o600 })
  cachedEncryptionKey = newKey
  return newKey
}

export async function encryptKey(secret, customKeyPath) {
  if (!secret || typeof secret !== 'string') return ''
  const trimmed = secret.trim()
  if (!trimmed) return ''
  const key = await getEncryptionKey(customKeyPath)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`
}

export async function decryptKey(encryptedString, customKeyPath) {
  if (!encryptedString || typeof encryptedString !== 'string') return ''
  const parts = encryptedString.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported encrypted key format')
  }
  const [, ivB64, tagB64, dataB64] = parts
  const key = await getEncryptionKey(customKeyPath)
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(dataB64, 'base64')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}

export function hashPassword(password) {
  if (!password || typeof password !== 'string') return ''
  return createHash('sha256').update(password.trim()).digest('hex')
}

export function verifyPassword(providedPassword, expectedHash) {
  if (!expectedHash) return true // no password set yet
  if (!providedPassword) return false
  const providedHash = hashPassword(providedPassword)
  if (providedHash.length !== expectedHash.length) return false
  return timingSafeEqual(Buffer.from(providedHash), Buffer.from(expectedHash))
}

export function maskApiKey(plainOrEncrypted) {
  if (!plainOrEncrypted) return ''
  return '••••••••••••••••'
}

export async function loadModelSettings(configPath = DEFAULT_CONFIG_PATH) {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...defaultSettings(), ...parsed }
  } catch {
    return defaultSettings()
  }
}

export function toPublicView(settings) {
  const primaryHasKey = Boolean(settings.primary?.encryptedKey)
  const backupHasKey = settings.backup?.usePrimaryKey
    ? primaryHasKey
    : Boolean(settings.backup?.encryptedKey)

  return {
    revision: settings.revision || 1,
    enabled: settings.enabled !== false,
    mode: settings.mode || 'model-first',
    dailyLimit: settings.dailyLimit || 0,
    perVisitorHourlyLimit: settings.perVisitorHourlyLimit || 50,
    hasPassword: Boolean(settings.adminPasswordHash),
    systemPrompt: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    primary: {
      preset: settings.primary?.preset || 'deepseek',
      label: settings.primary?.label || 'DeepSeek 主模型',
      protocol: settings.primary?.protocol || 'openai-chat',
      baseUrl: settings.primary?.baseUrl || 'https://api.deepseek.com/v1',
      model: settings.primary?.model || 'deepseek-chat',
      timeoutSeconds: settings.primary?.timeoutSeconds || 30,
      maxTokens: settings.primary?.maxTokens || 2048,
      temperature: settings.primary?.temperature ?? 0.3,
      hasKey: primaryHasKey,
    },
    backup: {
      enabled: Boolean(settings.backup?.enabled),
      preset: settings.backup?.preset || 'qwen',
      label: settings.backup?.label || '通义千问 备用模型',
      protocol: settings.backup?.protocol || 'openai-chat',
      baseUrl: settings.backup?.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: settings.backup?.model || 'qwen-plus',
      timeoutSeconds: settings.backup?.timeoutSeconds || 30,
      maxTokens: settings.backup?.maxTokens || 2048,
      temperature: settings.backup?.temperature ?? 0.3,
      usePrimaryKey: Boolean(settings.backup?.usePrimaryKey),
      hasKey: backupHasKey,
    },
    presets: MODEL_PRESETS,
  }
}

export async function saveModelSettings(input, configPath = DEFAULT_CONFIG_PATH, customKeyPath = DEFAULT_KEY_PATH) {
  const current = await loadModelSettings(configPath)

  let primaryEncrypted = current.primary.encryptedKey
  if (input.primary?.clearKey) {
    primaryEncrypted = ''
  } else if (input.primary?.apiKey && input.primary.apiKey.trim()) {
    primaryEncrypted = await encryptKey(input.primary.apiKey.trim(), customKeyPath)
  }

  let backupEncrypted = current.backup.encryptedKey
  if (input.backup?.clearKey) {
    backupEncrypted = ''
  } else if (input.backup?.apiKey && input.backup.apiKey.trim()) {
    backupEncrypted = await encryptKey(input.backup.apiKey.trim(), customKeyPath)
  }

  let passwordHash = current.adminPasswordHash
  if (input.newPassword && typeof input.newPassword === 'string' && input.newPassword.trim()) {
    passwordHash = hashPassword(input.newPassword.trim())
  }

  const updated = {
    revision: (current.revision || 1) + 1,
    enabled: input.enabled !== false,
    mode: ['model-first', 'rules-first'].includes(input.mode) ? input.mode : current.mode,
    dailyLimit: Number.isInteger(input.dailyLimit) && input.dailyLimit >= 0 ? input.dailyLimit : current.dailyLimit,
    perVisitorHourlyLimit: Number.isInteger(input.perVisitorHourlyLimit) && input.perVisitorHourlyLimit > 0
      ? input.perVisitorHourlyLimit
      : current.perVisitorHourlyLimit,
    adminPasswordHash: passwordHash,
    systemPrompt: typeof input.systemPrompt === 'string' && input.systemPrompt.trim()
      ? input.systemPrompt.trim()
      : current.systemPrompt,
    primary: {
      preset: input.primary?.preset || current.primary.preset,
      label: input.primary?.label || current.primary.label,
      protocol: input.primary?.protocol || current.primary.protocol,
      baseUrl: (input.primary?.baseUrl || current.primary.baseUrl || '').replace(/\/+$/, ''),
      model: input.primary?.model || current.primary.model,
      timeoutSeconds: Math.max(5, Math.min(120, Number(input.primary?.timeoutSeconds) || 30)),
      maxTokens: Math.max(256, Math.min(8192, Number(input.primary?.maxTokens) || 2048)),
      temperature: Math.max(0, Math.min(2, Number(input.primary?.temperature) || 0.3)),
      encryptedKey: primaryEncrypted,
    },
    backup: {
      enabled: Boolean(input.backup?.enabled),
      preset: input.backup?.preset || current.backup.preset,
      label: input.backup?.label || current.backup.label,
      protocol: input.backup?.protocol || current.backup.protocol,
      baseUrl: (input.backup?.baseUrl || current.backup.baseUrl || '').replace(/\/+$/, ''),
      model: input.backup?.model || current.backup.model,
      timeoutSeconds: Math.max(5, Math.min(120, Number(input.backup?.timeoutSeconds) || 30)),
      maxTokens: Math.max(256, Math.min(8192, Number(input.backup?.maxTokens) || 2048)),
      temperature: Math.max(0, Math.min(2, Number(input.backup?.temperature) || 0.3)),
      usePrimaryKey: Boolean(input.backup?.usePrimaryKey),
      encryptedKey: backupEncrypted,
    },
  }

  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 })
  await writeFile(configPath, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 })
  return updated
}

export async function testEndpointConnection({ endpoint, apiKey, customKeyPath }) {
  const start = Date.now()
  const key = apiKey || (endpoint.encryptedKey ? await decryptKey(endpoint.encryptedKey, customKeyPath) : '')
  if (!key) {
    return { ok: false, error: '缺少 API Key，请先填写密钥' }
  }
  if (!endpoint.baseUrl) {
    return { ok: false, error: '缺少 API 基础地址' }
  }
  if (!endpoint.model) {
    return { ok: false, error: '缺少模型 ID' }
  }

  const timeoutMs = (endpoint.timeoutSeconds || 20) * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const isAnthropic = endpoint.protocol === 'anthropic'
    const url = isAnthropic
      ? `${endpoint.baseUrl.replace(/\/+$/, '')}/messages`
      : `${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`

    const headers = {
      'Content-Type': 'application/json',
    }

    let body
    if (isAnthropic) {
      headers['x-api-key'] = key
      headers['anthropic-version'] = '2023-06-01'
      body = JSON.stringify({
        model: endpoint.model,
        max_tokens: 30,
        messages: [{ role: 'user', content: 'Ping' }],
      })
    } else {
      headers['Authorization'] = `Bearer ${key}`
      body = JSON.stringify({
        model: endpoint.model,
        max_tokens: 30,
        temperature: 0.1,
        messages: [{ role: 'user', content: 'Ping' }],
      })
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    const latencyMs = Date.now() - start
    clearTimeout(timer)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      let msg = `HTTP ${response.status}`
      try {
        const parsed = JSON.parse(errText)
        msg += `: ${parsed.error?.message || parsed.message || errText.slice(0, 200)}`
      } catch {
        if (errText) msg += `: ${errText.slice(0, 200)}`
      }
      return { ok: false, latencyMs, error: msg }
    }

    const data = await response.json()
    let reply = ''
    if (isAnthropic) {
      reply = data.content?.[0]?.text || ''
    } else {
      reply = data.choices?.[0]?.message?.content || ''
    }

    return {
      ok: true,
      latencyMs,
      model: endpoint.model,
      replySnippet: reply.trim().slice(0, 100),
    }
  } catch (err) {
    clearTimeout(timer)
    const latencyMs = Date.now() - start
    return {
      ok: false,
      latencyMs,
      error: err.name === 'AbortError' ? `请求超时 (${endpoint.timeoutSeconds}s)` : err.message,
    }
  }
}
