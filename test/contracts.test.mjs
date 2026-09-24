import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const project = new URL('../', import.meta.url)

test('package exposes a standard DSH bundle and client', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', project), 'utf8'))
  assert.equal(pkg.name, 'dsh-safe-plugin-manager')
  assert.equal(pkg.version, '0.9.1')
  for (const release of ['0.1.7-alpha.1', '0.1.7-alpha.2', '0.1.7-rc.1']) {
    assert.equal(pkg.dsh.compatibility.dshReleases[release], 'compatible')
    assert.deepEqual(pkg.dsh.compatibility.dshOperations[release], {
      install: 'passed', start: 'passed', uninstall: 'passed', rollback: 'passed',
    })
  }
  assert.equal(pkg.main, './src/index.mjs')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.repository.url, 'git+https://github.com/AI-Scarlett/DSH-Store.git')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
  assert.equal(pkg.dsh.compatibility.dshReleases['0.1.2-alpha.2'], 'compatible')
  assert.equal(pkg.dsh.compatibility.dshReleases['0.1.2-alpha.3'], 'compatible')
  assert.equal(pkg.dsh.compatibility.dshReleases['0.1.2-alpha.4'], 'compatible')
  assert.equal(pkg.dsh.compatibility.dshReleases['0.1.2-alpha.5'], 'compatible')
  assert.equal(pkg.dsh.compatibility.dshReleases['0.1.3-alpha.2'], 'unknown')
  assert.equal(pkg.dsh.compatibility.dshReleases['0.1.5-alpha.1'], 'compatible')
  assert.equal(pkg.dsh.compatibility.dshReleases['0.1.5-alpha.2'], 'compatible')
  assert.equal(pkg.dsh.compatibility.dshReleases['0.1.5-rc.1'], 'compatible')
  assert.equal(pkg.engines.node, '^22.19.0 || >=24.0.0')
  assert.match(pkg.scripts.check, /src\/guardian-upgrader\.mjs/)
  const legacyClientRange = '0.0.1-rc.5 || >=0.1.0-rc.6 <0.2.0 || 0.1.5-alpha.1 || 0.1.5-alpha.2'
  const rcClientRange = `${legacyClientRange} || 0.1.5-rc.1`
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-client-runtime'], legacyClientRange)
  for (const dependency of [
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-slots',
  ]) assert.equal(pkg.peerDependencies[dependency], rcClientRange)
  assert.equal(pkg.private, true)
})

test('canonical DSH-Store repository and Pages URLs replace legacy aliases', async () => {
  const paths = [
    'README.md', 'cordis.patch.yml', 'deploy/refresh-from-pages.sh', 'docs/VERIFICATION.md',
    'docs/ops/google-seo-20260824.json', 'install-counter/wrangler.jsonc', 'marketplace/about/index.html',
    'marketplace/build/index.html', 'marketplace/community/index.html', 'marketplace/dsh-plugins/index.html', 'marketplace/faq/index.html',
    'marketplace/index.html', 'marketplace/llms.txt', 'marketplace/plugins/index.html',
    'marketplace/standards/index.html', 'package.json',
    'registry/README.md', 'registry/automation-policy.json', 'registry/candidates.json',
    'registry/candidates.schema.json', 'registry/catalog.json', 'registry/catalog.schema.json',
    'registry/catalog-index.json', 'registry/catalog-index.schema.json', 'registry/catalog-detail.schema.json',
    'scripts/automate-catalog.mjs', 'scripts/build-marketplace-static.mjs', 'scripts/check-plugin-submission.mjs',
    'scripts/plan-author-notices.mjs', 'scripts/verify-marketplace-public.mjs', 'src/candidates.mjs', 'src/catalog.mjs',
  ]
  const contents = (await Promise.all(paths.map(path => readFile(new URL(path, project), 'utf8')))).join('\n')
  assert.doesNotMatch(contents, /AI-Scarlett\/dsh-safe-plugin-manager/i)
  assert.doesNotMatch(contents, /ai-scarlett\.github\.io\/dsh-safe-plugin-manager/i)
  assert.match(contents, /https:\/\/github\.com\/AI-Scarlett\/DSH-Store/)
  assert.match(contents, /https:\/\/raw\.githubusercontent\.com\/AI-Scarlett\/DSH-Store\/main\/registry\/catalog\.json/)
  assert.match(contents, /https:\/\/ai-scarlett\.github\.io\/DSH-Store/)
})

test('static storefront templates expose the cross-site navigation and analytics identity contract', async () => {
  const pagePaths = [
    'marketplace/index.html',
    'marketplace/plugins/index.html',
    'marketplace/community/index.html',
    'marketplace/standards/index.html',
    'marketplace/build/index.html',
    'marketplace/faq/index.html',
    'marketplace/about/index.html',
    'marketplace/about/deepseek-harness-guide/index.html',
  ]
  const pages = await Promise.all(pagePaths.map(path => readFile(new URL(path, project), 'utf8')))
  for (const page of pages) assert.match(page, /DSH_ALTERNATE_SITE/)
  for (const path of ['marketplace/app.js', 'marketplace/build/build.js', 'marketplace/faq/faq.js', 'marketplace/about/about.js', 'marketplace/standards/standards.js']) {
    const source = await readFile(new URL(path, project), 'utf8')
    assert.match(source, /url\.searchParams\.set\('site', analyticsToken\(location\.host\)\)/)
  }
})

