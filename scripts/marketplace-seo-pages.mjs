const SITE_ORIGIN = 'https://dsh.store'

export const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])

const xmlEscape = htmlEscape
const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const categoryEnglish = {
  development: 'Development', workflow: 'Workflow', tools: 'Tools', marketplace: 'Marketplace', management: 'Management',
  productivity: 'Productivity', model: 'Models', provider: 'Providers', ui: 'Interface', theme: 'Themes',
  communication: 'Communication', automation: 'Automation', search: 'Search', data: 'Data', security: 'Security',
}
const permissionEnglish = { low: 'Low', medium: 'Medium', high: 'High', unknown: 'Unknown' }
const statusEnglish = { approved: 'Approved listing', blocked: 'Listed for reference', unlisted: 'Not public' }

export const safeEntryId = value => {
  const id = String(value || '')
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(id)) throw new Error(`Unsupported catalog entry id for static page: ${id}`)
  return id
}

const safeRepositoryUrl = value => {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol === 'https:' && url.hostname === 'github.com' && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) return url.toString().replace(/\/$/, '').replace(/\.git$/, '')
  } catch {}
  return null
}

const asList = (value, fallback) => Array.isArray(value) && value.length ? value.map(item => String(item)).join(' · ') : fallback
const fieldValue = (value, fallback = 'Not declared') => value === undefined || value === null || value === '' ? fallback : String(value)
const categoryName = (id, categories) => categories?.[id] || id
const categoryNameEn = id => categoryEnglish[id] || id.replace(/[-_]+/g, ' ')
const dateOnly = value => {
  const date = new Date(value || 0)
  return Number.isNaN(date.valueOf()) ? '1970-01-01' : date.toISOString().slice(0, 10)
}

const publicUrl = path => `${SITE_ORIGIN}${path}`
const socialImage = `${SITE_ORIGIN}/dsh-store-social-v2.png`

function alternateLinks(zhUrl, enUrl) {
  return `<link rel="alternate" hreflang="zh-CN" href="${htmlEscape(zhUrl)}">
  <link rel="alternate" hreflang="en" href="${htmlEscape(enUrl)}">
  <link rel="alternate" hreflang="x-default" href="${htmlEscape(zhUrl)}">`
}

function brandHeader({ assetPrefix, active, zhUrl }) {
  const navItems = [
    ['home', `${SITE_ORIGIN}/en/`, 'Home'],
    ['plugins', `${SITE_ORIGIN}/en/plugins/`, 'Plugin catalog'],
    ['build', `${SITE_ORIGIN}/en/build/`, 'Build plugins'],
    ['faq', `${SITE_ORIGIN}/en/faq/`, 'FAQ'],
    ['about', `${SITE_ORIGIN}/en/about/`, 'About'],
  ]
  return `<header class="site-header" id="top">
    <a class="brand" href="${SITE_ORIGIN}/en/" aria-label="DSH STORE">
      <span class="brand-wordmark-frame" aria-hidden="true"><img class="brand-wordmark" src="${assetPrefix}dsh-store-wordmark.png" alt="" width="1448" height="1086"></span>
    </a>
    <nav class="site-nav" aria-label="Primary navigation">
      ${navItems.map(([id, href, label]) => `<a href="${href}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      <a href="https://github.com/AI-Scarlett/dsh-safe-plugin-manager/blob/main/README.md" target="_blank" rel="noreferrer">Usage guide <i class="nav-external" aria-hidden="true">↗</i></a>
      <a href="https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml" target="_blank" rel="noreferrer">Submit a plugin <i class="nav-external" aria-hidden="true">↗</i></a>
    </nav>
    <div class="header-tools"><div class="locale-switch" role="group" aria-label="Language"><a href="${htmlEscape(zhUrl)}" lang="zh-CN">中文</a><a href="#top" aria-current="true">EN</a></div></div>
  </header>`
}

function footer(assetPrefix) {
  return `<footer class="site-footer"><div class="footer-main">
    <a class="brand brand-footer" href="${SITE_ORIGIN}/en/" aria-label="DSH STORE"><span class="brand-wordmark-frame" aria-hidden="true"><img class="brand-wordmark" src="${assetPrefix}dsh-store-wordmark.png" alt="" width="1448" height="1086"></span></a>
    <p>Third-party discovery and development gateway for DeepSeek Harness plugins.</p>
    <a class="footer-top" href="#top">Back to top ↑</a>
  </div><div class="footer-bottom"><span>AUTHORITY · GitHub <code>registry/catalog.json</code></span><span>Browsing does not modify a DSH Profile.</span></div></footer>`
}

function pageDocument({ title, description, canonical, zhUrl, assetPrefix, active, body, schema }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${htmlEscape(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <meta name="theme-color" content="#07113f">
  <meta name="application-name" content="DSH STORE">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="DSH STORE">
  <meta property="og:title" content="${htmlEscape(title)}">
  <meta property="og:description" content="${htmlEscape(description)}">
  <meta property="og:url" content="${htmlEscape(canonical)}">
  <meta property="og:image" content="${socialImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${htmlEscape(title)}">
  <meta name="twitter:description" content="${htmlEscape(description)}">
  <meta name="twitter:image" content="${socialImage}">
  <title>${htmlEscape(title)}</title>
  <link rel="canonical" href="${htmlEscape(canonical)}">
  ${alternateLinks(zhUrl, canonical)}
  <link rel="alternate" type="text/plain" href="${SITE_ORIGIN}/llms.txt" title="DSH STORE for AI agents">
  <link rel="icon" type="image/png" sizes="1254x1254" href="${assetPrefix}dsh-store-icon.png">
  <link rel="apple-touch-icon" href="${assetPrefix}dsh-store-icon.png">
  <link rel="stylesheet" href="${assetPrefix}styles.css">
  <script type="application/ld+json">${jsonForScript(schema)}</script>
</head>
<body class="seo-page en-page">
  <a class="skip-link" href="#content">Skip to content</a>
  <div class="tech-grid" aria-hidden="true"></div>
  ${brandHeader({ assetPrefix, active, zhUrl })}
  <main id="content">${body}</main>
  ${footer(assetPrefix)}
</body>
</html>`
}

const organizationSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': `${SITE_ORIGIN}/#organization`, name: 'DSH STORE', url: `${SITE_ORIGIN}/`, logo: `${SITE_ORIGIN}/dsh-store-icon.png`, email: 'jadename.zhou@gmail.com', sameAs: ['https://x.com/JadeNameCulture'] },
    { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, url: `${SITE_ORIGIN}/`, name: 'DSH STORE', inLanguage: ['zh-CN', 'en'], description: 'A third-party discovery, development, and trusted-access gateway for DeepSeek Harness plugins.' },
  ],
}

export function renderEnglishHome({ entries }) {
  const featured = entries.filter(entry => entry.featured === true && entry.status === 'approved').slice(0, 4)
  const canonical = publicUrl('/en/')
  const body = `<section class="seo-hero section-shell">
    <div><span class="eyebrow"><span class="live-dot"></span>DSH STORE / ENGLISH</span><h1>Discover DSH plugins with <em>traceable source.</em></h1><p class="seo-lead">DSH STORE is an independent, third-party discovery and development gateway for DeepSeek Harness (DSH) plugins. It keeps the repository, pinned commit, declared permissions, compatibility, and review fields visible before you choose a next step.</p><div class="hero-actions"><a class="button button-primary" href="./plugins/">Browse the catalog <i aria-hidden="true">→</i></a><a class="button button-secondary" href="https://github.com/AI-Scarlett/dsh-safe-plugin-manager/blob/main/README.md" target="_blank" rel="noreferrer">Read the usage guide <i aria-hidden="true">↗</i></a></div></div>
    <aside class="seo-signal-card"><span>PUBLIC CATALOG</span><strong>${entries.filter(entry => entry.status !== 'unlisted').length}</strong><p>public plugin records are generated from the repository Catalog. A listing is evidence of source metadata, not a complete security audit.</p></aside>
  </section>
  <section class="seo-section section-shell"><div class="seo-section-heading"><span>WHAT THE STORE MAKES VISIBLE</span><h2>Discover, inspect, then decide.</h2><p>Use the catalog for facts that are easy to lose in a repository list: exact source pins, declared boundaries, and explicit unknowns.</p></div><div class="seo-feature-grid"><article><b>01 / Discover</b><h3>Find the right capability</h3><p>Browse a growing plugin directory by name, package, category, and source repository.</p></article><article><b>02 / Inspect</b><h3>Keep trust context visible</h3><p>Each record shows its Catalog status, version, fixed commit, license, declared permissions, and compatibility data.</p></article><article><b>03 / Build</b><h3>Start with a standard workflow</h3><p>The public build Skill helps developers structure and review a non-destructive DSH plugin before submitting it.</p></article></div></section>
  <section class="seo-section section-shell"><div class="seo-section-heading"><span>FEATURED RECORDS</span><h2>Start with these projects.</h2></div><div class="seo-feature-grid seo-featured-grid">${featured.map(entry => `<article><b>${htmlEscape(entry.packageName)} · v${htmlEscape(entry.version)}</b><h3>${htmlEscape(entry.name)}</h3><p lang="zh-CN">${htmlEscape(entry.description)}</p><a class="details-button" href="../plugins/${safeEntryId(entry.id)}/">Open plugin record →</a></article>`).join('')}</div></section>
  <section class="seo-boundary section-shell"><span>IMPORTANT BOUNDARY</span><p>DSH STORE does not replace the official DSH plugin inventory and is not an official DeepSeek property. Browsing this site does not install anything or modify a DSH Profile. A real Profile change stays inside the official DSH CLI workflow with its own fresh plan, exact confirmation, backup, health checks, and rollback.</p></section>`
  const schema = {
    ...organizationSchema,
    '@graph': [...organizationSchema['@graph'], {
      '@type': 'WebPage', '@id': `${canonical}#webpage`, url: canonical, name: 'DSH STORE | DeepSeek Harness Plugin Marketplace', description: 'English discovery and developer gateway for third-party DeepSeek Harness plugins.', isPartOf: { '@id': `${SITE_ORIGIN}/#website` }, inLanguage: 'en',
    }],
  }
  return pageDocument({ title: 'DSH STORE | DeepSeek Harness Plugin Marketplace', description: 'Discover third-party DeepSeek Harness plugins with pinned source, declared permissions, compatibility, and clear trust boundaries.', canonical, zhUrl: publicUrl('/'), assetPrefix: '../', active: 'home', body, schema })
}

