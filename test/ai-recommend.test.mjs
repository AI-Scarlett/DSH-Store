import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fallbackRecommend,
  formatPluginCard,
  parseLlmRecommendation,
  recommendPlugins,
  searchCatalogCandidates,
  tokenize,
} from '../src/ai-recommend.mjs'

const sampleCatalog = [
  {
    name: '@Jerry113245/dsh-cnki-agent',
    alias: 'dsh-cnki-agent',
    description: 'CNKIAgent：DSH 知网论文研究助手插件。通过 dsh-browser-cdp 驱动本机 Edge 真实检索知网，按核心期刊编辑视角精读，分步写作（大纲→引言→正文→校订）。',
    categories: ['browser', 'knowledge', 'content'],
    stars: 10,
    commit: 'a1b2c3d4e5f67890123456789012345678901234',
    clientAdaptation: true,
  },
  {
    name: '@yunfengnobug/dsh-qq-bot',
    alias: 'dsh-qq-bot',
    description: '把 DSH 会话接到 QQ（OneBot/NapCat）。',
    categories: ['chat', 'automation'],
    stars: 15,
    commit: 'b1b2c3d4e5f67890123456789012345678901234',
    clientAdaptation: false,
  },
  {
    name: '@g34y0r/dsh-deepseek-balance',
    alias: 'dsh-deepseek-balance',
    description: 'DeepSeek API 余额，常驻在 dsh 输入框旁边。零配置、零 token 成本。',
    categories: ['network', 'ai'],
    stars: 20,
    commit: 'c1b2c3d4e5f67890123456789012345678901234',
    clientAdaptation: true,
  },
]

test('tokenize splits keywords and Chinese terms', () => {
  const tokens = tokenize('知网 论文 精读 deepseek-balance')
  assert.ok(tokens.length >= 3)
})

test('searchCatalogCandidates scores and finds relevant plugins', () => {
  const results = searchCatalogCandidates('知网论文精读', sampleCatalog)
  assert.equal(results.length, 1)
  assert.equal(results[0].name, '@Jerry113245/dsh-cnki-agent')

  const balanceResults = searchCatalogCandidates('查询 DeepSeek 余额', sampleCatalog)
  assert.equal(balanceResults.length, 1)
  assert.equal(balanceResults[0].name, '@g34y0r/dsh-deepseek-balance')
})

test('fallbackRecommend generates verified DSH install commands', () => {
  const res = fallbackRecommend('知网', sampleCatalog)
  assert.equal(res.ok, true)
  assert.equal(res.source, 'rules')
  assert.equal(res.plugins.length, 1)
  assert.equal(res.plugins[0].name, '@Jerry113245/dsh-cnki-agent')
  assert.equal(res.plugins[0].installCommand, 'dsh plugin add @Jerry113245/dsh-cnki-agent')
  assert.ok(res.suggestions.length > 0)
})

test('parseLlmRecommendation parses model JSON and bounds recommendations to real catalog', () => {
  const rawModelResponse = JSON.stringify({
    summary: '根据你的论文研究需求，推荐安装 CNKIAgent 插件。',
    plugins: [
      {
        name: '@Jerry113245/dsh-cnki-agent',
        reason: '支持知网检索与论文大纲精读。',
        installCommand: 'dsh plugin add @Jerry113245/dsh-cnki-agent',
      },
      {
        name: '@fake-hallucinated-plugin/not-exist',
        reason: '这是模型编造的不存在插件。',
        installCommand: 'dsh plugin add @fake/plugin',
      },
    ],
    suggestions: ['知网账号配置', 'Edge CDP 连接指南'],
  })

  const parsed = parseLlmRecommendation(rawModelResponse, sampleCatalog)
  assert.ok(parsed)
  assert.equal(parsed.plugins.length, 1)
  assert.equal(parsed.plugins[0].name, '@Jerry113245/dsh-cnki-agent')
  assert.equal(parsed.plugins[0].installCommand, 'dsh plugin add @Jerry113245/dsh-cnki-agent')
  assert.equal(parsed.suggestions.length, 2)
})

test('recommendPlugins falls back gracefully when LLM is not configured', async () => {
  const res = await recommendPlugins({
    query: '我想在 QQ 机器人中对接会话',
    settings: { enabled: true, primary: {} },
    catalog: sampleCatalog,
  })
  assert.equal(res.ok, true)
  assert.equal(res.plugins.length, 1)
  assert.equal(res.plugins[0].name, '@yunfengnobug/dsh-qq-bot')
  assert.equal(res.plugins[0].installCommand, 'dsh plugin add @yunfengnobug/dsh-qq-bot')
})
