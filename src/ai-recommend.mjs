import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { decryptKey } from "./ai-model-settings.mjs"

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
const CATALOG_INDEX_PATH = resolve(projectRoot, "registry/catalog-index.json")

let cachedCatalog = null

export async function loadCatalogIndex(customPath = CATALOG_INDEX_PATH) {
  if (cachedCatalog && customPath === CATALOG_INDEX_PATH) return cachedCatalog
  try {
    const raw = await readFile(customPath, "utf8")
    const data = JSON.parse(raw)
    const entries = Array.isArray(data.entries) ? data.entries : []
    if (customPath === CATALOG_INDEX_PATH) cachedCatalog = entries
    return entries
  } catch {
    return []
  }
}

export function tokenize(text) {
  if (!text || typeof text !== 'string') return []
  const clean = text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, ' ')
  const words = clean.split(/\s+/).filter(t => t.length >= 2)
  const tokens = new Set(words)
  for (const w of words) {
    if (/[\u4e00-\u9fa5]/.test(w) && w.length >= 2) {
      for (let i = 0; i <= w.length - 2; i++) {
        tokens.add(w.slice(i, i + 2))
      }
    }
  }
  return Array.from(tokens)
}

export function searchCatalogCandidates(queryText, catalog, limit = 8) {
  if (!Array.isArray(catalog) || catalog.length === 0) return []
  const qTokens = tokenize(queryText)
  if (qTokens.length === 0) {
    return [...catalog].sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, limit)
  }

  const queryLower = queryText.toLowerCase()

  const scored = catalog.map(entry => {
    let score = 0
    const name = (entry.name || "").toLowerCase()
    const alias = (entry.alias || "").toLowerCase()
    const desc = (entry.description || "").toLowerCase()
    const cats = (entry.categories || []).map(c => c.toLowerCase()).join(" ")

    if (desc.includes(queryLower)) score += 30
    if (name.includes(queryLower) || alias.includes(queryLower)) score += 40

    for (const token of qTokens) {
      if (name.includes(token)) score += 15
      if (alias.includes(token)) score += 12
      if (desc.includes(token)) score += 8
      if (cats.includes(token)) score += 10
    }

    if (score > 0) {
      if (entry.stars > 0) score += Math.min(10, Math.log2(entry.stars + 1))
      if (entry.clientAdaptation) score += 2
    }

    return { entry, score }
  })

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.entry)
}