export function renderEnglishCatalog({ entries, categories }) {
  const visible = entries.filter(entry => entry.status !== 'unlisted')
  const canonical = publicUrl('/en/plugins/')
  const body = `<section class="seo-hero section-shell"><div><span class="eyebrow"><span class="live-dot"></span>PLUGIN CATALOG / ENGLISH INDEX</span><h1>Every public record, <em>with its source context.</em></h1><p class="seo-lead">This static index lists ${visible.length} public Catalog records. Plugin names and descriptions stay in their original catalog language where no verified English source text exists.</p><div class="hero-actions"><a class="button button-primary" href="${SITE_ORIGIN}/plugins/">Open interactive catalog <i aria-hidden="true">→</i></a><a class="button button-secondary" href="${SITE_ORIGIN}/registry/catalog.json" target="_blank" rel="noreferrer">Read catalog JSON <i aria-hidden="true">↗</i></a></div></div><aside class="seo-signal-card"><span>CATALOG AUTHORITY</span><strong>${visible.length}</strong><p>Each page is generated from the same public <code>registry/catalog.json</code> that powers the marketplace.</p></aside></section>
  <section class="seo-section section-shell"><div class="seo-section-heading"><span>DIRECTORY</span><h2>Plugin records</h2><p>Open an individual record to review the repository URL, fixed commit, version, license, declared permissions, and compatibility fields.</p></div><div class="seo-directory" role="list">${visible.map(entry => {
    const details = entry.details || {}
    const permissions = details.permissions || {}
    const id = safeEntryId(entry.id)
    return `<article class="seo-directory-item" role="listitem" data-static-plugin-id="${htmlEscape(id)}"><div><span>${htmlEscape(statusEnglish[entry.status] || entry.status)}</span><h3><a href="${SITE_ORIGIN}/plugins/${id}/">${htmlEscape(entry.name)}</a></h3><small>${htmlEscape(entry.packageName)} · v${htmlEscape(entry.version)}</small><p lang="zh-CN">${htmlEscape(entry.description)}</p></div><dl><div><dt>Categories</dt><dd>${htmlEscape(asList(entry.categories?.map(categoryNameEn), 'Not declared'))}</dd></div><div><dt>Permission level</dt><dd>${htmlEscape(permissionEnglish[permissions.level] || 'Unknown')}</dd></div><div><dt>License</dt><dd>${htmlEscape(fieldValue(details.license, 'Not declared'))}</dd></div></dl></article>`
  }).join('')}</div></section>`
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${canonical}#catalog`, url: canonical, name: 'DSH STORE Plugin Catalog', description: 'An English index of public third-party DeepSeek Harness plugin records with source and declared trust context.', isPartOf: { '@id': `${SITE_ORIGIN}/#website` }, inLanguage: 'en', numberOfItems: visible.length },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'DSH STORE', item: `${SITE_ORIGIN}/en/` }, { '@type': 'ListItem', position: 2, name: 'Plugin catalog', item: canonical }] },
    ],
  }
  return pageDocument({ title: 'DSH Plugin Catalog | DSH STORE', description: 'Browse public DeepSeek Harness plugin records with source repositories, fixed commits, versions, licenses, declared permissions, and compatibility data.', canonical, zhUrl: publicUrl('/plugins/'), assetPrefix: '../../', active: 'plugins', body, schema })
}

