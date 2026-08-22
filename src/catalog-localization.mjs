const HAN = /[\u3400-\u9fff]/u
const FORMATTED_NAME = /^(?<chinese>.+[\u3400-\u9fff].*)（(?<english>[^（）]*[A-Za-z0-9@][^（）]*)）$/u

const ACRONYMS = new Map(Object.entries({
  dsh: 'DSH', api: 'API', asr: 'ASR', cli: 'CLI', codex: 'Codex', csv: 'CSV', ffmpeg: 'FFmpeg',
  git: 'Git', github: 'GitHub', html: 'HTML', im: 'IM', json: 'JSON', llm: 'LLM', mcp: 'MCP',
  ocr: 'OCR', oauth: 'OAuth', ppt: 'PPT', pwa: 'PWA', qq: 'QQ', rss: 'RSS', sql: 'SQL',
  ssh: 'SSH', tts: 'TTS', ui: 'UI', webui: 'Web UI', websocket: 'WebSocket', wsl: 'WSL',
  deepseek: 'DeepSeek', chatgpt: 'ChatGPT', claude: 'Claude', openai: 'OpenAI', oss: 'OSS',
  qqbot: 'QQ Bot', wecom: 'WeCom', hyperframes: 'HyperFrames',
}))

const CATEGORY_TERMS = {
  marketplace: ['插件市场', '商城', '插件发现'], management: ['插件管理', '管理'], sessions: ['会话', '对话', '历史消息'],
  import: ['导入', '迁移'], models: ['模型', '模型提供商'], routing: ['路由', '故障切换'], ui: ['界面', '交互', '侧栏'],
  themes: ['主题', '皮肤', '外观'], memory: ['记忆', '知识库', '召回'], tools: ['工具', '能力'], workflow: ['工作流', '自动化', '任务'],
  notifications: ['通知', '提醒', '消息'], development: ['开发', '调试', '运行时'], fun: ['趣味', '桌宠', '娱乐'], files: ['文件', '工作区', '附件'],
  visualization: ['可视化', '图表', '看板'], design: ['设计', '画布', '原型'], search: ['搜索', '联网', '浏览器'], suites: ['综合套件', '工具套件'],
  clients: ['客户端', '移动端', '远程访问'], security: ['安全', '审计', '防护'], experimental: ['实验功能', '新功能'],
}

const CATEGORY_LABELS = {
  marketplace: '插件市场与管理', management: '插件管理工具', sessions: '会话管理', import: '配置导入迁移',
  models: '模型接入工具', routing: '模型路由工具', ui: '界面交互工具', themes: '界面主题与美化',
  memory: '记忆与知识库', tools: '实用工具', workflow: '任务与工作流自动化', notifications: '任务通知提醒',
  development: '插件开发工具', fun: '趣味互动插件', files: '文件与工作区工具', visualization: '图表与数据可视化',
  design: '画板与设计工具', search: '搜索与浏览工具', suites: '综合工具套件', clients: '客户端工具',
  security: '安全防护工具', experimental: '实验功能插件',
}

