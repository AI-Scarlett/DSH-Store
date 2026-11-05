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
    status: 'approved',
  },
  {
    name: '@yunfengnobug/dsh-qq-bot',
    alias: 'dsh-qq-bot',
    description: '把 DSH 会话接到 QQ（OneBot/NapCat）。',
    categories: ['chat', 'automation'],
    stars: 15,
    commit: 'b1b2c3d4e5f67890123456789012345678901234',
    clientAdaptation: false,
    status: 'approved',
  },
  {
    name: '@g34y0r/dsh-deepseek-balance',
    alias: 'dsh-deepseek-balance',
    description: 'DeepSeek API 余额，常驻在 dsh 输入框旁边。零配置、零 token 成本。',
    categories: ['network', 'ai'],
    stars: 20,
    commit: 'c1b2c3d4e5f67890123456789012345678901234',
    clientAdaptation: true,
    status: 'approved',
  },
]

const imageRecommendationCatalog = [
  {
    name: 'dsh-auto-image',
    packageName: 'dsh-auto-image',
    displayName: '图像视觉工具（DSH Auto Image）',
    description: 'Bridges images into text for DeepSeek Harness; a configured vision model describes images.',
    searchTerms: ['图像视觉工具', '图片', '识图', 'vision', 'image'],
    categories: ['experimental'],
    status: 'approved',
    commit: 'a0663ac2b5c2244d32cfd03b0af058aa8800932e',
  },
  {
    name: 'dsh-auto-vision',
    packageName: 'dsh-auto-vision',
    displayName: '图像视觉工具（DSH Auto Vision）',
    description: '为纯文本 DSH 主模型搭视觉桥，通过 vision 工具把图片描述以纯文本返回。',
    searchTerms: ['图像视觉工具', '图片', '识图', 'vision', '多模态'],
    categories: ['visualization', 'tools'],
    status: 'approved',
    commit: 'ae57b74c5d87df17d0b0f0601ebc25d00ba8cccb',
  },
  {
    name: 'dsh-tun-proxy',
    packageName: 'dsh-tun-proxy',
    displayName: '实验功能插件（DSH Tun Proxy）',
    description: '为 DSH 提供实验功能插件能力。DSH proxy center: global TUN and subscriptions.',
    searchTerms: ['实验功能插件', 'DSH Tun Proxy', 'dsh-tun-proxy', '实验功能', 'dsh', 'tun', 'proxy'],
    categories: ['experimental'],
    status: 'approved',
    commit: '64efd538bbbee3b00b6d303a44c40c7028469395',
  },
  {
    name: 'dsh-plan-switch',
    packageName: 'dsh-plan-switch',
    displayName: '实验功能插件（DSH Plan Switch）',
    description: '为 DSH 提供实验功能插件能力。One-click enter/exit Plan mode.',
    searchTerms: ['实验功能插件', 'DSH Plan Switch', 'dsh-plan-switch', '实验功能', 'dsh', 'plan', 'switch'],
    categories: ['experimental'],
    status: 'approved',
    commit: 'c4b32611eec1b5c4992f01353f60801b78075e61',
  },
  {
    name: 'dsh-image-gen',
    packageName: 'dsh-image-gen',
    displayName: '图像生成（DSH Image Gen）',
    description: 'GPT Image generation through a configured model.',
    searchTerms: ['图像生成', '生图', 'image generation', 'image-gen'],
    categories: ['visualization'],
    status: 'approved',
    commit: '7c1a0c6e5b4d39281716151413121110abcdef12',
  },
  {
    name: 'blocked-vision',
    packageName: 'blocked-vision',
    displayName: 'Blocked Vision',
    description: 'A vision plugin for reading pictures.',
    searchTerms: ['图片', '视觉', 'vision'],
    categories: ['tools'],
    status: 'blocked',
    commit: '7c1a0c6e5b4d39281716151413121110abcdef12',
  },
  {
    name: 'unpinned-vision',
    packageName: 'unpinned-vision',
    displayName: 'Unpinned Vision',
    description: 'A vision plugin for reading pictures.',
    searchTerms: ['图片', '视觉', 'vision'],
    categories: ['tools'],
    status: 'approved',
    commit: 'main',
  },
]

test('tokenize splits keywords and Chinese terms', () => {
  const tokens = tokenize('知网 论文 精读 deepseek-balance')
  assert.ok(tokens.length >= 3)
  assert.deepEqual(tokenize('我需要dsh能读取图片 要用什么插件'), ['读取', '取图', '图片'])
})

test('searchCatalogCandidates scores and finds relevant plugins', () => {
  const results = searchCatalogCandidates('知网论文精读', sampleCatalog)
  assert.equal(results.length, 1)
  assert.equal(results[0].name, '@Jerry113245/dsh-cnki-agent')

  const balanceResults = searchCatalogCandidates('查询 DeepSeek 余额', sampleCatalog)
  assert.equal(balanceResults.length, 1)
  assert.equal(balanceResults[0].name, '@g34y0r/dsh-deepseek-balance')
})

test('image-reading request excludes generic plugins, generators, and non-installable catalog entries', () => {
  const results = searchCatalogCandidates('我需要dsh能读取图片 要用什么插件', imageRecommendationCatalog)
  assert.deepEqual(results.map(entry => entry.packageName), ['dsh-auto-image', 'dsh-auto-vision'])
  assert.equal(searchCatalogCandidates('我需要 DSH 插件', imageRecommendationCatalog).length, 0)
  assert.equal(searchCatalogCandidates('我需要 DSH 生成图片的插件', imageRecommendationCatalog).map(entry => entry.packageName).join(','), 'dsh-image-gen')

  const response = fallbackRecommend('我需要dsh能读取图片 要用什么插件', imageRecommendationCatalog)
  assert.deepEqual(response.plugins.map(plugin => plugin.name), ['dsh-auto-image', 'dsh-auto-vision'])
  assert.equal(fallbackRecommend('我需要 DSH 插件', imageRecommendationCatalog).plugins.length, 0)
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
