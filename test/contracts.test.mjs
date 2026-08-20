import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const project = new URL('../', import.meta.url)

test('package exposes a standard DSH bundle and client', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', project), 'utf8'))
  assert.equal(pkg.name, 'dsh-safe-plugin-manager')
  assert.equal(pkg.version, '0.5.6')
  assert.equal(pkg.main, './src/index.mjs')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
  for (const dependency of Object.keys(pkg.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-client-'))) {
    assert.equal(pkg.peerDependencies[dependency], '>=0.1.0-rc.8 <0.2.0')
  }
  assert.equal(pkg.private, true)
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
    /ctx\.loader/, /ctx\.reflect/,
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
  assert.match(client, /DSH_RC_RELEASES = \['rc\.5', 'rc\.6', 'rc\.7', 'rc\.8'\]/)
  assert.match(client, /function CompatibilityMatrix/)
  assert.match(client, /const SUPPORT_URL = 'https:\/\/dsh\.store\/'/)
  assert.match(client, /技术支持：DSH-Store/)
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
  assert.match(client, /normalizedEntries\.filter\(entry => view === 'installed' \? entry\.installed/)
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
  assert.equal(client.match(/操作失败并已触发回滚/g)?.length, 1)
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
  assert.match(client, /插件源更新规则/)
  assert.match(client, /Guardian 已验证，DSH 正在交接，页面会自动重新连接/)
  assert.match(client, /GUARDIAN_HANDOFF_TIMEOUT/)
  assert.doesNotMatch(client, /执行 DSH 升级|一键升级 DSH/)
})

test('rc.8 client contract stays on official ModuleLoader and settings ordering', async () => {
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
  assert.doesNotMatch(client, /ctx\.loader|ctx\.reflect|Loader\.|Fiber\./)
})

test('guardian health requires DSH HTTP identity and fails closed on an unowned port', async () => {
  const [daemon, service] = await Promise.all([
    readFile(new URL('src/guardian-daemon.mjs', project), 'utf8'),
    readFile(new URL('src/guardian.mjs', project), 'utf8'),
  ])
  assert.match(daemon, /\/api2\/dsh-safe-plugin-manager\/runtime/)
  assert.match(daemon, /runtime-identity-mismatch/)
  assert.match(daemon, /external-dsh-detected/)
  assert.match(daemon, /port-conflict/)
  assert.match(daemon, /consecutiveProbeFailures/)
  assert.match(service, /healthProbeTimeoutMs:\s*1_500/)
  assert.match(service, /unhealthyThreshold:\s*3/)
  assert.match(service, /startupGraceMs:\s*10_000/)
  assert.match(service, /commandPath/)
  assert.match(service, /GUARDIAN_BOOTSTRAP_UNVERIFIED/)
  assert.match(service, /waitForFreshGuardianHeartbeat/)
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
  const [html, app, pluginsHtml, buildHtml, faqHtml, aboutHtml, readme, previewServer, styles] = await Promise.all([
    readFile(new URL('marketplace/index.html', project), 'utf8'),
    readFile(new URL('marketplace/app.js', project), 'utf8'),
    readFile(new URL('marketplace/plugins/index.html', project), 'utf8'),
    readFile(new URL('marketplace/build/index.html', project), 'utf8'),
    readFile(new URL('marketplace/faq/index.html', project), 'utf8'),
    readFile(new URL('marketplace/about/index.html', project), 'utf8'),
    readFile(new URL('README.md', project), 'utf8'),
    readFile(new URL('scripts/serve-marketplace.mjs', project), 'utf8'),
    readFile(new URL('marketplace/styles.css', project), 'utf8'),
  ])
  const installCommand = "dsh plugin --profile web add 'git+https://github.com/AI-Scarlett/dsh-safe-plugin-manager.git#8bb4b17836b593ebc29c77882503bc70f759bbc6'"
  const submissionUrl = 'https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml'
  assert.match(html, /defer src="\.\/app\.js"/)
  assert.match(html, /data-locale="zh"/)
  assert.match(html, /data-locale="en"/)
  assert.match(html, /data-i18n="hero\.title1"/)
  assert.match(pluginsHtml, /data-i18n-placeholder="catalog\.search"/)
  assert.match(html, /class="brand-wordmark-frame"/)
  assert.match(html, /src="\.\/dsh-store-wordmark\.png"/)
  assert.match(html, /href="\.\/plugins\/"/)
  assert.match(html, /href="\.\/build\/"/)
  assert.match(html, /href="\.\/faq\/"/)
  assert.match(html, /href="\.\/about\/"/)
  assert.ok(html.includes(submissionUrl))
  assert.ok(pluginsHtml.includes(submissionUrl))
  assert.ok(buildHtml.includes(submissionUrl))
  assert.match(html, /id="manager"/)
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
  assert.match(app, /status !== 'unlisted'/)
  assert.match(app, /data-details-id/)
  assert.match(app, /showDetails/)
  assert.match(app, /dsh-marketplace-locale/)
  assert.match(app, /function setLocale/)
  assert.match(app, /function embeddedCatalog/)
  assert.match(app, /function renderManagerMetadata/)
  assert.match(app, /github\.stars/)
  assert.match(app, /详情来自 GitHub catalog\.json/)
  assert.match(app, /前往 GitHub 手动安装/)
  assert.match(buildHtml, /id="install-skill"/)
  assert.match(faqHtml, /"@type": "FAQPage"/)
  assert.match(aboutHtml, /mailto:jadename\.zhou@gmail\.com/)
  assert.match(aboutHtml, /https:\/\/x\.com\/JadeNameCulture/)
  assert.match(styles, /\.load-error\[hidden\]\s*\{\s*display:\s*none;/)
  assert.match(readme, /AI-Scarlett\/build-dsh-plugin/)
  assert.match(readme, /上架必要条件/)
  assert.ok(readme.indexOf('提交一个公开 GitHub 项目地址') < readme.indexOf('## 安装插件商城'))
  assert.match(previewServer, /pathname\.startsWith\('\/marketplace\/'\)/)
  assert.match(previewServer, /relative\(marketplaceRoot, target\)/)
  assert.match(previewServer, /scoped\.startsWith\('\.\.'\)/)
  assert.match(previewServer, /isAbsolute\(scoped\)/)
})