const CAPABILITY_RULES = [
  [/web-billing|billing|cost-meter|convo-cost|session-cost|费用|计费|账单|billing|cost\b/i, '费用与账单', ['费用', '计费', '账单', '成本']],
  [/balance|quota|余额|额度|wallet/i, '余额与额度监控', ['余额', '额度', '配额', '钱包']],
  [/task-notify|notify-skill|notification|提醒|通知/i, '任务通知提醒', ['任务完成', '通知', '提醒', '消息推送']],
  [/pomodoro|番茄钟/i, '专注计时器', ['番茄钟', '专注', '计时', '提醒']],
  [/ccswitch|profile.*import|movein|迁移|导入/i, '配置导入迁移', ['配置导入', '配置迁移', '搬家']],
  [/qqbot|\bqq\b.*(?:bot|channel)|QQ 机器人/i, 'QQ 机器人连接器', ['QQ', '机器人', '消息连接器']],
  [/wecom|企业微信/i, '企业微信连接器', ['企业微信', 'WeCom', '消息连接器']],
  [/dingtalk|钉钉/i, '钉钉连接器', ['钉钉', '群机器人', '消息连接器']],
  [/\blark\b|飞书/i, '飞书连接器', ['飞书', 'Lark', '消息连接器']],
  [/slack/i, 'Slack 连接器', ['Slack', '消息连接器', '通知']],
  [/email|smtp|imap|邮件/i, '邮件收发工具', ['邮件', '收件箱', '发信', '附件']],
  [/calendar|caldav|日历|日程/i, '日历日程管理', ['日历', '日程', 'CalDAV']],
  [/hacker.news/i, 'Hacker News 阅读器', ['Hacker News', '科技资讯', '讨论']],
  [/prompt.optimizer|提示词优化/i, '提示词优化器', ['提示词', '指令优化', 'Prompt']],
  [/prompt.manager|提示词库/i, '提示词管理器', ['提示词', '提示词库', '系统提示']],
  [/desktop.shortcut|快捷方式/i, '桌面快捷启动', ['桌面快捷方式', '一键启动', 'Windows']],
  [/desktop|tray|托盘|桌面壳/i, '桌面客户端', ['桌面', '托盘', '快捷启动']],
  [/codex.*(?:connect|oauth|subscription)|oai-oauth|chatgpt.*oauth/i, 'Codex 模型接入', ['Codex', 'ChatGPT', 'OAuth', '模型']],
  [/llm.failover|ha.orchestrator|failover|故障回退|熔断/i, '模型故障切换', ['模型路由', '故障切换', '高可用', '熔断']],
  [/provider|llm|model|模型提供|模型接入/i, '模型提供商接入', ['模型', 'LLM', 'Provider', '模型接入']],
  [/chat.import|会话导入/i, '会话导入', ['会话', '导入', 'ChatGPT', 'Claude', 'Codex']],
  [/archive.manager|归档会话/i, '会话归档管理', ['会话', '归档', '恢复', '删除']],
  [/rewind|回退|checkpoint/i, '会话与文件回退', ['回退', '检查点', '恢复', '会话']],
  [/timeline|turn.rail|index.rail|navigation.bar|导航条/i, '会话导航', ['会话导航', '消息定位', '时间线']],
  [/session|chat|conversation|会话|对话/i, '会话管理', ['会话', '对话', '历史', '消息']],
  [/remotion/i, 'Remotion 视频制作', ['Remotion', '视频', '动画', '字幕']],
  [/hyperframes/i, 'HyperFrames 视频制作', ['HyperFrames', '视频', '动画']],
  [/ffmpeg/i, 'FFmpeg 视频处理', ['FFmpeg', '视频', '转码', '字幕', 'GIF']],
  [/\bppt\b|powerpoint|演示文稿/i, '演示文稿制作', ['PPT', '演示文稿', '幻灯片']],
  [/office/i, 'Office 文档工具', ['Word', 'Excel', 'PowerPoint', 'Office']],
  [/sql|database|数据库/i, '数据库与 SQL 工具', ['数据库', 'SQL', 'SQLite', 'MySQL', 'PostgreSQL']],
  [/docker/i, 'Docker 管理工具', ['Docker', '容器', '镜像', '日志']],
  [/rss|atom/i, 'RSS 订阅阅读', ['RSS', 'Atom', '订阅']],
  [/git.branch|branch.switch|分支切换/i, 'Git 分支切换', ['Git', '分支', '切换']],
  [/github|git-|\bgit\b|代码审查|pull request/i, 'GitHub 工程工具', ['GitHub', 'Git', '代码审查', 'PR']],
  [/flake|test.drive|测试稳定|冒烟测试/i, '插件测试工具', ['测试', '冒烟测试', '稳定性', '隔离环境']],
  [/review|advisor|审查/i, '审查与验证助手', ['审查', '验证', '质量检查']],
  [/security|guard|proof|receipt|verification|secure|安全|防护|审计/i, '安全防护工具', ['安全', '审计', '验证', '防护']],
  [/terminal|shell|console|pty|终端|命令行/i, '终端命令工具', ['终端', 'Shell', '命令行', 'PTY']],
  [/browser.desktop|browser|preview|pilot|网页验证|浏览器/i, '浏览器与网页工具', ['浏览器', '网页', '页面操作', '截图']],
  [/tavily|metaso|anysearch|web.search|联网搜索|搜索提供/i, '联网搜索工具', ['联网搜索', '网页搜索', 'Web']],
  [/ocr|文字识别|文档解析/i, 'OCR 文字识别', ['OCR', '文字识别', '文档解析']],
  [/image.gen|draw|gacha|图片生成|生图/i, '图像生成工具', ['图像生成', '生图', '图片']],
  [/vision|image|sight|视觉|识图|图片/i, '图像视觉工具', ['视觉', '识图', '图片', '多模态']],
  [/diagram|mermaid|visualize|archify|excalidraw|图解|架构图/i, '图表与架构可视化', ['图表', '架构图', '流程图', '可视化']],
  [/blender|3d|三维/i, '三维设计工具', ['Blender', '三维', '建模', '渲染']],
  [/openpencil|canvas|画板|画布|设计/i, '画板与设计工具', ['画板', '画布', '设计', '原型']],
  [/usage|token|stats|dashboard|meter|heatmap|用量|统计|看板/i, '用量统计看板', ['用量', 'Token', '统计', '看板']],
  [/memory|engram|mnemon|vault|qmd|记忆|知识库/i, '记忆与知识库', ['记忆', '知识库', '召回', '长期记忆']],
  [/(?:^|[^a-z])(?:voice|speech|tts|asr|mic)(?:[^a-z]|$)|语音/i, '语音输入与朗读', ['语音', '录音', '转写', '朗读']],
  [/translate|translator|翻译/i, '翻译助手', ['翻译', '多语言']],
  [/humanizer|writing|outline|写作|润色/i, '写作与润色助手', ['写作', '润色', '文章']],
  [/linked.folder|workspace.explorer|file|path|workspace|文件|工作区|附件/i, '文件与工作区工具', ['文件', '工作区', '目录', '附件']],
  [/mobile|pwa|pocket|remote|手机|移动端|远程访问/i, '移动端与远程访问', ['移动端', '手机', '远程访问', 'PWA']],
  [/sync|backup|同步|备份/i, '同步与备份工具', ['同步', '备份', '恢复']],
  [/subagent|agent.team|orchestrator|多代理|子代理/i, '多代理协作', ['多代理', '子代理', '团队', '编排']],
  [/taskboard|automation|workflow|task|loop|任务|工作流|自动化/i, '任务与工作流自动化', ['任务', '工作流', '自动化', '定时']],
  [/hot.reload|restart|boot.guard|update.copilot|更新|重启|热重载/i, '插件更新与恢复', ['更新', '重启', '热重载', '恢复']],
  [/skill|技能/i, '技能管理工具', ['技能', 'Skill', '扩展能力']],
  [/theme|skin|background|font|tidy|sidebar|overlay|主题|皮肤|背景|字体|侧栏/i, '界面主题与美化', ['主题', '皮肤', '背景', '界面美化']],
  [/pet|whale|gomoku|emoji|achievement|gacha|clippy|ikun|fun|桌宠|五子棋|成就/i, '趣味互动插件', ['趣味', '桌宠', '互动', '娱乐']],
  [/toy|buttplug|intiface/i, '智能设备控制', ['设备控制', 'Intiface', '智能硬件']],
  [/market|store|商城|插件市场/i, '插件市场与管理', ['插件市场', '商城', '插件管理']],
]

