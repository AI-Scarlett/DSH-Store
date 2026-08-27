const translations = {
  zh: {
    'meta.title': '常见问题｜DSH STORE',
    'meta.description': 'DSH STORE 常见问题：了解 DeepSeek Harness 插件商城、插件安装、安全边界、目录来源、插件提交、开发方式与隐私说明。',
    'a11y.skip': '跳到主要内容',
    'nav.home': '首页', 'nav.store': '插件目录', 'nav.standards': '收录标准', 'nav.build': '开发插件', 'nav.faq': '常见问题', 'nav.about': '关于我们', 'nav.guide': '使用说明', 'nav.submit': '提交插件',
    'hero.title1': '常见问题，', 'hero.title2': '先把边界说清楚。', 'hero.lead': '从产品定位、插件安装到安全、开发和隐私，集中回答使用 DSH STORE 前最需要确认的问题。',
    'action.read': '开始阅读', 'action.catalog': '浏览插件目录', 'action.contact': '联系我们', 'action.top': '回到顶部 ↑',
    'signal.answerCount': '个核心问题，覆盖使用 DSH STORE 的完整决策路径。',
    'topic.product': '产品与信任', 'topic.install': '安装与权限', 'topic.catalog': '目录与开发', 'topic.support': '隐私与支持',
    'group.productLead': '先确认 DSH STORE 是什么，以及“可信”在这里具体代表什么。',
    'group.installLead': '理解网页、DSH Profile 与真实插件变更之间的边界。',
    'group.catalogLead': '了解目录权威来源，以及插件提交和开发路径。',
    'group.supportLead': '确认网站收集什么，以及遇到问题时去哪里。',
    q1: '什么是 DSH STORE？',
    a1: 'DSH STORE 是面向 DeepSeek Harness（DSH）的第三方插件商城与开发者入口，帮助用户发现插件、核对来源、权限和兼容性，并了解安全接入路径。',
    q2: 'DSH STORE 是 DeepSeek 或 DSH 官方商城吗？',
    a2: '不是。DSH STORE 是第三方产品，不代表 DeepSeek 或 DSH 官方，也不会替换、隐藏或冒充官方插件清单。',
    q3: '插件被收录或标记为可安装，等于完成安全审计吗？',
    a3: '不等于。收录表示条目满足当前目录的固定来源、标准结构和策略检查；它不是完整的代码安全审计、运行验收或零风险承诺。',
    q4: '官网会直接修改我的 DSH Profile 或安装插件吗？',
    a4: '不会。浏览、搜索和查看详情默认只读。实际安装或启停需要在 DSH 中使用明确的命令或计划，并由用户确认。',
    q5: '安装插件前应该检查什么？',
    a5: '先确认插件能力是否符合需求，再检查固定来源、提交版本、权限、兼容性、维护状态和恢复说明；未知信息应保持为未知。',
    q6: 'DSH STORE 如何展示插件权限？',
    a6: '目录会尽可能区分读取、写入、网络、凭据和生命周期能力，并说明用途与边界。无法由当前证据确认的权限不会被包装成已验证结论。',
    q7: '插件出现问题时如何停用或恢复？',
    a7: '使用 DSH 或插件管理器提供的明确停用路径，并保留安装前备份。真实变更应包含计划、前置哈希、健康检查和回滚；插件自身创建的数据需按其文档另行处理。',
    q8: '插件目录的数据来自哪里？',
    a8: '运行时目录权威来源是公开 GitHub 仓库中的 registry/catalog.json。插件源码使用固定提交引用，目录页面不会把临时搜索结果当作权威数据。',
    q9: '如何向 DSH STORE 提交插件？',
    a9: '通过 GitHub 的插件提交表单提供仓库、固定提交、清单、权限和兼容性信息。提交进入评审流程，不代表自动收录。',
    q10: '如何开发自己的 DSH 插件？',
    a10: '可以在开发插件页面安装开源 build-dsh-plugin Skill，用问题、目标结果和成功标准生成标准 Bundle、风险边界、测试和证据门槛。',
    q11: '搜索插件会上传我的关键词吗？',
    a11: '不会。目录搜索、筛选和排序在浏览器本地完成。站点只记录有限的匿名交互事件，不发送搜索词、邮件地址或 Profile 内容。',
    q12: '遇到问题或希望合作，如何联系 DSH STORE？',
    a12: '可以发送邮件至 jadename.zhou@gmail.com，或通过 X 上的 @JadeNameCulture 联系。插件提交请优先使用 GitHub 提交表单。',
    'cta.title': '没有找到你的问题？', 'cta.lead': '使用说明适合具体操作，联系我们适合反馈、合作与品牌交流。',
    'footer.lead': '先看清能力、来源、权限与边界，再决定下一步。', 'footer.note': '第三方商城 · 收录不等于安全审计',
  },
  en: {
    'meta.title': 'Frequently Asked Questions | DSH STORE',
    'meta.description': 'DSH STORE FAQ covering the DeepSeek Harness plugin marketplace, installation, safety boundaries, catalog sources, submissions, development, and privacy.',
    'a11y.skip': 'Skip to main content',
    'nav.home': 'Home', 'nav.store': 'Plugin catalog', 'nav.standards': 'Listing standards', 'nav.build': 'Build plugins', 'nav.faq': 'FAQ', 'nav.about': 'About us', 'nav.guide': 'Usage guide', 'nav.submit': 'Submit plugin',
    'hero.title1': 'Questions answered.', 'hero.title2': 'Boundaries made clear.', 'hero.lead': 'Clear answers about DSH STORE, plugin installation, safety, development, and privacy before you make a decision.',
    'action.read': 'Start reading', 'action.catalog': 'Browse plugin catalog', 'action.contact': 'Contact us', 'action.top': 'Back to top ↑',
    'signal.answerCount': 'essential answers covering the complete DSH STORE decision path.',
    'topic.product': 'Product and trust', 'topic.install': 'Installation and permissions', 'topic.catalog': 'Catalog and development', 'topic.support': 'Privacy and support',
    'group.productLead': 'Start with what DSH STORE is and what “trusted” actually means here.',
    'group.installLead': 'Understand the boundary between the website, a DSH Profile, and real plugin changes.',
    'group.catalogLead': 'Learn where catalog facts come from and how submission and development work.',
    'group.supportLead': 'See what the site collects and where to go when you need help.',
    q1: 'What is DSH STORE?',
    a1: 'DSH STORE is a third-party marketplace and developer gateway for DeepSeek Harness (DSH). It helps people discover plugins, inspect sources, permissions, and compatibility, and understand guarded access paths.',
    q2: 'Is DSH STORE an official DeepSeek or DSH marketplace?',
    a2: 'No. DSH STORE is a third-party product. It does not represent DeepSeek or DSH, and it never replaces, hides, or presents itself as the official plugin inventory.',
    q3: 'Does a listing or “installable” status mean a complete security audit?',
    a3: 'No. A listing means the entry meets the catalog’s current pinned-source, standard-structure, and policy checks. It is not a complete code security audit, runtime acceptance test, or zero-risk promise.',
    q4: 'Does the website modify my DSH Profile or install plugins directly?',
    a4: 'No. Browsing, searching, and reading details are read-only by default. Real installation or lifecycle actions use an explicit command or plan in DSH and require user confirmation.',
    q5: 'What should I check before installing a plugin?',
    a5: 'Confirm that the capability fits your need, then review the pinned source, commit, permissions, compatibility, maintenance state, and recovery notes. Unknown information should remain unknown.',
    q6: 'How does DSH STORE describe plugin permissions?',
    a6: 'The catalog separates read, write, network, credential, and lifecycle capabilities whenever evidence allows, with purpose and boundary details. Unconfirmed permissions are never presented as verified conclusions.',
    q7: 'How do I disable or recover from a problematic plugin?',
    a7: 'Use the explicit disable path provided by DSH or the plugin manager and preserve a pre-install backup. Real changes should include a plan, precondition hashes, health checks, and rollback. Data created by the plugin follows its own documentation.',
    q8: 'Where does the plugin catalog data come from?',
    a8: 'The runtime authority is registry/catalog.json in the public GitHub repository. Plugin sources use pinned commits, and the catalog never treats temporary search results as authoritative data.',
    q9: 'How can I submit a plugin to DSH STORE?',
    a9: 'Use the GitHub plugin submission form and provide the repository, pinned commit, manifest, permissions, and compatibility facts. Submission starts review; it does not guarantee automatic listing.',
    q10: 'How can I build my own DSH plugin?',
    a10: 'Install the open-source build-dsh-plugin Skill from the Build Plugins page. It turns a problem, desired outcome, and success criterion into a standard Bundle, risk boundary, tests, and evidence gates.',
    q11: 'Does plugin search upload my keywords?',
    a11: 'No. Catalog search, filtering, and sorting run locally in your browser. The site records only narrow anonymous interaction events and does not send search terms, email addresses, or Profile contents.',
    q12: 'How can I get help or discuss a partnership?',
    a12: 'Email jadename.zhou@gmail.com or contact @JadeNameCulture on X. For plugin submissions, use the GitHub submission form first.',
    'cta.title': 'Still have a question?', 'cta.lead': 'Use the guide for concrete operations, or contact us for feedback, partnerships, and brand conversations.',
    'footer.lead': 'Review capability, source, permissions, and boundaries before choosing the next step.', 'footer.note': 'Third-party marketplace · Listing is not a security audit',
  },
}