export function formatPluginCard(entry, customReason) {
  const installCmd = "dsh plugin add " + entry.name
  return {
    name: entry.name,
    alias: entry.alias || entry.name.replace(/^@[^/]+\//, ""),
    description: entry.description || "",
    reason: customReason || (entry.description ? "匹配功能：" + entry.description.slice(0, 80) + "..." : "根据需求匹配此插件"),
    installCommand: installCmd,
    categories: entry.categories || [],
    stars: entry.stars || 0,
    version: entry.version || "",
    commit: entry.commit || "",
    permissions: entry.permissions || {},
    repositoryUrl: entry.repositoryUrl || null,
    clientAdaptation: Boolean(entry.clientAdaptation),
  }
}

export function fallbackRecommend(queryText, catalog) {
  const candidates = searchCatalogCandidates(queryText, catalog, 4)
  if (candidates.length === 0) {
    return {
      ok: true,
      source: "rules",
      modelName: null,
      summary: "未在当前 DSH Store 目录中检索到与「" + queryText.slice(0, 30) + "」完全匹配的已收录插件。建议换用更通用的关键词（如“微信”、“知网”、“记忆”、“看板”、“监控”），或在完整插件目录中按分类浏览。",
      plugins: [],
      suggestions: [
        "查看完整插件目录",
        "知网论文精读",
        "微信 / QQ 接入 DSH",
        "大模型 API 余额监控",
      ],
    }
  }

  const plugins = candidates.map(entry => formatPluginCard(entry))
  const summary = "已通过 DSH 插件目录规则引擎为你匹配到 " + plugins.length + " 个相关插件。DSH Store 所有条目均经过固定 Commit 审核，请核对权限后在终端中执行命令安装："

  return {
    ok: true,
    source: "rules",
    modelName: null,
    summary,
    plugins,
    suggestions: [
      "这些插件需要哪些本地权限？",
      "如何更新已安装的 DSH 插件？",
      "在 DSH Desktop 中如何直接安装？",
    ],
  }
}

async function callEndpoint({ endpoint, messages, customKeyPath }) {
  const key = endpoint.encryptedKey ? await decryptKey(endpoint.encryptedKey, customKeyPath) : ""
  if (!key || !endpoint.baseUrl || !endpoint.model) {
    throw new Error("Endpoint configuration or API Key is incomplete")
  }

  const isAnthropic = endpoint.protocol === "anthropic"
  const url = isAnthropic
    ? endpoint.baseUrl.replace(/\/+$/, "") + "/messages"
    : endpoint.baseUrl.replace(/\/+$/, "") + "/chat/completions"

  const headers = { "Content-Type": "application/json" }
  const timeoutMs = (endpoint.timeoutSeconds || 30) * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let body
  if (isAnthropic) {
    headers["x-api-key"] = key
    headers["anthropic-version"] = "2023-06-01"
    const systemMsg = messages.find(m => m.role === "system")?.content || ""
    const userMsgs = messages.filter(m => m.role !== "system")
    body = JSON.stringify({
      model: endpoint.model,
      max_tokens: endpoint.maxTokens || 2048,
      system: systemMsg,
      messages: userMsgs,
    })
  } else {
    headers["Authorization"] = "Bearer " + key
    body = JSON.stringify({
      model: endpoint.model,
      max_tokens: endpoint.maxTokens || 2048,
      temperature: endpoint.temperature ?? 0.3,
      messages,
    })
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) {
      const txt = await response.text().catch(() => "")
      throw new Error("LLM HTTP " + response.status + ": " + txt.slice(0, 160))
    }
    const data = await response.json()
    if (isAnthropic) {
      return data.content?.[0]?.text || ""
    }
    return data.choices?.[0]?.message?.content || ""
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

export function parseLlmRecommendation(rawText, candidates) {
  if (!rawText) return null
  let jsonStr = ""
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim()
  } else {
    const start = rawText.indexOf("{")
    const end = rawText.lastIndexOf("}")
    if (start >= 0 && end > start) {
      jsonStr = rawText.slice(start, end + 1)
    }
  }

  if (!jsonStr) return null

  try {
    const parsed = JSON.parse(jsonStr)
    const summary = parsed.summary || rawText.replace(/```[\s\S]*?```/g, "").trim()
    const candidateMap = new Map()
    for (const c of candidates) {
      candidateMap.set(c.name.toLowerCase(), c)
      if (c.alias) candidateMap.set(c.alias.toLowerCase(), c)
    }

    const plugins = []
    if (Array.isArray(parsed.plugins)) {
      for (const item of parsed.plugins) {
        if (!item || !item.name) continue
        const matched = candidateMap.get(item.name.toLowerCase())
        if (matched) {
          plugins.push(formatPluginCard(matched, item.reason))
        } else {
          const found = candidates.find(c =>
            c.name.toLowerCase().includes(item.name.toLowerCase()) ||
            item.name.toLowerCase().includes(c.name.toLowerCase())
          )
          if (found) {
            plugins.push(formatPluginCard(found, item.reason))
          }
        }
      }
    }

    return {
      summary,
      plugins,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    }
  } catch {
    return null
  }
}

export async function recommendPlugins({ query, settings, catalog, customKeyPath }) {
  const cat = catalog || await loadCatalogIndex()
  const q = (query || "").trim()
  if (!q) {
    return {
      ok: false,
      error: "请输入你的需求或工作流任务",
    }
  }

  const hasPrimary = settings?.enabled !== false &&
    settings?.primary?.encryptedKey &&
    settings?.primary?.baseUrl &&
    settings?.primary?.model

  const isModelFirst = settings?.mode !== "rules-first"

  if (!hasPrimary || !isModelFirst) {
    const ruleResult = fallbackRecommend(q, cat)
    if (ruleResult.plugins.length > 0 || !hasPrimary) {
      return ruleResult
    }
  }

  const candidates = searchCatalogCandidates(q, cat, 8)
  if (candidates.length === 0) {
    return fallbackRecommend(q, cat)
  }

  const contextJson = JSON.stringify(candidates.map(c => ({
    name: c.name,
    alias: c.alias,
    description: c.description,
    categories: c.categories,
    stars: c.stars,
    clientAdaptation: c.clientAdaptation,
  })), null, 2)

  const systemMsg = (settings?.systemPrompt || "") +
    "\n\n【当前可用候选插件列表】\n" + contextJson +
    "\n\n【输出格式要求】\n请务必且仅输出纯 JSON 对象，格式如下：\n{\n  \"summary\": \"针对用户需求的分析说明与选型建议\",\n  \"plugins\": [\n    {\n      \"name\": \"必须与候选清单中的 name 完全一致的完整包名\",\n      \"reason\": \"推荐该插件的具体匹配理由\",\n      \"installCommand\": \"dsh plugin add <包名>\"\n    }\n  ],\n  \"suggestions\": [\"2~3个后续可追问的相关问题\"]\n}"

  const userMsg = "用户需求：" + q

  const messages = [
    { role: "system", content: systemMsg },
    { role: "user", content: userMsg },
  ]

  try {
    const rawAnswer = await callEndpoint({
      endpoint: settings.primary,
      messages,
      customKeyPath,
    })
    const parsed = parseLlmRecommendation(rawAnswer, candidates)
    if (parsed && parsed.plugins.length > 0) {
      return {
        ok: true,
        source: "model",
        modelName: settings.primary.model,
        summary: parsed.summary,
        plugins: parsed.plugins,
        suggestions: parsed.suggestions,
      }
    }
  } catch (primaryErr) {
    if (settings.backup?.enabled) {
      try {
        const backupEndpoint = {
          ...settings.backup,
          encryptedKey: settings.backup.usePrimaryKey ? settings.primary.encryptedKey : settings.backup.encryptedKey,
        }
        const rawAnswer = await callEndpoint({
          endpoint: backupEndpoint,
          messages,
          customKeyPath,
        })
        const parsed = parseLlmRecommendation(rawAnswer, candidates)
        if (parsed && parsed.plugins.length > 0) {
          return {
            ok: true,
            source: "model",
            modelName: settings.backup.model,
            summary: parsed.summary,
            plugins: parsed.plugins,
            suggestions: parsed.suggestions,
          }
        }
      } catch {}
    }
  }

  const fallback = fallbackRecommend(q, cat)
  fallback.notice = "已自动为您切换为智能规则选型引擎"
  return fallback
}