export function renderEnglishBuild() {
  const canonical = publicUrl('/en/build/')
  const body = `<section class="seo-hero section-shell"><div><span class="eyebrow"><span class="live-dot"></span>BUILD / DSH PLUGIN</span><h1>Build DSH plugins with <em>clear boundaries.</em></h1><p class="seo-lead"><code>build-dsh-plugin</code> is an MIT-licensed Agent Skill for turning a plugin brief into a standard DSH Bundle, evidence plan, tests, and a marketplace candidate. It does not silently install a plugin into a DSH Profile.</p><div class="hero-actions"><a class="button button-primary" href="https://github.com/AI-Scarlett/build-dsh-plugin/" target="_blank" rel="noreferrer">Open build-dsh-plugin <i aria-hidden="true">↗</i></a><a class="button button-secondary" href="https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml" target="_blank" rel="noreferrer">Submit a finished plugin <i aria-hidden="true">↗</i></a></div></div><aside class="seo-signal-card"><span>DEVELOPER SKILL</span><strong>MIT</strong><p>Start with the current problem, expected outcome, and an observable success criterion. Keep release and runtime acceptance separate.</p></aside></section>
  <section class="seo-section section-shell"><div class="seo-section-heading"><span>HOW TO USE THE SKILL</span><h2>Give an agent the repository URL.</h2><p>Use your agent's supported skill installation flow with <a class="inline-link" href="https://github.com/AI-Scarlett/build-dsh-plugin/" target="_blank" rel="noreferrer">the source repository</a>. The Skill then structures the work around host fit, risk, source, tests, and evidence.</p></div><div class="seo-feature-grid"><article><b>01 / Define</b><h3>State the observed problem</h3><p>Describe the user outcome and at least one measurable acceptance criterion.</p></article><article><b>02 / Build</b><h3>Use the standard plugin shape</h3><p>Keep Host, Browser Client, cards, data contracts, and external dependencies explicit.</p></article><article><b>03 / Verify</b><h3>Keep evidence layers separate</h3><p>Source checks, Catalog admission, Profile mutation, and public release are distinct gates.</p></article></div></section>
  <section class="seo-boundary section-shell"><span>RUNTIME BOUNDARY</span><p>The Skill can prepare source and audits. It cannot turn a unit test into a real DSH runtime acceptance result, and it must not mutate a real Profile without a new, exact user confirmation.</p></section>`
  const schema = { '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${canonical}#webpage`, url: canonical, name: 'Build DSH Plugins | DSH STORE', description: 'Developer information for the build-dsh-plugin Agent Skill.', isPartOf: { '@id': `${SITE_ORIGIN}/#website` }, inLanguage: 'en' }
  return pageDocument({ title: 'Build DSH Plugins | DSH STORE', description: 'Use the open-source build-dsh-plugin Agent Skill to structure, audit, test, and prepare a standard DeepSeek Harness plugin.', canonical, zhUrl: publicUrl('/build/'), assetPrefix: '../../', active: 'build', body, schema })
}

export function renderEnglishFaq() {
  const canonical = publicUrl('/en/faq/')
  const questions = [
    ['What is DSH STORE?', 'DSH STORE is an independent third-party discovery, development, and trusted-access gateway for DeepSeek Harness plugins.'],
    ['Is DSH STORE an official DeepSeek or DSH marketplace?', 'No. It does not replace, hide, or claim to be the official DSH plugin inventory.'],
    ['Where do the plugin facts come from?', 'The storefront derives public records from the repository Catalog at registry/catalog.json. The record points to a repository and a fixed commit, while unavailable facts remain explicitly unknown or undeclared.'],
    ['Does browsing a plugin page install anything?', 'No. The public website is read-only. A real DSH Profile change must use the official DSH CLI workflow with a fresh plan, exact confirmation, backup, health check, and rollback.'],
    ['Does a listing prove that a plugin is safe?', 'No. A listing, automated scan, author verification, or review label is not a complete security audit. Review the declared permissions, source, and your own requirements before taking an installation step.'],
    ['How can I submit a plugin?', 'Submit a public GitHub repository through the DSH STORE plugin-submission issue form. The catalog admission process checks its declared distribution and source boundaries.'],
  ]
  const body = `<section class="seo-hero section-shell"><div><span class="eyebrow"><span class="live-dot"></span>FAQ / TRUST BOUNDARIES</span><h1>Clear answers before <em>you take a next step.</em></h1><p class="seo-lead">These answers describe what the public DSH STORE website and its Catalog can confirm—and equally importantly, what they cannot.</p></div><aside class="seo-signal-card"><span>QUESTION SET</span><strong>${questions.length}</strong><p>For usage and source-level documentation, use the linked GitHub README as the primary reference.</p></aside></section>
  <section class="seo-section section-shell"><div class="seo-faq-list">${questions.map(([question, answer]) => `<article><h2>${htmlEscape(question)}</h2><p>${htmlEscape(answer)}</p></article>`).join('')}</div><div class="hero-actions"><a class="button button-primary" href="https://github.com/AI-Scarlett/dsh-safe-plugin-manager/blob/main/README.md" target="_blank" rel="noreferrer">Read the usage guide <i aria-hidden="true">↗</i></a><a class="button button-secondary" href="https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml" target="_blank" rel="noreferrer">Submit a plugin <i aria-hidden="true">↗</i></a></div></section>`
  const schema = { '@context': 'https://schema.org', '@type': 'FAQPage', '@id': `${canonical}#faq`, url: canonical, name: 'DSH STORE FAQ', inLanguage: 'en', mainEntity: questions.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })) }
  return pageDocument({ title: 'FAQ | DSH STORE', description: 'Answers about DSH STORE, its relationship to DeepSeek Harness, Catalog evidence, installation boundaries, and plugin submissions.', canonical, zhUrl: publicUrl('/faq/'), assetPrefix: '../../', active: 'faq', body, schema })
}