function titleToken(token) {
  const lower = token.toLowerCase()
  if (ACRONYMS.has(lower)) return ACRONYMS.get(lower)
  if (/^\d+d$/i.test(token)) return token.toUpperCase()
  return lower ? `${lower[0].toUpperCase()}${lower.slice(1)}` : ''
}

export function englishPluginName(entry) {
  const current = String(entry?.name ?? '').trim()
  const formatted = FORMATTED_NAME.exec(current)
  if (formatted) return formatted.groups.english.trim().slice(0, 100)
  if (current && !HAN.test(current) && !/^@?[a-z0-9._/-]+$/i.test(current)) return current.slice(0, 100)
  const source = String(entry?.packageName || entry?.id || current || 'DSH Plugin')
    .replace(/^@[^/]+\//, '').replace(/[._/-]+/g, ' ').trim()
  return source.split(/\s+/u).filter(Boolean).map(titleToken).join(' ').slice(0, 100) || 'DSH Plugin'
}

function existingChineseName(value) {
  const current = String(value ?? '').trim()
  const formatted = FORMATTED_NAME.exec(current)
  if (formatted) return formatted.groups.chinese.trim()
  if (HAN.test(current)) return current.replace(/\s*\([^()]*[A-Za-z][^()]*\)\s*$/u, '').trim()
  return null
}

function capability(entry) {
  const identity = [entry?.id, entry?.packageName, entry?.name].join(' ')
  for (const [pattern, label, terms] of CAPABILITY_RULES) {
    if (pattern.test(identity)) return { label, terms }
  }
  const source = [entry?.description, ...(entry?.categories ?? [])].join(' ')
  for (const [pattern, label, terms] of CAPABILITY_RULES) {
    if (pattern.test(source)) return { label, terms }
  }
  const category = (entry?.categories ?? []).find(id => CATEGORY_TERMS[id])
  const terms = CATEGORY_TERMS[category] ?? ['DSH', '插件', '工具']
  return { label: CATEGORY_LABELS[category] ?? 'DSH 实用插件', terms }
}

export function localizeCatalogEntry(entry, categories = {}) {
  const englishName = englishPluginName(entry)
  const matched = capability(entry)
  const chineseName = (existingChineseName(entry?.name) || matched.label).slice(0, 50)
  const name = `${chineseName}（${englishName.slice(0, 100)}）`
  const originalDescription = String(entry?.description ?? '').replace(/\s+/gu, ' ').trim()
  const description = HAN.test(originalDescription)
    ? originalDescription.slice(0, 2_000)
    : `为 DSH 提供${chineseName}能力。英文原始说明：${originalDescription || englishName}`.slice(0, 2_000)
  const categoryTerms = (entry?.categories ?? []).flatMap(id => [categories[id], ...(CATEGORY_TERMS[id] ?? [])])
  const packageTokens = String(entry?.packageName ?? '').replace(/^@[^/]+\//, '').split(/[^A-Za-z0-9]+/u).filter(token => token.length >= 2)
  const searchTerms = [...new Set([
    chineseName, englishName, entry?.id, entry?.packageName, ...matched.terms, ...categoryTerms, ...packageTokens,
  ].map(value => String(value ?? '').trim()).filter(Boolean))].slice(0, 40)
  return { ...entry, name, description, searchTerms }
}

export function assertCatalogLocalization(catalog) {
  if (!catalog || !Array.isArray(catalog.entries)) throw new TypeError('localized catalog entries are required')
  for (const [index, entry] of catalog.entries.entries()) {
    if (!FORMATTED_NAME.test(String(entry.name ?? ''))) {
      throw new TypeError(`entries[${index}].name must use 中文名（English Name）`)
    }
    if (!HAN.test(String(entry.description ?? ''))) {
      throw new TypeError(`entries[${index}].description must include a Chinese user-facing explanation`)
    }
    if (!Array.isArray(entry.searchTerms) || entry.searchTerms.length < 3 || entry.searchTerms.length > 40
      || !entry.searchTerms.some(term => HAN.test(String(term)))) {
      throw new TypeError(`entries[${index}].searchTerms must contain bounded Chinese search aliases`)
    }
  }
  return catalog
}