test('community has a standalone route and the inner pages share the redesign stylesheet', async () => {
  const [home, community, builder, staticBuilder, redesignStyles] = await Promise.all([
    readFile(new URL('marketplace/index.html', project), 'utf8'),
    readFile(new URL('marketplace/community/index.html', project), 'utf8'),
    readFile(new URL('marketplace/build/index.html', project), 'utf8'),
    readFile(new URL('scripts/build-marketplace-static.mjs', project), 'utf8'),
    readFile(new URL('marketplace/pages-redesign.css', project), 'utf8'),
  ])
  assert.doesNotMatch(home, /id="community"/)
  assert.match(home, /href="\.\/community\/" data-i18n="nav\.community"/)
  assert.match(home, /href="\.\/community\/" data-i18n="footer\.community"/)
  assert.match(community, /<body class="community-page">/)
  assert.match(community, /href="\.\/" aria-current="page" data-i18n="nav\.community"/)
  assert.match(community, /class="community-flow-list"/)
  assert.match(community, /pages-redesign\.css\?v=20260924-inner-store-2/)
  assert.match(builder, /href="\.\.\/community\/" data-i18n="nav\.community"/)
  assert.match(builder, /pages-redesign\.css\?v=20260924-inner-store-2/)
  assert.match(staticBuilder, /route: '\/community\/'/)
  assert.match(staticBuilder, /'\/community\/': '0\.8'/)
  assert.match(redesignStyles, /body\.community-page \.community-grid/)
  assert.match(redesignStyles, /body\.community-page \.community-flow-list/)
})

