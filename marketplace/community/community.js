const translations = {
  zh: {
    'meta.title': '社区与开发者｜DSH STORE',
    'meta.description': '加入 DSH STORE 插件生态：开发 DeepSeek Harness 插件、提交项目到公开 Catalog，或通过现有渠道反馈与交流。',
    'a11y.skip': '跳到主要内容',
    'nav.home': '首页', 'nav.store': '插件目录', 'nav.community': '社区与开发者', 'nav.standards': '收录标准', 'nav.build': '开发插件', 'nav.faq': '常见问题', 'nav.about': '关于我们', 'nav.guide': '使用说明', 'nav.submit': '提交插件',
    'hero.title1': '让插件生态，', 'hero.title2': '由开发者和用户共同推动。', 'hero.lead': '从构建标准插件、提交固定来源，到反馈问题与改进体验，每个入口都清晰可循。',
    'action.build': '开始开发插件', 'action.submit': '提交插件', 'action.standards': '阅读收录标准', 'action.top': '回到顶部 ↑',
    'paths.title': '选择适合你的参与方式。', 'paths.lead': '开发、提交和反馈是不同路径；我们会分别说明标准与下一步，不把提交误认为自动收录。',
    'card.build.title': '做一个自己的 DSH 插件', 'card.build.body': '从真实问题和可观察结果出发，使用 build-dsh-plugin 生成标准工程、风险边界和验证计划。', 'card.build.action': '查看开发工作台 ↗',
    'card.submit.title': '提交插件到商城', 'card.submit.body': '先核对固定 Commit、Bundle、许可证、权限与兼容性要求，再通过 GitHub 提交表单进入审查。', 'card.submit.action': '打开提交表单 ↗',
    'card.help.title': '交流、反馈与支持', 'card.help.body': '产品使用问题先查看 FAQ；目录或提交相关反馈请通过 DSH STORE GitHub 项目渠道联系。', 'card.help.action': '查看常见问题 ↗',
    'flow.title': '从一个问题，到可复核的插件。', 'flow.step1': '写清问题、预期结果和成功标准', 'flow.step2': '构建标准 Bundle，并验证风险与权限', 'flow.step3': '固定 Commit 后提交，等待目录策略审查', 'flow.step4': '通过公开 Catalog 读回后，用户再独立决定是否安装',
    'flow.boundary': '提交不代表自动收录；收录不等于安全审计或运行验收。真实安装和 Profile 变更仍由用户在 DSH 中决定。',
    'footer.lead': '一个让开发、审查和发现边界更清楚的插件生态。', 'footer.navTitle': '快速导航', 'footer.friendsTitle': '友情链接', 'footer.catalog': '插件目录', 'footer.community': '社区与开发者', 'footer.build': '开发插件', 'footer.standards': '收录标准', 'footer.faq': '常见问题', 'footer.about': '关于我们', 'footer.note': '第三方生态入口 · 提交不代表自动收录',
  },
  en: {
    'meta.title': 'Community & Developers | DSH STORE',
    'meta.description': 'Join the DSH STORE ecosystem: build DeepSeek Harness plugins, submit projects to the public Catalog, or share feedback through established channels.',
    'a11y.skip': 'Skip to main content',
    'nav.home': 'Home', 'nav.store': 'Plugin catalog', 'nav.community': 'Community & creators', 'nav.standards': 'Listing standards', 'nav.build': 'Build plugins', 'nav.faq': 'FAQ', 'nav.about': 'About us', 'nav.guide': 'Usage guide', 'nav.submit': 'Submit plugin',
    'hero.title1': 'A plugin ecosystem,', 'hero.title2': 'built by developers and users.', 'hero.lead': 'Build standard plugins, submit pinned sources, share feedback, and improve the experience through clear paths.',
    'action.build': 'Start building', 'action.submit': 'Submit a plugin', 'action.standards': 'Read listing standards', 'action.top': 'Back to top ↑',
    'paths.title': 'Choose how you want to participate.', 'paths.lead': 'Building, submission, and feedback are separate paths. Each has a clear standard and next step; submission is never mistaken for automatic admission.',
    'card.build.title': 'Build a DSH plugin', 'card.build.body': 'Start from a real problem and observable outcome. Use build-dsh-plugin to create a standard project, risk boundaries, and verification plan.', 'card.build.action': 'Open the build lab ↗',
    'card.submit.title': 'Submit a plugin to the store', 'card.submit.body': 'Check the pinned Commit, Bundle, license, permissions, and compatibility requirements, then submit the project through GitHub for review.', 'card.submit.action': 'Open the submission form ↗',
    'card.help.title': 'Connect, share feedback, and get help', 'card.help.body': 'Start with the FAQ for product questions. Use the DSH STORE GitHub project for catalog or submission feedback.', 'card.help.action': 'Read the FAQ ↗',
    'flow.title': 'From a problem to a reviewable plugin.', 'flow.step1': 'Define the problem, expected outcome, and success criteria', 'flow.step2': 'Build a standard Bundle and review risks and permissions', 'flow.step3': 'Pin a Commit, submit it, and wait for policy review', 'flow.step4': 'After public Catalog readback, users independently decide whether to install',
    'flow.boundary': 'Submission does not mean automatic admission. A listing is not a security audit or runtime acceptance. Users decide on real installation and Profile changes in DSH.',
    'footer.lead': 'A plugin ecosystem with clear paths for building, review, and discovery.', 'footer.navTitle': 'Explore', 'footer.friendsTitle': 'Friends', 'footer.catalog': 'Plugin catalog', 'footer.community': 'Community & developers', 'footer.build': 'Build plugins', 'footer.standards': 'Listing standards', 'footer.faq': 'FAQ', 'footer.about': 'About us', 'footer.note': 'Third-party ecosystem · Submission does not mean admission',
  },
}

const saved = (() => { try { return localStorage.getItem('dsh-marketplace-locale') } catch { return null } })()
const locale = { value: saved === 'en' || saved === 'zh' ? saved : (document.documentElement.dataset.defaultLocale === 'en' ? 'en' : 'zh') }
const t = key => translations[locale.value]?.[key] || translations.zh[key] || key
const token = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)

function setLocale(next) {
  locale.value = next === 'en' ? 'en' : 'zh'
  try { localStorage.setItem('dsh-marketplace-locale', locale.value) } catch {}
  document.documentElement.lang = locale.value === 'en' ? 'en' : 'zh-CN'
  document.title = t('meta.title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'))
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n) })
  document.querySelectorAll('[data-locale]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.locale === locale.value)))
}

function track(event, item) {
  if (!/^https?:$/.test(location.protocol)) return
  const url = new URL('/_events/dsh', location.origin)
  url.searchParams.set('event', token(event))
  url.searchParams.set('locale', locale.value)
  url.searchParams.set('site', token(location.host))
  url.searchParams.set('item', token(item))
  try { if (!navigator.sendBeacon?.(url, new Blob([], { type: 'text/plain' }))) fetch(url, { method: 'POST', keepalive: true, cache: 'no-store', credentials: 'omit' }).catch(() => {}) } catch {}
}

document.querySelectorAll('[data-locale]').forEach(button => button.addEventListener('click', () => setLocale(button.dataset.locale)))
document.querySelectorAll('[data-analytics-event]').forEach(link => link.addEventListener('click', () => track(link.dataset.analyticsEvent, link.dataset.analyticsItem)))
setLocale(locale.value)