export function renderEnglishAbout() {
  const canonical = publicUrl('/en/about/')
  const body = `<section class="seo-hero section-shell"><div><span class="eyebrow"><span class="live-dot"></span>ABOUT / DSH.STORE</span><h1>A brighter, safer way to <em>navigate an AI-agent ecosystem.</em></h1><p class="seo-lead">DSH STORE is the product and DSH.STORE is the brand behind a third-party plugin marketplace and developer gateway for DeepSeek Harness. Its design focuses on technology, safety, trust, and a clear next step.</p><div class="hero-actions"><a class="button button-primary" href="mailto:jadename.zhou@gmail.com">Email the team <i aria-hidden="true">→</i></a><a class="button button-secondary" href="https://x.com/JadeNameCulture" target="_blank" rel="noreferrer">Follow on X <i aria-hidden="true">↗</i></a></div></div><aside class="seo-signal-card"><span>BRAND PRINCIPLES</span><strong>4</strong><p>Technology · Safety · Trust · Convenience</p></aside></section>
  <section class="seo-section section-shell"><div class="seo-section-heading"><span>WHAT WE BUILD</span><h2>A product layer around information that matters.</h2><p>Rather than presenting a bare plugin list, DSH STORE makes source pins, declared permissions, compatibility, and marketplace boundaries readable to DSH users and plugin developers.</p></div><div class="seo-feature-grid"><article><b>TECHNOLOGY</b><h3>Scalable by design</h3><p>The public catalog can grow without turning the home page into an unsearchable wall of cards.</p></article><article><b>SAFETY</b><h3>Boundaries are visible</h3><p>The site does not blur a public listing, a source review, a Catalog admission, and a real runtime action into one claim.</p></article><article><b>TRUST</b><h3>Facts retain their origin</h3><p>Catalog records retain repository, version, commit, license, declared permissions, and status context.</p></article></div></section>
  <section class="seo-contact section-shell"><div><span>CONTACT</span><h2>Talk to DSH STORE.</h2><a href="mailto:jadename.zhou@gmail.com">jadename.zhou@gmail.com</a><a href="https://x.com/JadeNameCulture" target="_blank" rel="noreferrer">x.com/JadeNameCulture ↗</a></div><figure><img src="../../wechat-public-account.png" alt="DSH STORE WeChat public-account QR code"><figcaption>Scan the official WeChat public-account QR code.</figcaption></figure></section>`
  const schema = { '@context': 'https://schema.org', '@type': 'AboutPage', '@id': `${canonical}#about`, url: canonical, name: 'About DSH STORE', description: 'About the DSH.STORE brand and the DSH STORE third-party DeepSeek Harness plugin marketplace.', isPartOf: { '@id': `${SITE_ORIGIN}/#website` }, inLanguage: 'en', about: { '@id': `${SITE_ORIGIN}/#organization` } }
  return pageDocument({ title: 'About DSH STORE | DSH.STORE', description: 'Learn about DSH STORE, the DSH.STORE brand, the third-party DeepSeek Harness plugin marketplace, and contact channels.', canonical, zhUrl: publicUrl('/about/'), assetPrefix: '../../', active: 'about', body, schema })
}