const storedLocale = (() => {
  try { return localStorage.getItem('dsh-marketplace-locale') } catch { return null }
})()
const defaultLocale = document.documentElement.dataset.defaultLocale === 'en' ? 'en' : 'zh'
const state = { locale: storedLocale === 'en' || storedLocale === 'zh' ? storedLocale : defaultLocale }
const t = key => translations[state.locale]?.[key] || translations.zh[key] || key
const analyticsToken = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)

function setLocale(locale) {
  state.locale = locale === 'en' ? 'en' : 'zh'
  try { localStorage.setItem('dsh-marketplace-locale', state.locale) } catch {}
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN'
  document.title = t('meta.title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'))
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', t('meta.title'))
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', t('meta.description'))
  document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', t('meta.title'))
  document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', t('meta.description'))
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n) })
  document.querySelectorAll('[data-locale]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.locale === state.locale)))
}

function sendDshEvent(event, details = {}) {
  if (!/^https?:$/.test(location.protocol)) return
  const eventName = analyticsToken(event)
  if (!eventName) return
  const url = new URL('/_events/dsh', location.origin)
  url.searchParams.set('event', eventName)
  url.searchParams.set('locale', state.locale)
  url.searchParams.set('site', analyticsToken(location.host))
  for (const field of ['item', 'value']) {
    const token = analyticsToken(details[field])
    if (token) url.searchParams.set(field, token)
  }
  try {
    if (navigator.sendBeacon?.(url, new Blob([], { type: 'text/plain' }))) return
    fetch(url, { method: 'POST', keepalive: true, cache: 'no-store', credentials: 'omit' }).catch(() => {})
  } catch {}
}

function observeReveals() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal').forEach(element => element.classList.add('visible'))
    return
  }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return
    entry.target.classList.add('visible')
    observer.unobserve(entry.target)
  }), { threshold: .08 })
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element))
}

document.querySelector('.locale-switch')?.addEventListener('click', event => {
  const button = event.target.closest('[data-locale]')
  if (!button || button.dataset.locale === state.locale) return
  setLocale(button.dataset.locale)
  sendDshEvent('locale_switch', { item: state.locale, value: 'faq' })
})

document.addEventListener('click', event => {
  const tracked = event.target.closest('[data-analytics-event]')
  if (tracked) sendDshEvent(tracked.dataset.analyticsEvent, { item: tracked.dataset.analyticsItem })
})

document.querySelectorAll('.faq-page-list details').forEach((detail, index) => {
  detail.addEventListener('toggle', () => {
    if (detail.open) sendDshEvent('faq_expand', { item: `question_${index + 1}` })
  })
})

setLocale(state.locale)
observeReveals()
sendDshEvent('faq_view', { item: 'knowledge_base' })
