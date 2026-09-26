import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { catalogBridgeBuffer, compareVersions, loadCatalogFromFiles, splitCatalogDocument } from '../src/catalog.mjs'
import { COMPATIBILITY_HOLD_PREFIX } from '../src/catalog-compatibility-policy.mjs'

const execFileAsync = promisify(execFile)
const root = new URL('../', import.meta.url)
const rootPath = fileURLToPath(root)
const staticBuilderPath = fileURLToPath(new URL('scripts/build-marketplace-static.mjs', root))
const sha256 = value => createHash('sha256').update(value).digest('hex')

test('GitHub enrichment skips non-approved sources that are intentionally unavailable', async () => {
  const builder = await readFile(new URL('scripts/build-marketplace-static.mjs', root), 'utf8')
  assert.match(builder, /mapLimit\(snapshot\.entries\.filter\(entry => entry\.status === 'approved'\), 5/)
  assert.match(builder, /response\.status === 403 && response\.headers\.get\('x-ratelimit-remaining'\) === '0'/)
  assert.match(builder, /if \(!repositoryResult\.error\.rateLimited\) throw repositoryResult\.error/)
  assert.match(builder, /if \(manifest\.version !== entry\.version\)/)
  assert.match(builder, /githubEnriched: enrichGitHub && githubMetadataComplete/)
  assert.match(builder, /enriched=\$\{snapshot\.generated\.githubEnriched\}/)
  assert.match(builder, /evidenceStatus \|\| entry\.assurance\?\.installability\?\.status/)
  assert.match(builder, /pnpm --config\.ignore-scripts=true dlx/)
})

test('static marketplace derives manager identity and catalog cards without mutating the authority file', async () => {
  const output = await mkdtemp(new URL('.tmp-marketplace-static-', root))
  const catalogPath = new URL('registry/catalog.json', root)
  const catalogIndexPath = new URL('registry/catalog-index.json', root)
  const catalogBefore = await readFile(catalogPath)
  const catalogIndexBefore = await readFile(catalogIndexPath)
  const catalog = await loadCatalogFromFiles()
  const manager = catalog.entries.find(entry => entry.id === 'dsh-safe-plugin-manager')
  assert.ok(manager)

  try {
    const outputArgument = relative(rootPath, output)
    const { stdout } = await execFileAsync(process.execPath, [
      staticBuilderPath,
      '--out', outputArgument,
      '--source-sha', 'test-source-sha',
    ], { cwd: rootPath })
    assert.match(stdout, /STATIC_MARKETPLACE_OK/)

    const catalogAfter = await readFile(catalogPath)
    const catalogIndexAfter = await readFile(catalogIndexPath)
    assert.equal(sha256(catalogAfter), sha256(catalogBefore))
    assert.equal(sha256(catalogIndexAfter), sha256(catalogIndexBefore))

    const home = await readFile(join(output, 'marketplace/index.html'), 'utf8')
    const plugins = await readFile(join(output, 'marketplace/plugins/index.html'), 'utf8')
    const standards = await readFile(join(output, 'marketplace/standards/index.html'), 'utf8')
    const article = await readFile(join(output, 'marketplace/about/deepseek-harness-guide/index.html'), 'utf8')
    const about = await readFile(join(output, 'marketplace/about/index.html'), 'utf8')
    const guide = await readFile(join(output, 'marketplace/dsh-plugins/index.html'), 'utf8')
    const faq = await readFile(join(output, 'marketplace/faq/index.html'), 'utf8')
    const repair = await readFile(join(output, 'marketplace/repair/index.html'), 'utf8')
    const scans = await readFile(join(output, 'marketplace/scans/index.html'), 'utf8')
    const scansStyles = await readFile(join(output, 'marketplace/scans/scans.css'), 'utf8')
    const downloads = await readFile(join(output, 'marketplace/downloads/index.html'), 'utf8')
    const downloadsStyles = await readFile(join(output, 'marketplace/downloads/downloads.css'), 'utf8')
    const downloadsScript = await readFile(join(output, 'marketplace/downloads/downloads.js'), 'utf8')
    const navigationScript = await readFile(join(output, 'marketplace/scan-history-nav.js'), 'utf8')
    const manualScan = JSON.parse(await readFile(join(output, 'marketplace/scans/data/manual-baseline-20260925.json'), 'utf8'))
    const repairManifest = JSON.parse(await readFile(join(output, 'marketplace/repair/repair-manifest.json'), 'utf8'))
    const robots = await readFile(join(output, 'marketplace/robots.txt'), 'utf8')
    const markdown = await readFile(join(output, 'marketplace/index.md'), 'utf8')
    const sitemap = await readFile(join(output, 'marketplace/sitemap.xml'), 'utf8')
    const styles = await readFile(join(output, 'marketplace/styles.css'), 'utf8')
    const manifest = JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8'))
    const release = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'))
    const automationStatus = JSON.parse(await readFile(join(output, 'automation-status.json'), 'utf8'))

    await assert.rejects(
      readFile(join(output, 'marketplace/googled542dac4f5a6c169.html'), 'utf8'),
      error => error?.code === 'ENOENT',
    )

    assert.equal(manifest.manager.version, manager.version)
    assert.equal(manifest.manager.commit, manager.commit)
    assert.equal(manifest.manager.license, manager.details.license)
    assert.equal(manifest.manager.status, manager.status)
    assert.equal(manifest.sourceCommit, 'test-source-sha')
    assert.equal(manifest.alternateOrigin, 'https://dsh-store.cn')
    assert.equal(manifest.githubEnriched, false)
    assert.equal(release.sourceCommit, 'test-source-sha')
    assert.equal(release.files['marketplace/googled542dac4f5a6c169.html'], undefined)
    assert.ok(release.files['marketplace/index.html'])
    assert.ok(release.files['marketplace/index.md'])
    assert.ok(release.files['marketplace/robots.txt'])
    assert.ok(release.files['marketplace/plugins/index.html'])
    assert.ok(release.files['marketplace/standards/index.html'])
    assert.ok(release.files['marketplace/about/deepseek-harness-guide/index.html'])
    assert.ok(release.files['marketplace/repair/index.html'])
    assert.ok(release.files['marketplace/repair/repair-manifest.json'])
    assert.ok(release.files['marketplace/scans/index.html'])
    assert.ok(release.files['marketplace/scans/scans.js'])
    assert.ok(release.files['marketplace/scans/scans.css'])
    assert.ok(release.files['marketplace/scans/data/manual-baseline-20260925.json'])
    assert.ok(release.files['marketplace/downloads/index.html'])
    assert.ok(release.files['marketplace/downloads/downloads.css'])
    assert.ok(release.files['marketplace/downloads/downloads.js'])
    assert.ok(release.files['marketplace/scan-history-nav.js'])
    assert.ok(release.files['registry/catalog.json'])
    assert.ok(release.files['registry/catalog-index.json'])
    assert.ok(release.files['registry/catalog/details/dsh-safe-plugin-manager.json'])
    assert.equal(release.files['marketplace/catalog.snapshot.json'], undefined)
    assert.equal(release.files['automation-status.json'], undefined, 'run-only status must not rotate production releases')
    assert.equal(automationStatus.overall.status, 'unknown')
    assert.deepEqual(automationStatus.recentScanRuns, [])
    assert.equal(automationStatus.catalog.entries, catalog.entries.length)
    assert.ok(home.includes(`"softwareVersion": "${manager.version}"`))
    if (manager.status === 'approved') assert.match(home, new RegExp(manager.commit))
    else {
      assert.doesNotMatch(home, /dsh plugin --profile web add/)
      assert.match(home, /data-copy-target="install-command" disabled aria-disabled="true"/)
    }
    assert.match(home, /name="dsh-catalog-delivery" content="external-json"/)
    assert.match(home, /data-automation-overall/)
    assert.match(home, /class="site-switch-link"[^>]*href="https:\/\/dsh-store\.cn\//)
    assert.match(home, /href="\.\/scans\/" data-scan-history-nav/)
    assert.match(home, /src="\.\/scan-history-nav\.js"/)
    assert.match(navigationScript, /data-desktop-download-menu/)
    assert.match(navigationScript, /headerTools\.insertBefore\(wrapper, localeSwitch\)/)
    assert.match(navigationScript, /new URL\('\.\.\/downloads\/', scanLink\.href\)/)
    assert.equal((navigationScript.match(/^\s{2}appendMenuOption\(panel,/gm) ?? []).length, 3)
    assert.match(navigationScript, /trigger: '下载 DSH'/)
    assert.match(navigationScript, /trigger: 'Get DSH'/)
    assert.doesNotMatch(home, /href="\.\/downloads\/"/)
    assert.match(navigationScript, /desktopDownloads\.mac/)
    assert.match(navigationScript, /desktopDownloads\.windows/)
    assert.match(navigationScript, /#web-ui/)
    assert.match(plugins, /href="\.\.\/scans\/" data-scan-history-nav/)
    assert.match(home, /<html lang="en" data-default-locale="en">/)
    assert.doesNotMatch(home, /baidu-site-verification/)
    assert.doesNotMatch(home, /baidu_union_verify/)
    assert.doesNotMatch(home, /hm\.baidu\.com\/hm\.js/)
    assert.match(home, /DSH STORE \| DeepSeek Harness Plugin Marketplace/)
    assert.match(home, /name="applicable-device" content="pc,mobile"/)
    assert.match(home, /href="\.\/dsh-plugins\/"[^>]*data-analytics-event="guide_open"/)
    assert.match(home, /href="https:\/\/tracefence\.com\/"[^>]*>TraceFence/)
    assert.match(home, /href="https:\/\/aiaiai\.help\/"[^>]*>aiaiai\.help/)
    assert.match(home, /href="https:\/\/dsh-store\.cn\/"[^>]*>DSH STORE · 国内站/)
    assert.doesNotMatch(home, /href="https:\/\/dsh\.store\/"[^>]*>DSH STORE · International/)
    assert.match(home, /hreflang="en"[^>]*https:\/\/dsh\.store\//)
    assert.match(home, /hreflang="zh-CN"[^>]*https:\/\/dsh-store\.cn\//)
    assert.doesNotMatch(home, /DSH_ALTERNATE_SITE/)
    assert.doesNotMatch(home, /id="catalog-snapshot"/)
    assert.equal((plugins.match(/data-static-plugin-id=/g) || []).length, Math.min(20, catalog.entries.filter(entry => entry.status !== 'unlisted').length))
    assert.match(plugins, /name="dsh-catalog-delivery" content="external-json"/)
    assert.match(plugins, /type="application\/json" href="https:\/\/dsh\.store\/registry\/catalog\.json"/)
    assert.match(plugins, /"@type": "SearchAction"/)
    assert.match(plugins, /"@type": "Dataset"/)
    assert.match(plugins, /"@type": "ItemList"/)
    if (manager.status === 'approved') {
      assert.match(plugins, /id="plugin-dsh-safe-plugin-manager"[^>]*data-static-plugin-id="dsh-safe-plugin-manager"/)
    } else {
      assert.doesNotMatch(plugins, /data-static-plugin-id="dsh-safe-plugin-manager"/)
    }
    assert.match(plugins, /搜索中文名、用途、别名或英文包名/)
    assert.doesNotMatch(plugins, /id="catalog-snapshot"/)
    assert.ok(Buffer.byteLength(home) < 300_000, 'home HTML must not embed the complete catalog')
    assert.ok(Buffer.byteLength(plugins) < 500_000, 'directory HTML must contain only the first static page')
    assert.match(guide, /DSH 插件/)
    assert.match(guide, /DeepSeek Harness/)
    assert.match(guide, /build-dsh-plugin/)
    assert.match(guide, /hreflang="x-default"/)
    assert.doesNotMatch(faq, /查看使用与排查指南/)
    assert.match(standards, /Candidate Registry/)
    assert.match(standards, /installActionsDisabled = true/)
    assert.match(standards, /不会运行第三方 install、prepare、build、test 或运行时代码/)
    assert.match(standards, /href="\.\/" aria-current="page" data-i18n="nav\.standards"/)
    assert.match(standards, /hreflang="x-default"[^>]*https:\/\/dsh\.store\/standards\//)
    assert.match(article, /<html lang="zh-CN" data-default-locale="zh" data-fixed-locale="zh-CN">/)
    assert.match(article, /hreflang="en"[^>]*https:\/\/dsh\.store\/about\/deepseek-harness-guide\//)
    assert.match(article, /hreflang="x-default"[^>]*https:\/\/dsh\.store\/about\/deepseek-harness-guide\//)
    assert.match(article, /hreflang="zh-CN"[^>]*https:\/\/dsh-store\.cn\/about\/deepseek-harness-guide\//)
    assert.match(article, /class="site-switch-link"[^>]*href="https:\/\/dsh-store\.cn\//)
    assert.match(article, /作者：<a href="https:\/\/x\.com\/Russell3402"/)
    assert.match(article, /https:\/\/mp\.weixin\.qq\.com\/s\/oKppevLlwQOg8TfPG74rVw/)
    assert.match(about, /href="\.\/deepseek-harness-guide\/"/)
    assert.doesNotMatch(about, /DSH_ARTICLE_PROMO/)
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
      assert.match(robots, new RegExp(`User-agent: ${bot}\\nAllow: /`))
    }
    for (const bot of [
      'Bytespider', 'KimiBot', 'Kimi-User', 'Kimi-SearchBot', 'DeepSeekBot',
      'YuanBaoBot', 'ChatGLM-Spider', 'MiniMaxBot', 'PetalBot', 'Baiduspider',
    ]) {
      assert.match(robots, new RegExp(`User-agent: ${bot}\\nAllow: /\\nDisallow: /_analytics/\\nDisallow: /_events/`))
    }
    assert.ok(markdown.length > 200, 'clean homepage Markdown must exceed 200 characters')
    assert.match(markdown, /第三方插件商城/)
    assert.match(markdown, /固定的完整 Git Commit/)
    assert.match(markdown, /收录或“可安装”状态不等于完整安全审计/)
    const llms = await readFile(join(output, 'marketplace/llms.txt'), 'utf8')
    assert.match(llms, /## Current catalog snapshot/)
    assert.match(llms, new RegExp(`- Listed plugins: ${catalog.entries.filter(entry => entry.status !== 'unlisted').length}`))
    assert.match(llms, /- Website build source commit: test-source-sha/)
    assert.doesNotMatch(llms, /Domestic product use and issue-boundary guide/)
    assert.match(sitemap, /https:\/\/dsh\.store\/dsh-plugins\//)
    assert.match(sitemap, /https:\/\/dsh\.store\/standards\//)
    assert.match(sitemap, /https:\/\/dsh\.store\/about\/deepseek-harness-guide\//)
    assert.match(sitemap, /https:\/\/dsh\.store\/repair\//)
    assert.match(sitemap, /https:\/\/dsh\.store\/scans\//)
    assert.match(sitemap, /https:\/\/dsh\.store\/downloads\//)
    assert.doesNotMatch(sitemap, /dsh-store-guide/)
    assert.match(sitemap, /xmlns:mobile="http:\/\/www\.baidu\.com\/schemas\/sitemap-mobile\/1\//)
    assert.match(sitemap, /<mobile:mobile type="pc,mobile" \/>/)
    assert.match(sitemap, new RegExp(`<lastmod>${catalog.registry.updatedAt.slice(0, 10)}</lastmod>`))
    assert.match(styles, /\.load-error\[hidden\]\s*\{\s*display:\s*none;/)
    assert.match(styles, /\.site-nav a \{[\s\S]*font-size: 12px;/)
    assert.match(styles, /\.footer-bottom \{[\s\S]*font-size: 11px;/)
    assert.match(repair, /ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED/)
    assert.equal(manualScan.scanId, 'DSH-STORE-MANUAL-BASELINE-13739-20260925')
    assert.match(scans, /role="tablist"/)
    assert.match(scans, /aria-controls="panel-automatic"/)
    assert.match(scans, /data-automation-status-url="https:\/\/ai-scarlett\.github\.io\/DSH-Store\/automation-status\.json"/)
    assert.equal(manualScan.source.sourceCount, 13739)
    assert.equal(manualScan.source.processedCount, 13739)
    assert.deepEqual(manualScan.classificationCounts, {
      'store-auto-eligible': 3,
      'candidate-review-noninstallable': 13045,
      'rejected-hard-gate': 500,
      'unverified-deferred': 191,
    })
    assert.equal(manualScan.eligiblePackages.length, 3)
    assert.match(scansStyles, /\.scan-tabs button\[aria-selected="true"\]/)
    assert.match(downloads, /https:\/\/download\.deepseek\.com\/dsh-desk\/bin\/mac-arm64\/deepseek-harness-0\.1\.7-rc\.1\.20260924\.1-mac-arm64\.dmg/)
    assert.match(downloads, /https:\/\/download\.deepseek\.com\/dsh-desk\/bin\/win-x64\/deepseek-harness-0\.1\.7-rc\.1\.20260924\.1-win-x64\.exe/)
    assert.match(downloads, /0\.1\.7-rc\.1/)
    assert.match(downloads, /data-default-locale="en"/)
    assert.match(downloads, /https:\/\/deepseek\.com\/harness\//)
    assert.match(downloads, /developer preview|开发者预览版/i)
    assert.doesNotMatch(downloads, /data-desktop-download-nav/)
    assert.match(downloads, /id="web-ui" class="downloads-source"/)
    assert.match(downloads, /https:\/\/github\.com\/deepseek-ai\/deepseek-harness/)
    assert.match(downloads, /npx @deepseek-ai\/dsh web/)
    assert.match(downloads, /Node\.js/)
    assert.match(downloadsStyles, /\.downloads-grid\s*\{\s*display:\s*grid/)
    assert.match(downloadsStyles, /\.desktop-downloads-page \.system-status b \{ color: var\(--dsh-blue\) !important; background: transparent !important; \}/)
    assert.match(downloadsScript, /Apple Silicon ARM64 installer/)
    const repairActive = manager.status === 'approved' && compareVersions(manager.version, '0.8.10') >= 0
    if (repairActive) {
      assert.match(home, /legacy-repair-banner/)
      assert.match(repair, /data-repair-state="active"/)
      assert.match(repair, new RegExp(manager.commit))
      assert.equal(repairManifest.status, 'active')
      assert.equal(repairManifest.repairTool.packageSpecifier,
        `git+https://github.com/AI-Scarlett/DSH-Store.git#${manager.commit}`)
      assert.match(repairManifest.repairTool.command, /pnpm --config\.ignore-scripts=true dlx/)
      assert.match(repairManifest.repairTool.command, new RegExp(`--target-version ${manager.version}`))
      assert.match(repairManifest.repairTool.command, new RegExp(`--target-commit ${manager.commit}`))
    } else {
      assert.doesNotMatch(home, /legacy-repair-banner/)
      assert.match(repair, /data-repair-state="catalog-pending"/)
      assert.doesNotMatch(repair, /pnpm --config\.ignore-scripts=true dlx/)
      assert.equal(repairManifest.status, 'catalog-pending')
      assert.equal(repairManifest.repairTool, null)
    }
    assert.equal(repairManifest.target.version, manager.version)
    assert.equal(repairManifest.target.commit, manager.commit)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('static build serializes only available automated scan evidence into the public run history', async () => {
  const output = await mkdtemp(new URL('.tmp-scan-history-build-', root))
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-store-scan-history-fixture-'))
  const reportDir = join(fixture, '40')
  try {
    await mkdir(reportDir)
    await writeFile(join(fixture, 'automation-runs.json'), JSON.stringify({
      catalogAutomation: [
        { databaseId: 41, status: 'completed', conclusion: 'failure', event: 'schedule', createdAt: '2026-08-22T03:00:00Z', updatedAt: '2026-08-22T03:05:00Z', url: 'https://github.com/example/repo/actions/runs/41', headSha: 'b'.repeat(40) },
        { databaseId: 40, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', createdAt: '2026-08-22T02:00:00Z', updatedAt: '2026-08-22T02:05:00Z', url: 'https://github.com/example/repo/actions/runs/40', headSha: 'c'.repeat(40) },
      ],
    }))
    await writeFile(join(reportDir, 'catalog-automation-report.json'), JSON.stringify({
      completed: true,
      observedAt: '2026-08-22T02:04:00Z',
      addedEntries: [],
      updatedEntries: [],
      compatibilityUnlisted: [],
      compatibilityRestored: [],
      prunedCandidates: [],
      rejectedCandidates: [],
      deferredUpdates: [],
      transientFailures: [],
      sourceVersionChecks: { checkedEntries: 25, sameVersionCatalogUpdates: 0 },
    }))

    const { stdout } = await execFileAsync(process.execPath, [
      staticBuilderPath,
      '--out', relative(rootPath, output),
      '--automation-runs', join(fixture, 'automation-runs.json'),
      '--automation-reports', fixture,
      '--source-sha', 'test-scan-history-sha',
    ], { cwd: rootPath })
    assert.match(stdout, /STATIC_MARKETPLACE_OK/)
    const status = JSON.parse(await readFile(join(output, 'automation-status.json'), 'utf8'))
    assert.equal(status.recentScanRuns.length, 2)
    assert.equal(status.recentScanRuns[0].runId, 41)
    assert.equal(status.recentScanRuns[0].event, 'schedule')
    assert.equal(status.recentScanRuns[0].reportAvailable, false)
    assert.equal(status.recentScanRuns[0].statisticsAvailable, false)
    assert.equal(status.recentScanRuns[0].added, null)
    assert.equal(status.recentScanRuns[1].runId, 40)
    assert.equal(status.recentScanRuns[1].event, 'workflow_dispatch')
    assert.equal(status.recentScanRuns[1].statisticsAvailable, true)
    assert.equal(status.recentScanRuns[1].added, 0)
    assert.equal(status.recentScanRuns[1].sourceVersionChecks.checkedEntries, 25)
  } finally {
    await rm(output, { recursive: true, force: true })
    await rm(fixture, { recursive: true, force: true })
  }
})

test('static marketplace publishes a compatibility-held manager without installation or repair commands', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-store-unlisted-manager-'))
  try {
    await mkdir(join(fixture, 'scripts'))
    await Promise.all([
      cp(join(rootPath, 'package.json'), join(fixture, 'package.json')),
      cp(join(rootPath, 'src'), join(fixture, 'src'), { recursive: true }),
      cp(join(rootPath, 'marketplace'), join(fixture, 'marketplace'), { recursive: true }),
      cp(join(rootPath, 'registry'), join(fixture, 'registry'), { recursive: true }),
      cp(staticBuilderPath, join(fixture, 'scripts/build-marketplace-static.mjs')),
    ])
    const catalog = await loadCatalogFromFiles()
    const manager = catalog.entries.find(entry => entry.id === 'dsh-safe-plugin-manager')
    assert.ok(manager)
    manager.status = 'unlisted'
    manager.statusReason = `${COMPATIBILITY_HOLD_PREFIX} test release window has no exact compatible result`
    const split = splitCatalogDocument(catalog)
    await Promise.all([
      writeFile(join(fixture, 'registry/catalog.json'), catalogBridgeBuffer(split.bridge)),
      writeFile(join(fixture, 'registry/catalog-index.json'), `${JSON.stringify(split.index, null, 2)}\n`),
      writeFile(join(fixture, 'registry/catalog/details/dsh-safe-plugin-manager.json'), `${JSON.stringify(manager, null, 2)}\n`),
    ])
    const { stdout } = await execFileAsync(process.execPath, [
      join(fixture, 'scripts/build-marketplace-static.mjs'), '--out', '_site', '--source-sha', 'held-manager-fixture',
    ], { cwd: fixture })
    assert.match(stdout, /STATIC_MARKETPLACE_OK/)
    const home = await readFile(join(fixture, '_site/marketplace/index.html'), 'utf8')
    const plugins = await readFile(join(fixture, '_site/marketplace/plugins/index.html'), 'utf8')
    const repair = await readFile(join(fixture, '_site/marketplace/repair/index.html'), 'utf8')
    const repairManifest = JSON.parse(await readFile(join(fixture, '_site/marketplace/repair/repair-manifest.json'), 'utf8'))
    assert.match(home, /Compatibility review pending; installation is unavailable/)
    assert.match(home, /data-copy-target="install-command" disabled aria-disabled="true"/)
    assert.doesNotMatch(home, /dsh plugin --profile web add/)
    assert.doesNotMatch(plugins, /data-static-plugin-id="dsh-safe-plugin-manager"/)
    assert.match(repair, /data-repair-state="catalog-pending"/)
    assert.equal(repairManifest.status, 'catalog-pending')
    assert.equal(repairManifest.repairTool, null)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('static marketplace accepts a domestic origin and renders the ICP record', async () => {
  const output = await mkdtemp(new URL('.tmp-marketplace-domestic-', root))
  const icp = '鄂ICP备2026010180号-2'
  try {
    await execFileAsync(process.execPath, [
      staticBuilderPath,
      '--out', relative(rootPath, output),
      '--source-sha', 'domestic-test-sha',
      '--site-origin', 'https://dsh-store.cn',
      '--alternate-origin', 'https://dsh.store',
      '--icp', icp,
      '--baidu-verification', 'codeva-gZjUUScijx',
    ], { cwd: rootPath })

    const pagePaths = [
      'marketplace/index.html',
      'marketplace/plugins/index.html',
      'marketplace/community/index.html',
      'marketplace/standards/index.html',
      'marketplace/build/index.html',
      'marketplace/faq/index.html',
      'marketplace/about/index.html',
      'marketplace/repair/index.html',
      'marketplace/dsh-plugins/index.html',
      'marketplace/dsh-store-guide/index.html',
      'marketplace/about/deepseek-harness-guide/index.html',
    ]
    for (const pagePath of pagePaths) {
      const page = await readFile(join(output, pagePath), 'utf8')
      assert.match(page, /https:\/\/dsh-store\.cn/)
      assert.match(page, new RegExp(icp))
      assert.match(page, /<meta name="baidu-site-verification" content="codeva-gZjUUScijx">/)
      assert.equal((page.match(/https:\/\/hm\.baidu\.com\/hm\.js\?7c34f1fd076e8f052b6a6f746ab1135d/g) || []).length, 1)
      assert.ok(page.indexOf('hm.baidu.com/hm.js?7c34f1fd076e8f052b6a6f746ab1135d') < page.indexOf('</head>'))
      assert.match(page, /<html lang="zh-CN" data-default-locale="zh"(?: data-fixed-locale="zh-CN")?>/)
      assert.match(page, /class="site-switch-link"[^>]*href="https:\/\/dsh\.store\/"/)
      assert.match(page, /href="https:\/\/tracefence\.com\/"[^>]*>TraceFence/)
      assert.match(page, /href="https:\/\/aiaiai\.help\/"[^>]*>aiaiai\.help/)
      assert.match(page, /href="https:\/\/dsh\.store\/"[^>]*>DSH STORE · International/)
      assert.doesNotMatch(page, /href="https:\/\/dsh-store\.cn\/"[^>]*>DSH STORE · 国内站/)
      if (pagePath === 'marketplace/index.html') {
        assert.match(page, /<meta name="baidu_union_verify" content="f7a5e80f6ec4d01cdfd011c771e7e706">/)
      } else {
        assert.doesNotMatch(page, /baidu_union_verify/)
      }
    }
    const robots = await readFile(join(output, 'marketplace/robots.txt'), 'utf8')
    const markdown = await readFile(join(output, 'marketplace/index.md'), 'utf8')
    const domesticGuide = await readFile(join(output, 'marketplace/dsh-store-guide/index.html'), 'utf8')
    const sitemap = await readFile(join(output, 'marketplace/sitemap.xml'), 'utf8')
    const domesticFaq = await readFile(join(output, 'marketplace/faq/index.html'), 'utf8')
    const domesticLlms = await readFile(join(output, 'marketplace/llms.txt'), 'utf8')
    const manifest = JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8'))
    const release = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'))
    const domesticAbout = await readFile(join(output, 'marketplace/about/index.html'), 'utf8')
    const domesticArticle = await readFile(join(output, 'marketplace/about/deepseek-harness-guide/index.html'), 'utf8')
    const googleSiteVerification = await readFile(join(output, 'marketplace/googled542dac4f5a6c169.html'), 'utf8')
    assert.equal(googleSiteVerification, 'google-site-verification: googled542dac4f5a6c169.html')
    assert.match(robots, /Sitemap: https:\/\/dsh-store\.cn\/sitemap\.xml/)
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
      assert.match(robots, new RegExp(`User-agent: ${bot}\\nAllow: /`))
    }
    for (const bot of [
      'Bytespider', 'KimiBot', 'Kimi-User', 'Kimi-SearchBot', 'DeepSeekBot',
      'YuanBaoBot', 'ChatGLM-Spider', 'MiniMaxBot', 'PetalBot', 'Baiduspider',
    ]) {
      assert.match(robots, new RegExp(`User-agent: ${bot}\\nAllow: /\\nDisallow: /_analytics/\\nDisallow: /_events/`))
    }
    assert.ok(markdown.length > 200, 'domestic clean homepage Markdown must exceed 200 characters')
    assert.match(markdown, /第三方插件商城/)
    assert.match(sitemap, /https:\/\/dsh-store\.cn\//)
    assert.match(sitemap, /https:\/\/dsh-store\.cn\/dsh-plugins\//)
    assert.match(sitemap, /https:\/\/dsh-store\.cn\/standards\//)
    assert.match(sitemap, /https:\/\/dsh-store\.cn\/about\/deepseek-harness-guide\//)
    assert.match(sitemap, /https:\/\/dsh-store\.cn\/repair\//)
    assert.match(sitemap, /https:\/\/dsh-store\.cn\/dsh-store-guide\//)
    assert.doesNotMatch(sitemap, /https:\/\/dsh\.store/)
    assert.match(domesticAbout, /href="\.\/deepseek-harness-guide\/"/)
    assert.match(domesticAbout, /Russell3402/)
    assert.doesNotMatch(domesticAbout, /DSH_ARTICLE_PROMO/)
    assert.ok(release.files['marketplace/about/deepseek-harness-guide/index.html'])
    assert.ok(release.files['marketplace/dsh-store-guide/index.html'])
    assert.ok(release.files['marketplace/googled542dac4f5a6c169.html'])
    assert.match(domesticGuide, /商城、CLI、Profile、依赖与 Catalog/)
    assert.match(domesticGuide, /https:\/\/raw\.githubusercontent\.com\/AI-Scarlett\/DSH-Store\/main\/registry\/catalog\.json/)
    assert.match(domesticFaq, /href="\.\.\/dsh-store-guide\/"/)
    assert.match(domesticLlms, /Domestic product use and issue-boundary guide: https:\/\/dsh-store\.cn\/dsh-store-guide\//)
    assert.match(domesticArticle, /<html lang="zh-CN" data-default-locale="zh" data-fixed-locale="zh-CN">/)
    assert.match(domesticArticle, /<link rel="canonical" href="https:\/\/dsh-store\.cn\/about\/deepseek-harness-guide\/">/)
    assert.match(domesticArticle, /hreflang="en"[^>]*https:\/\/dsh\.store\/about\/deepseek-harness-guide\//)
    assert.match(domesticArticle, /hreflang="zh-CN"[^>]*https:\/\/dsh-store\.cn\/about\/deepseek-harness-guide\//)
    assert.match(domesticArticle, /hreflang="x-default"[^>]*https:\/\/dsh\.store\/about\/deepseek-harness-guide\//)
    assert.match(domesticArticle, /class="site-switch-link"[^>]*href="https:\/\/dsh\.store\//)
    assert.match(domesticArticle, /https:\/\/mp\.weixin\.qq\.com\/s\/oKppevLlwQOg8TfPG74rVw/)
    assert.equal(manifest.siteOrigin, 'https://dsh-store.cn')
    assert.equal(manifest.alternateOrigin, 'https://dsh.store')
    assert.equal(manifest.icp, icp)
    assert.equal(manifest.baiduSiteVerification, 'configured')
    assert.equal(manifest.baiduUnionVerification, 'configured')
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