export function renderPluginDetailPage(entry, { categories, updatedAt }) {
  const id = safeEntryId(entry.id)
  const canonical = publicUrl(`/plugins/${id}/`)
  const details = entry.details || {}
  const permissions = details.permissions || {}
  const compatibility = entry.compatibility || {}
  const repositoryUrl = safeRepositoryUrl(entry.repositoryUrl)
  const sourceCommitUrl = repositoryUrl && /^[0-9a-f]{40}$/i.test(entry.commit || '') ? `${repositoryUrl}/tree/${entry.commit}` : null
  const categoryValues = Array.isArray(entry.categories) && entry.categories.length ? entry.categories.map(item => categoryName(item, categories)).join(' · ') : '未声明'
  const statusText = entry.status === 'approved'
    ? '该条目在公开 Catalog 中标记为已上架。真实 DSH Profile 的变更仍需在应用内通过独立计划和精确确认完成。'
    : '该条目在公开 Catalog 中保留展示信息；请以其状态和 GitHub 源为准，网站本身不会执行安装。'
  const fields = [
    ['Catalog 状态', entry.status === 'approved' ? '已上架（approved）' : entry.status === 'blocked' ? '仅展示（blocked）' : entry.status],
    ['包名', entry.packageName],
    ['版本', entry.version],
    ['固定提交', entry.commit || '未声明'],
    ['许可证', details.license || '未声明'],
    ['插件类型', details.pluginType || '未声明'],
    ['安装来源', details.installSource || '未声明'],
    ['审核状态', details.reviewStatus || '未声明'],
    ['DSH 兼容性', compatibility.dsh || '未声明'],
    ['Node.js', compatibility.node || '未声明'],
    ['支持系统', asList(compatibility.systems, '未声明')],
    ['适用 Profile', asList(compatibility.profiles, '未声明')],
  ]
  const permissionFields = [
    ['权限等级', permissions.level ? `${permissionEnglish[permissions.level] || permissions.level}（${permissions.level}）` : '未声明'],
    ['文件访问', permissions.files || '未声明'],
    ['网络访问', permissions.network || '未声明'],
    ['命令执行', permissions.commands || '未声明'],
    ['凭据访问', asList(permissions.credentials, '未声明')],
    ['外部依赖', asList(details.externalDependencies, '未声明')],
  ]
  const body = `<section class="plugin-detail-hero section-shell"><div><p class="plugin-detail-kicker">DSH STORE / PLUGIN RECORD</p><nav class="breadcrumb" aria-label="Breadcrumb"><a href="../../">首页</a><span>/</span><a href="../">插件目录</a><span>/</span><b>${htmlEscape(entry.name)}</b></nav><h1>${htmlEscape(entry.name)}</h1><p class="seo-lead">${htmlEscape(entry.description)}</p><div class="plugin-detail-actions"><a class="button button-primary" href="../">返回完整目录 <i aria-hidden="true">←</i></a>${repositoryUrl ? `<a class="button button-secondary" href="${htmlEscape(repositoryUrl)}" target="_blank" rel="noreferrer">打开 GitHub 仓库 <i aria-hidden="true">↗</i></a>` : ''}</div></div><aside class="plugin-detail-status"><span>CATALOG STATUS</span><strong>${htmlEscape(entry.status === 'approved' ? 'APPROVED' : String(entry.status || 'UNKNOWN').toUpperCase())}</strong><p>${htmlEscape(statusText)}</p></aside></section>
  <section class="seo-section section-shell"><div class="seo-section-heading"><span>IDENTITY / FIXED SOURCE</span><h2>可追溯的发布记录</h2><p>以下信息由公开 GitHub Catalog 的该条目提供；无法确认的字段保持为“未声明”，不会由网站猜测补全。</p></div><dl class="seo-fact-grid">${fields.map(([label, value]) => `<div><dt>${htmlEscape(label)}</dt><dd>${label === '固定提交' && sourceCommitUrl ? `<a class="inline-link" href="${htmlEscape(sourceCommitUrl)}" target="_blank" rel="noreferrer"><code>${htmlEscape(value)}</code> ↗</a>` : htmlEscape(value)}</dd></div>`).join('')}</dl></section>
  <section class="seo-section section-shell"><div class="seo-section-heading"><span>DECLARED ACCESS / COMPATIBILITY</span><h2>权限与依赖声明</h2><p>权限画像用于支持判断，不等同于完整安全审计；请在任何安装决策前结合仓库源码、更新内容和你的运行环境再次核对。</p></div><dl class="seo-fact-grid">${permissionFields.map(([label, value]) => `<div><dt>${htmlEscape(label)}</dt><dd>${htmlEscape(value)}</dd></div>`).join('')}</dl></section>
  <section class="seo-boundary section-shell"><span>PUBLIC RECORD BOUNDARY</span><p>分类：${htmlEscape(categoryValues)}。本页仅提供公开目录的静态记录；浏览不会安装、更新或修改 DSH Profile。上架状态、自动检查、作者认证或人工复核均不代表完整安全审计。</p></section>`
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'SoftwareApplication', '@id': `${canonical}#plugin`, name: entry.name, description: entry.description, url: canonical, applicationCategory: 'DeveloperApplication', operatingSystem: asList(compatibility.systems, 'Unknown'), softwareVersion: entry.version, license: details.license || undefined, codeRepository: repositoryUrl || undefined, isPartOf: { '@id': `${SITE_ORIGIN}/#website` }, inLanguage: 'zh-CN' },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'DSH STORE', item: `${SITE_ORIGIN}/` }, { '@type': 'ListItem', position: 2, name: '插件目录', item: `${SITE_ORIGIN}/plugins/` }, { '@type': 'ListItem', position: 3, name: entry.name, item: canonical }] },
    ],
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${htmlEscape(`${entry.name}：查看 DSH 插件的固定 GitHub 来源、版本、许可证、权限与兼容性声明。`)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <meta name="theme-color" content="#07113f">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="DSH STORE">
  <meta property="og:title" content="${htmlEscape(`${entry.name}｜DSH 插件详情｜DSH STORE`)}">
  <meta property="og:description" content="${htmlEscape(entry.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${socialImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${htmlEscape(`${entry.name}｜DSH STORE`)}">
  <meta name="twitter:description" content="${htmlEscape(entry.description)}">
  <meta name="twitter:image" content="${socialImage}">
  <title>${htmlEscape(`${entry.name}｜DSH 插件详情｜DSH STORE`)}</title>
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="text/plain" href="${SITE_ORIGIN}/llms.txt" title="DSH STORE for AI agents">
  <link rel="icon" type="image/png" sizes="1254x1254" href="../../dsh-store-icon.png">
  <link rel="apple-touch-icon" href="../../dsh-store-icon.png">
  <link rel="stylesheet" href="../../styles.css">
  <script type="application/ld+json">${jsonForScript(schema)}</script>
</head>
<body class="seo-page plugin-detail-page">
  <a class="skip-link" href="#content">跳到插件信息</a>
  <div class="tech-grid" aria-hidden="true"></div>
  <header class="site-header" id="top"><a class="brand" href="../../" aria-label="DSH STORE"><span class="brand-wordmark-frame" aria-hidden="true"><img class="brand-wordmark" src="../../dsh-store-wordmark.png" alt="" width="1448" height="1086"></span></a><nav class="site-nav" aria-label="Primary navigation"><a href="../../">首页</a><a href="../" aria-current="page">插件目录</a><a href="../../build/">开发插件</a><a href="../../faq/">常见问题</a><a href="../../about/">关于我们</a><a href="https://github.com/AI-Scarlett/dsh-safe-plugin-manager/blob/main/README.md" target="_blank" rel="noreferrer">使用说明 <i class="nav-external" aria-hidden="true">↗</i></a><a href="https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml" target="_blank" rel="noreferrer">提交插件 <i class="nav-external" aria-hidden="true">↗</i></a></nav><div class="header-tools"><div class="locale-switch" role="group" aria-label="Language"><a href="#top" aria-current="true">中文</a><a href="${SITE_ORIGIN}/en/plugins/">EN</a></div></div></header>
  <main id="content">${body}</main>
  <footer class="site-footer"><div class="footer-main"><a class="brand brand-footer" href="../../" aria-label="DSH STORE"><span class="brand-wordmark-frame" aria-hidden="true"><img class="brand-wordmark" src="../../dsh-store-wordmark.png" alt="" width="1448" height="1086"></span></a><p>发现插件、看清权限，再决定是否接入。</p><a class="footer-top" href="#top">回到顶部 ↑</a></div><div class="footer-bottom"><span>AUTHORITY · GitHub <code>registry/catalog.json</code></span><span>浏览不会改写 Profile</span></div></footer>
</body>
</html>`
}

function sitemapUrl({ loc, lastmod, changefreq, priority, alternates = [] }) {
  return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n${alternates.map(item => `    <xhtml:link rel="alternate" hreflang="${xmlEscape(item.lang)}" href="${xmlEscape(item.href)}" />\n`).join('')}    <lastmod>${xmlEscape(lastmod)}</lastmod>\n    <changefreq>${xmlEscape(changefreq)}</changefreq>\n    <priority>${xmlEscape(priority)}</priority>\n  </url>`
}