test('public storefront verifies the legacy bridge before loading the split Catalog index', async () => {
  const source = await readFile(new URL('marketplace/app.js', project), 'utf8')
  assert.match(source, /payload\.registry\.indexPath/)
  assert.match(source, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(source, /Catalog bridge index SHA-256 does not match/)
  assert.match(source, /state\.detailPromises/)
  assert.match(source, /Math\.min\(6, entries\.length\)/)
})

test('homepage uses a Raycast-inspired catalog-first storefront with a transparent DSH brand lockup', async () => {
  const pagePaths = [
    'marketplace/index.html',
    'marketplace/plugins/index.html',
    'marketplace/community/index.html',
    'marketplace/standards/index.html',
    'marketplace/build/index.html',
    'marketplace/faq/index.html',
    'marketplace/about/index.html',
    'marketplace/about/deepseek-harness-guide/index.html',
    'marketplace/dsh-plugins/index.html',
  ]
  const [styles, homepageDesign, ...pages] = await Promise.all([
    readFile(new URL('marketplace/styles.css', project), 'utf8'),
    readFile(new URL('marketplace/home-redesign.css', project), 'utf8'),
    ...pagePaths.map(path => readFile(new URL(path, project), 'utf8')),
  ])
  assert.match(pages[0], /<meta name="theme-color" content="#f7f9fd">/)
  for (const page of pages.slice(1)) assert.match(page, /<meta name="theme-color" content="#f6f9ff">/)
  assert.match(styles, /--glass: rgba\(255, 255, 255, \.72\)/)
  assert.match(styles, /--radius-xl: 32px/)
  assert.match(styles, /\.automation-grid article:first-child \{\s*grid-column: span 2;/)
  assert.match(styles, /\.featured-grid > :first-child \{ grid-row: span 2; \}/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(pages[0], /home-redesign\.css\?v=20260924-raycast-store-9/)
  assert.match(pages[0], /class="home-redesign"/)
  assert.match(pages[0], /class="install-floor"/)
  assert.match(pages[0], /class="discovery-spread"/)
  assert.match(pages[0], /data-i18n="install\.floorTitle"/)
  assert.match(pages[0], /class="trust-chapter"/)
  assert.doesNotMatch(pages[0], /id="community"/)
  assert.match(pages[0], /href="\.\/community\/" data-i18n="nav\.community"/)
  assert.match(homepageDesign, /body\.home-page \.trust-chapter \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important/)
  assert.match(pages[0], /class="maker-chapter"/)
  assert.match(pages[0], /class="brand-wordmark-frame"[^>]*>[\s\S]*?src="\.\/dsh-store-wordmark\.png"[^>]*width="1448" height="1086"/)
  assert.doesNotMatch(pages[0], /brand-wordmark-text|brand-lockup/)
  assert.match(pages[0], /id="home-plugin-grid"/)
  assert.match(pages[0], /data-i18n="home\.catalogLead"/)
  assert.match(pages[0], /<nav class="footer-nav" aria-label="网站快捷导航">/)
  for (const route of ['./plugins/', './build/', './standards/', './faq/', './about/']) {
    assert.ok(pages[0].includes(`href="${route}"`), `footer should link to ${route}`)
  }
  assert.match(pages[0], /data-i18n="footer\.friendsTitle">友情链接/)
  assert.match(pages[0], /href="\.\/community\/" data-i18n="footer\.community">社区与开发者/)
  assert.match(pages[0], /<!-- DSH_FRIEND_SISTER_SITE -->/)
  assert.match(pages[0], /https:\/\/aiaiai\.help\//)
  assert.match(pages[0], /https:\/\/tracefence\.com\//)
  assert.ok(pages[0].indexOf('class="faq-more"') < pages[0].indexOf('class="faq-list"'), 'FAQ link should sit in the heading row above the questions')
  assert.match(homepageDesign, /--dsh-cyan: #17bfe3/)
  assert.match(homepageDesign, /--dsh-blue: #2874f5/)
  assert.match(homepageDesign, /--dsh-violet: #7043e7/)
  assert.match(homepageDesign, /grid-template-areas: "heading" "categories"/)
  assert.match(homepageDesign, /\.brand-wordmark-frame,[\s\S]*?background: transparent !important/)
  assert.match(homepageDesign, /\.site-header\s*\{[\s\S]*?background: linear-gradient\(108deg, #0c1436/)
  assert.match(homepageDesign, /\.site-footer\s*\{[\s\S]*?background: linear-gradient\(120deg, #0c1436/)
  assert.match(homepageDesign, /\.workflow-step > div \{ display: grid !important; grid-template-columns: minmax\(0,1fr\)/)
  assert.match(homepageDesign, /\.workflow-step:last-child \{ grid-column: auto !important; \}/)
  assert.match(homepageDesign, /\.manager-console \{[^}]*min-height: 0 !important/)
  assert.match(homepageDesign, /\.build-bridge \{[^}]*min-height: 0 !important/)
  assert.match(homepageDesign, /\.faq-list \{ margin: 16px 0 0 !important/)
  assert.match(homepageDesign, /body\.home-page \.faq-section \{ padding: 42px 0 22px !important; \}/)
  assert.match(homepageDesign, /body\.home-page \.faq-section \.section-heading \{ grid-template-columns: minmax\(0,1fr\) auto !important; align-items: center !important/)
  assert.match(homepageDesign, /body\.home-page \.faq-section \.section-heading \.faq-more \{ justify-self: end !important/)
  assert.match(homepageDesign, /body\.home-page \.faq-more \{ margin: 14px 0 0 !important/)
  assert.match(homepageDesign, /body\.home-page \.site-footer \{ width: 100% !important; margin: 0 !important/)
  assert.match(homepageDesign, /body\.home-page \.footer-nav \{ grid-column: 3 !important;/)
  assert.match(homepageDesign, /body\.home-page \.faq-section \.section-heading \{ grid-template-columns: minmax\(0,1fr\) !important; align-items: start !important/)
  assert.match(homepageDesign, /\.automation-section \{[\s\S]*?background: linear-gradient\(122deg,#0b1635 0%,#13254c 57%,#211b52 100%\) !important/)
  assert.match(homepageDesign, /body\.home-page \.automation-grid article:last-child \{ min-height: 95px !important; padding: 10px 8px !important; border: 1px solid rgba\(205,221,255,\.15\) !important; background: rgba\(255,255,255,\.065\) !important/)
  assert.match(homepageDesign, /\.build-bridge \{[\s\S]*?background: linear-gradient\(112deg,#0b1635 0%,#14285a 64%,#27205b 100%\) !important/)
  assert.match(homepageDesign, /body\.home-page \.automation-grid article,[\s\S]*?grid-column: auto !important;[\s\S]*?grid-row: auto !important/)
  assert.match(homepageDesign, /body\.home-page \.automation-section \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0,1fr\)\) !important/)
  assert.match(homepageDesign, /body\.home-page \.automation-additions ul \{ display: grid !important; grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(homepageDesign, /body\.home-page \.automation-additions:not\(\.automation-updates\) ul \{ grid-template-columns: minmax\(0,1fr\) !important/)
  assert.doesNotMatch(homepageDesign, /max-height: 248px !important; overflow: auto !important/)
  assert.match(homepageDesign, /body\.home-page \.metric-deck \.metric-source \{[^}]*grid-column: auto !important; grid-row: auto !important/)
  assert.match(homepageDesign, /background: #0a0f1e !important/)
  assert.match(homepageDesign, /body\.home-page \.architecture-map \{ grid-template-columns: minmax\(0,1fr\) 22px minmax\(0,1\.12fr\) 22px minmax\(0,1fr\) !important/)
  assert.match(homepageDesign, /body\.home-page \.manager-console \{ grid-template-columns: minmax\(0,1fr\) !important/)
  assert.match(homepageDesign, /body\.home-page \.architecture-map \{ grid-template-columns: minmax\(0,1fr\) 14px minmax\(0,1\.12fr\) 14px minmax\(0,1fr\) !important/)
  assert.match(homepageDesign, /body\.home-page \.motion-reveal:not\(\.visible\) \{ opacity: 1 !important/)
  assert.match(homepageDesign, /\.discovery-spread\s*\{\s*display: block/)
  assert.match(homepageDesign, /\.featured-grid\s*\{\s*display: grid[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(homepageDesign, /\.home-plugin-grid\s*\{\s*display: grid[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(homepageDesign, /@media \(max-width: 760px\)/)
  assert.match(homepageDesign, /@media \(prefers-reduced-motion: reduce\)/)
  assert.doesNotMatch(homepageDesign, /--zine-acid|--zine-hot/)
  const homeOrder = ['class="hero"', 'class="discovery-spread"', 'class="store-search section-shell"', 'class="featured-section', 'class="home-directory-section"', 'class="metric-deck', 'class="install-floor"', 'class="workflow-section', 'id="automation-status"', 'class="trust-chapter"', 'class="maker-chapter"', 'class="faq-section']
  const homeOffsets = homeOrder.map(marker => pages[0].indexOf(marker))
  assert.ok(homeOffsets.every((offset, index) => offset >= 0 && (index === 0 || offset > homeOffsets[index - 1])), 'homepage chapters should follow the redesigned discovery journey')
  assert.ok(pages[0].indexOf('class="store-search-form"') < homeOffsets[1], 'hero search should be visible before category browsing')
  const storefrontApp = await readFile(new URL('marketplace/app.js', project), 'utf8')
  assert.match(storefrontApp, /function renderHomeDirectoryPreview\(\)/)
  assert.match(storefrontApp, /const entries = visibleIndexEntries\(\)\.slice\(0, 6\)/)
  assert.match(storefrontApp, /void fetchCatalogDetail\(indexEntry\)/)
  assert.match(storefrontApp, /if \(els\.grid\) void loadCurrentPageDetails\(\)/)
})

test('featured DeepSeek Harness article preserves source attribution and long-form structure', async () => {
  const [article, about] = await Promise.all([
    readFile(new URL('marketplace/about/deepseek-harness-guide/index.html', project), 'utf8'),
    readFile(new URL('marketplace/about/index.html', project), 'utf8'),
  ])
  assert.match(article, /<meta name="author" content="@Russell3402">/)
  assert.match(article, /"isBasedOn": "https:\/\/mp\.weixin\.qq\.com\/s\/oKppevLlwQOg8TfPG74rVw"/)
  assert.match(article, /作者：<a href="https:\/\/x\.com\/Russell3402"/)
  assert.match(article, /href="https:\/\/mp\.weixin\.qq\.com\/s\/oKppevLlwQOg8TfPG74rVw"[^>]*>原始发布/)
  assert.match(article, /DSH STORE 仅负责网页编排，不将本文标注为 DSH STORE 原创/)
  assert.equal((article.match(/<h2 id=/g) || []).length, 14)
  assert.equal((article.match(/class="article-figure"/g) || []).length, 24)
  assert.match(article, /一、先把 Harness 讲透：模型并不会直接使用电脑/)
  assert.match(article, /十二、它到底能做出什么：从临时造工具到外部自动化/)
  assert.match(article, /以后讨论 Agent 能力，除了问“用了哪个模型”/)
  assert.doesNotMatch(article, /ARTICLE_(?:TOC|BODY)/)
  assert.match(about, /DSH_ARTICLE_PROMO_BEGIN/)
  assert.match(about, /href="\.\/deepseek-harness-guide\/"/)
  assert.match(about, /作者：@Russell3402/)
})

test('public listing standards mirror the current bounded automation policy', async () => {
  const [standards, policy] = await Promise.all([
    readFile(new URL('marketplace/standards/index.html', project), 'utf8'),
    readFile(new URL('registry/automation-policy.json', project), 'utf8').then(JSON.parse),
  ])
  assert.match(standards, new RegExp(`>${policy.sourceBounds.maxTreeEntries.toLocaleString('en-US')}<`))
  assert.match(standards, new RegExp(`>${policy.sourceBounds.maxRuntimeFiles}<`))
  assert.match(standards, new RegExp(`>${policy.sourceBounds.maxFileBytes / 1024} KiB<`))
  assert.match(standards, new RegExp(`>${policy.sourceBounds.maxTotalRuntimeBytes / 1024 / 1024} MiB<`))
  assert.match(standards, /installActionsDisabled = true/)
  assert.match(standards, /不会运行第三方 install、prepare、build、test 或运行时代码/)
  assert.match(standards, /收录不是完整安全审计，也不是运行成功证明/)
})

test('marketplace cards derive the latest three DSH releases while details retain full history', async () => {
  const [storefront, styles, client] = await Promise.all([
    readFile(new URL('marketplace/app.js', project), 'utf8'),
    readFile(new URL('marketplace/styles.css', project), 'utf8'),
    readFile(new URL('src/client.js', project), 'utf8'),
  ])
  assert.match(storefront, /DSH_VERSION_URL = 'https:\/\/registry\.npmjs\.org\/@deepseek-ai%2Fdsh'/)
  assert.match(storefront, /function createDshReleaseContext/)
  assert.match(storefront, /import\('\.\/lib\/dsh-release-policy\.js'\)/)
  assert.match(storefront, /fetchOfficialDshReleaseWindow\(/)
  assert.match(storefront, /const cardReleaseViews = views =>/)
  assert.match(storefront, /\$\{compatibilityMatrix\(entry\)\}/)
  assert.match(storefront, /compatibility\.dshReleaseViews\.map\(view =>/)
  assert.match(storefront, /partial: '部分验证'/)
  assert.match(storefront, /record\?\.evidenceStatus \|\| record\?\.status/)
  assert.match(styles, /\.compatibility-matrix \{[^\n]*grid-template-columns: repeat\(3,/)
  assert.match(client, /function normalizeReleaseViews/)
  assert.match(client, /function CompatibilityMatrix\(\{ entry, all = false \}\)/)
  assert.match(client, /React\.createElement\(AssuranceMatrix, \{ entry \}\),\s*React\.createElement\(CompatibilityMatrix, \{ entry \}\),/)
  assert.match(client, /React\.createElement\(CompatibilityMatrix, \{ entry, all: true \}\)/)
  assert.match(client, /范围支持·待验证/)
})

test('guarded write path uses exact process arguments and permanent protection checks', async () => {
  const [runner, operations] = await Promise.all([
    readFile(new URL('src/dsh.mjs', project), 'utf8'),
    readFile(new URL('src/operations.mjs', project), 'utf8'),
  ])
  assert.match(runner, /execFile\(/)
  assert.doesNotMatch(runner, /shell:\s*true/)
  assert.match(runner, /dirname\(nodePath\)/)
  assert.match(runner, /nodeModulesAncestor/)
  assert.match(runner, /containsPnpm/)
  assert.match(runner, /commandPath/)
  assert.match(runner, /commandEnvironment/)
  assert.match(operations, /OFFICIAL_PROTECTED/)
  assert.match(operations, /CRITICAL_ENTRY_PROTECTED/)
  assert.match(operations, /capturePreconditions/)
  assert.match(operations, /backupProfile/)
  assert.match(operations, /restoreBackup/)
  assert.match(operations, /CONFIRMATION_MISMATCH/)
  assert.match(operations, /DSH_PNPM_NOT_FOUND/)
  assert.match(operations, /rollbackDetails/)
  assert.match(operations, /approvedCandidate/)
  assert.match(operations, /sourceCommit/)
})

test('bundle patch inserts only the manager and does not shadow official inventory', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', project), 'utf8')
  assert.match(patch, /id:\s*dsh-safe-plugin-manager/)
  assert.match(patch, /name:\s*dsh-safe-plugin-manager/)
  assert.doesNotMatch(patch, /ui-settings-plugin-inventory/)
  assert.doesNotMatch(patch, /disabled:\s*true/)
})

test('current Host implementation contains no mutation or shell primitives', async () => {
  const source = await Promise.all([
    'src/index.mjs', 'src/inventory.mjs', 'src/panel.mjs',
  ].map(path => readFile(new URL(path, project), 'utf8')))
  const joined = source.join('\n')
  for (const forbidden of [
    /\bwriteFile(?:Sync)?\b/, /\bappendFile(?:Sync)?\b/, /\brename(?:Sync)?\b/,
    /\bunlink(?:Sync)?\b/, /\brm(?:Sync)?\b/, /node:child_process/,
    /\bspawn(?:Sync)?\s*\(/,
    /ctx\.loader\s*\.\s*(?:create|update|remove|write)\s*\(/, /ctx\.reflect/,
  ]) {
    assert.doesNotMatch(joined, forbidden, `forbidden primitive found: ${forbidden}`)
  }
})

test('client registers through ModuleLoader and a separate settings tab', async () => {
  const client = await readFile(new URL('src/client.js', project), 'utf8')
  assert.match(client, /window\.__ModuleLoader__\.load/)
  assert.match(client, /const module = \{ exports: \{\} \}/)
  assert.match(client, /settings\.plugins\.tab/)
  assert.match(client, /id:\s*'safe-plugin-manager'/)
  assert.match(client, /order:\s*-10/, 'marketplace must sort before the official configurable and inventory tabs')
  assert.match(client, /GitHub-only/)
  assert.match(client, /DSH第三方插件商城/)
  assert.match(client, /LEGACY_DSH_VERSIONS = \{ 'rc\.7': '0\.1\.0-rc\.7'/)
  assert.match(client, /function CompatibilityMatrix/)
  assert.match(client, /partial: '部分验证'/)
  assert.match(client, /const SUPPORT_URL = 'https:\/\/dsh\.store\/'/)
  assert.match(client, /技术支持：DSH-Store/)
  assert.match(client, /同版本源码已更新 · GitHub 手动更新/)
  assert.match(client, /手动更新不受商城计划、备份、健康检查和失败回滚保护/)
  assert.match(client, /compactButton/)
  assert.match(client, /function TabButton/)
  assert.match(client, /function StatusPill/)
  assert.match(client, /stateDot/)
  assert.match(client, /role: 'listitem'/)
  assert.match(client, /role: 'list'/)
  assert.match(client, /'aria-labelledby': titleId/)
  assert.match(client, /--dsw-alias-button-primary-fill/)
  assert.match(client, /--dsw-alias-label-primary-foreground/)
  assert.match(client, /role: 'tab'/)
  assert.match(client, /'aria-selected': active/)
  assert.match(client, /label: \(\) => '插件商城'/)
  assert.match(client, /迁移到商城版/)
  assert.match(client, /function CatalogFilters/)
  assert.match(client, /只看推荐/)
  assert.match(client, /featuredOnly/)
  assert.match(client, /sameVersionSourceChange/)
  assert.match(client, /function Pagination/)
  assert.match(client, /pageSize: MARKET_PAGE_SIZE/)
  assert.match(client, /function InventoryOnlyCard/)
  assert.match(client, /require\('@deepseek-ai\/dsh-client-ui-primitives'\)/)
  assert.match(client, /PluginDetailsModal/)
  assert.match(client, /GitHub 发布者/)
  assert.match(client, /githubPublisher\(entry\.repositoryUrl\)/)
  const detailSource = client.slice(client.indexOf('function PluginDetailsModal'), client.indexOf('function HealthPanel'))
  assert.match(detailSource, /React\.createElement\(PluginActions/)
  assert.match(detailSource, /const beginDetailPlan[\s\S]*close\(\)[\s\S]*beginPlan\(action, selectedEntry\)/)
  assert.ok((client.match(/React\.createElement\(PluginActions/g) || []).length >= 2, 'shared cards and details must use lifecycle actions')
  assert.match(client, /normalizeMarketEntry/)
  assert.match(client, /catalogDetailsAvailable/)
  assert.match(client, /缺失值按“未知 \/ 未声明”显示，未使用本地推测数据替代/)
  assert.match(client, /详情来自 GitHub catalog\.json/)
  assert.match(client, /前往 GitHub 手动安装/)
  assert.match(client, /手动安装不受本商城的计划、备份、健康检查和失败回滚保护/)
  for (const label of ['插件类型', '安装来源', '许可证', '权限等级', '文件权限', '网络权限', '命令执行', '凭据访问', '外部依赖', '审核状态', '兼容性']) {
    assert.match(client, new RegExp(label))
  }
  const cardSource = client.slice(client.indexOf('function MarketCard'), client.indexOf('function DetailRow'))
  assert.ok(cardSource.indexOf('PluginActions') < cardSource.indexOf("'查看详情'"), 'card actions must precede the lower-right details button')
  assert.match(client, /cardFooter:.*marginTop: 'auto'/)
  const installedViewStart = client.indexOf("else if (view === 'installed')")
  const installedViewSource = client.slice(installedViewStart, client.indexOf('} else {', installedViewStart))
  assert.match(installedViewSource, /React\.createElement\(MarketCard/)
  assert.match(installedViewSource, /openDetails: setDetailEntry/)
  assert.match(installedViewSource, /React\.createElement\(InventoryOnlyCard/)
  assert.match(client, /pagination\?\.view === view/)
  assert.match(client, /catalogPackageNames/)
  assert.ok((client.match(/\bfilters,/g) || []).length >= 2, 'market and installed views must share catalog filters')
  assert.match(client, /plugin\.description \|\| '本地 manifest 未提供插件介绍'/)
  assert.match(client, /未进入 GitHub catalog\.json，无法提供目录详情或商城受保护操作/)
  const planSource = client.slice(client.indexOf('function PlanPanel'), client.indexOf('function ManagerPanel'))
  assert.match(planSource, /React\.createElement\(Modal/)
  assert.match(planSource, /正在生成操作计划/)
  assert.match(planSource, /操作预览与确认/)
  assert.match(planSource, /重新校验/)
  assert.match(client, /执行并启用自动回滚/)
  assert.match(client, /Profile 文件恢复/)
  assert.match(client, /一键安全重启 DSH Host/)
  assert.match(client, /restart-execute/)
  assert.match(client, /新的 DSH Host/)
  assert.match(client, /唯一启动所有者/)
  assert.match(client, /请勿再运行 pnpm dsh web 或 dsh web/)
  assert.match(client, /GUARDIAN_PORT_CONFLICT/)
  assert.doesNotMatch(client, /复制重启命令|请手动运行：/)
  assert.match(client, /操作失败，需要恢复/)
  assert.match(client, /操作失败，已回滚/)
  const headingSource = client.slice(client.indexOf('const heading ='), client.indexOf('const nav ='))
  const navSource = client.slice(client.indexOf('const nav ='), client.indexOf('let content'))
  assert.doesNotMatch(headingSource, /刷新 GitHub 目录/)
  assert.match(navSource, /role: 'tablist'/)
  assert.match(navSource, /'aria-label': '插件商城视图'/)
  assert.match(navSource, /React\.createElement\(TabButton/)
  assert.doesNotMatch(navSource, /React\.createElement\(Button, \{ key: id, active:/)
  assert.match(navSource, /compact: true/)
  assert.match(navSource, /刷新 GitHub 目录/)
  assert.doesNotMatch(client, /id:\s*'all'/)
  assert.match(client, /前往选择.*个插件的权限/)
  assert.match(client, /dsh-health-permissions/)
  assert.match(client, /完成剩余.*项权限选择后才能重新检查/)
  assert.match(client, /health-permission-decisions:v1/)
  assert.match(client, /插件版本、固定 Commit 或权限声明变化时会失效并要求重新确认/)
  assert.match(client, /正在检查…/)
  assert.match(client, /健康检查已完成/)
  assert.match(client, /检查源仓库更新/)
  assert.match(client, /不会直接安装浮动 main/)
  assert.match(client, /source-update/)
  assert.match(client, /dsh-version/)
  assert.match(client, /DSH 版本与升级/)
  assert.match(client, /检测升级/)
  assert.match(client, /复制升级命令/)
  assert.match(client, /预发布/)
  assert.match(client, /插件源更新规则/)
  assert.match(client, /Guardian 已验证，DSH 正在交接，页面会自动重新连接/)
  assert.match(client, /独立升级交接器已验证旧 Guardian、Profile 与 Boot ID/)
  assert.match(client, /国内站修复\/升级方案/)
  assert.match(client, /GitHub Pages 修复\/升级方案/)
  assert.match(client, /BOOT_RECOVERY_TIMEOUT/)
  assert.match(client, /dsh-safe-plugin-manager:boot-recovery:v1/)
  assert.match(client, /BroadcastChannel/)
  assert.match(client, /guardian\.state === 'healthy'/)
  assert.match(client, /guardian\.health\?\.bootId === runtime\.bootId/)
  assert.match(client, /BOOT_RECOVERY_STABLE_SAMPLES/)
  assert.match(client, /ctx\.on\('connection\/reset'/)
  assert.match(client, /window\.location\.replace/)
  assert.doesNotMatch(client, /window\.location\.reload/)
  assert.doesNotMatch(client, /执行 DSH 升级|一键升级 DSH/)
})

test('public rc.7 through 0.1.2-alpha.5 client contract stays on official ModuleLoader and settings ordering', async () => {
  const [pkg, client] = await Promise.all([
    readFile(new URL('package.json', project), 'utf8'),
    readFile(new URL('src/client.js', project), 'utf8'),
  ])
  const manifest = JSON.parse(pkg)
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-settings',
  ])
  assert.match(client, /window\.__ModuleLoader__\.load/)
  assert.match(client, /settings\.plugins\.tab/)
  assert.match(client, /order:\s*-10/)
  assert.match(client, /0\.1\.2-alpha\.5/)
  assert.doesNotMatch(client, /ctx\.loader|ctx\.reflect|Loader\.|Fiber\./)
})

test('guardian health and active upgrade require bound DSH ownership', async () => {
  const [daemon, service, upgrader] = await Promise.all([
    readFile(new URL('src/guardian-daemon.mjs', project), 'utf8'),
    readFile(new URL('src/guardian.mjs', project), 'utf8'),
    readFile(new URL('src/guardian-upgrader.mjs', project), 'utf8'),
  ])
  assert.match(daemon, /\/api2\/dsh-safe-plugin-manager\/runtime/)
  assert.match(daemon, /runtime-identity-mismatch/)
  assert.match(daemon, /root\.statusCode !== 200 && root\.statusCode !== 401/)
  assert.match(daemon, /external-dsh-detected/)
  assert.match(daemon, /port-conflict/)
  assert.match(daemon, /consecutiveProbeFailures/)
  assert.match(service, /healthProbeTimeoutMs:\s*1_500/)
  assert.match(service, /unhealthyThreshold:\s*3/)
  assert.match(service, /startupGraceMs:\s*10_000/)
  assert.match(service, /commandPath/)
  assert.match(service, /GUARDIAN_BOOTSTRAP_UNVERIFIED/)
  assert.match(service, /waitForFreshGuardianHeartbeat/)
  assert.match(service, /active-guardian-upgrade/)
  assert.match(upgrader, /GUARDIAN_ACTIVE_IDENTITY_CHANGED/)
  assert.match(upgrader, /GUARDIAN_UPGRADE_PRECONDITION_CHANGED/)
  assert.match(upgrader, /GUARDIAN_UPGRADE_HEARTBEAT_UNVERIFIED/)
  assert.match(upgrader, /atomicCopy/)
  assert.match(upgrader, /recovery/)
  assert.ok((daemon.match(/env: commandEnvironment/g) || []).length >= 2, 'Guardian launch and offline restore must share the captured command PATH')
  assert.doesNotMatch(daemon, /adopting-existing-host/)
})

test('client fails closed when the live health endpoint still uses the legacy schema', async () => {
  const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.match(client, /health\.schemaVersion !== 2/)
  assert.match(client, /这些结果不等于逐插件健康/)
  assert.match(client, /恢复 Guardian 后才能逐插件检查/)
  assert.match(client, /pnpm dsh web/)
})

test('GitHub Pages marketplace handles omitted featured flags deterministically', async () => {
  const [html, app, pluginsHtml, standardsHtml, buildHtml, faqHtml, aboutHtml, repairHtml, repairClient, repairCli, readme, previewServer, styles, packageManifest] = await Promise.all([
    readFile(new URL('marketplace/index.html', project), 'utf8'),
    readFile(new URL('marketplace/app.js', project), 'utf8'),
    readFile(new URL('marketplace/plugins/index.html', project), 'utf8'),
    readFile(new URL('marketplace/standards/index.html', project), 'utf8'),
    readFile(new URL('marketplace/build/index.html', project), 'utf8'),
    readFile(new URL('marketplace/faq/index.html', project), 'utf8'),
    readFile(new URL('marketplace/about/index.html', project), 'utf8'),
    readFile(new URL('marketplace/repair/index.html', project), 'utf8'),
    readFile(new URL('marketplace/repair/repair.js', project), 'utf8'),
    readFile(new URL('bin/dsh-store-repair.mjs', project), 'utf8'),
    readFile(new URL('README.md', project), 'utf8'),
    readFile(new URL('scripts/serve-marketplace.mjs', project), 'utf8'),
    readFile(new URL('marketplace/styles.css', project), 'utf8'),
    readFile(new URL('package.json', project), 'utf8'),
  ])
  const bootstrapCommit = '0bc733064bfc8ff16f6e8144188a7ac563092e12'
  const installCommand = `dsh plugin --profile web add 'git+https://github.com/AI-Scarlett/DSH-Store.git#${bootstrapCommit}'`
  const submissionUrl = 'https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml'
  assert.match(html, /defer src="\.\/app\.js"/)
  assert.match(html, /data-locale="zh"/)
  assert.match(html, /data-locale="en"/)
  assert.match(html, /data-i18n="hero\.title1"/)
  assert.match(pluginsHtml, /data-i18n-placeholder="catalog\.search"/)
  assert.match(pluginsHtml, /type="application\/json" href="https:\/\/dsh\.store\/registry\/catalog\.json"/)
  assert.match(pluginsHtml, /"@type": "SearchAction"/)
  assert.match(pluginsHtml, /"@type": "Dataset"/)
  assert.match(pluginsHtml, /DSH_STATIC_CATALOG_ITEMLIST/)
  assert.match(html, /class="brand-wordmark-frame"/)
  assert.match(html, /src="\.\/dsh-store-wordmark\.png"/)
  assert.match(html, /href="\.\/plugins\/"/)
  assert.match(html, /href="\.\/standards\/"/)
  assert.match(html, /href="\.\/build\/"/)
  assert.match(html, /href="\.\/faq\/"/)
  assert.match(html, /href="\.\/about\/"/)
  assert.ok(html.includes(submissionUrl))
  assert.ok(pluginsHtml.includes(submissionUrl))
  assert.ok(buildHtml.includes(submissionUrl))
  for (const page of [html, pluginsHtml, standardsHtml, buildHtml, faqHtml, aboutHtml, repairHtml]) {
    assert.match(page, /href="https:\/\/tracefence\.com\/"[^>]*>TraceFence/)
    assert.match(page, /href="https:\/\/aiaiai\.help\/"[^>]*>aiaiai\.help/)
    assert.match(page, /DSH_FRIEND_SISTER_SITE/)
  }
  assert.match(html, /data-automation-status-url="https:\/\/ai-scarlett\.github\.io\/DSH-Store\/automation-status\.json"/)
  for (const surface of [html, pluginsHtml, standardsHtml, buildHtml, faqHtml, aboutHtml, readme]) {
    assert.doesNotMatch(surface, /github\.com\/AI-Scarlett\/dsh-safe-plugin-manager|ai-scarlett\.github\.io\/dsh-safe-plugin-manager/)
  }
  assert.match(html, /id="manager"/)
  assert.match(html, /DSH_LEGACY_REPAIR_BANNER/)
  assert.match(repairHtml, /data-repair-state="catalog-pending"/)
  assert.match(repairHtml, /DSH_REPAIR_COMMAND/)
  assert.match(repairHtml, /--ignore-scripts/)
  assert.match(repairHtml, /https:\/\/dsh-store\.cn\/repair\//)
  assert.match(repairHtml, /https:\/\/ai-scarlett\.github\.io\/DSH-Store\/marketplace\/repair\//)
  assert.match(repairHtml, /查看本官方修复\/升级方案/)
  assert.match(repairClient, /navigator\.clipboard\.writeText/)
  assert.doesNotMatch(repairClient, /fetch\(|eval\(|new Function/)
  assert.match(repairCli, /createLegacyRepairService/)
  const parsedPackage = JSON.parse(packageManifest)
  assert.equal(parsedPackage.bin['dsh-store-repair'], './bin/dsh-store-repair.mjs')
  assert.equal(parsedPackage.scripts.prepare, undefined)
  assert.equal(parsedPackage.scripts.install, undefined)
  assert.match(html, /id="featured-grid"/)
  assert.doesNotMatch(html, /id="plugin-grid"/)
  assert.match(pluginsHtml, /id="plugin-grid"/)
  assert.match(pluginsHtml, /id="retry-catalog"/)
  assert.match(html, /data-copy-target="install-command"/)
  assert.match(html, /DSH_STATIC_CATALOG/)
  assert.match(html, /softwareVersion": "catalog-derived"/)
  assert.doesNotMatch(html, /git\+https:\/\/github\.com\/AI-Scarlett\/dsh-safe-plugin-manager\.git#[0-9a-f]{40}/)
  assert.ok(readme.includes(installCommand))
  assert.match(app, /featured === true/)
  assert.match(app, /featured\.length === 0/)
  assert.match(app, /featured\.emptyTitle/)
  assert.match(app, /No approved picks are currently featured\./)
  assert.match(app, /精选区暂时没有已批准的推荐条目。/)
  assert.match(app, /status !== 'unlisted'/)
  assert.match(app, /data-details-id/)
  assert.match(app, /showDetails/)
  assert.match(app, /dsh-marketplace-locale/)
  assert.match(app, /new URLSearchParams\(window\.location\.search\)/)
  assert.match(app, /value\.trim\(\)\.slice\(0, 80\)/)
  assert.match(app, /function setLocale/)
  assert.doesNotMatch(app, /function embeddedCatalog/)
  assert.match(app, /function changePage/)
  assert.match(pluginsHtml, /id="previous-page"/)
  assert.match(pluginsHtml, /id="next-page"/)
  assert.match(app, /function renderManagerMetadata/)
  assert.match(app, /github\.stars/)
  assert.match(app, /详情来自 GitHub catalog\.json/)
  assert.match(app, /前往 GitHub 手动安装/)
  assert.match(buildHtml, /id="install-skill"/)
  assert.match(faqHtml, /"@type": "FAQPage"/)
  assert.match(aboutHtml, /mailto:jadename\.zhou@gmail\.com/)
  assert.match(aboutHtml, /https:\/\/x\.com\/builtbyxm/)
  assert.match(styles, /\.load-error\[hidden\]\s*\{\s*display:\s*none;/)
  assert.match(readme, /AI-Scarlett\/build-dsh-plugin/)
  assert.match(readme, /上架必要条件/)
  assert.ok(readme.indexOf('提交一个公开 GitHub 项目地址') < readme.indexOf('## 安装插件商城'))
  assert.match(previewServer, /pathname\.startsWith\('\/marketplace\/'\)/)
  assert.match(previewServer, /relative\(marketplaceRoot, target\)/)
  assert.match(previewServer, /scoped\.startsWith\('\.\.'\)/)
  assert.match(previewServer, /isAbsolute\(scoped\)/)
})