export function renderSitemap({ entries, updatedAt }) {
  const lastmod = dateOnly(updatedAt)
  const paired = [
    ['/', '/en/', 'weekly', '1.0'],
    ['/plugins/', '/en/plugins/', 'daily', '0.9'],
    ['/build/', '/en/build/', 'weekly', '0.8'],
    ['/faq/', '/en/faq/', 'monthly', '0.8'],
    ['/about/', '/en/about/', 'monthly', '0.7'],
  ]
  const urls = paired.flatMap(([zh, en, changefreq, priority]) => [
    sitemapUrl({ loc: publicUrl(zh), lastmod, changefreq, priority, alternates: [{ lang: 'zh-CN', href: publicUrl(zh) }, { lang: 'en', href: publicUrl(en) }, { lang: 'x-default', href: publicUrl(zh) }] }),
    sitemapUrl({ loc: publicUrl(en), lastmod, changefreq, priority: priority === '1.0' ? '0.9' : priority, alternates: [{ lang: 'zh-CN', href: publicUrl(zh) }, { lang: 'en', href: publicUrl(en) }, { lang: 'x-default', href: publicUrl(zh) }] }),
  ])
  for (const entry of entries.filter(item => item.status !== 'unlisted')) {
    urls.push(sitemapUrl({ loc: publicUrl(`/plugins/${safeEntryId(entry.id)}/`), lastmod, changefreq: 'weekly', priority: entry.featured ? '0.8' : '0.7' }))
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
}
