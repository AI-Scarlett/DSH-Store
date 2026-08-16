import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const project = new URL('../', import.meta.url)

test('package exposes a standard DSH bundle and client', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', project), 'utf8'))
  assert.equal(pkg.name, 'dsh-safe-plugin-manager')
  assert.equal(pkg.version, '0.4.0')
  assert.equal(pkg.main, './src/index.mjs')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
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
  assert.match(runner, /commandEnvironment/)
  assert.match(operations, /OFFICIAL_PROTECTED/)
  assert.match(operations, /CRITICAL_ENTRY_PROTECTED/)
  assert.match(operations, /capturePreconditions/)
  assert.match(operations, /backupProfile/)
  assert.match(operations, /restoreBackup/)
  assert.match(operations, /CONFIRMATION_MISMATCH/)
  assert.match(operations, /DSH_PNPM_NOT_FOUND/)
  assert.match(operations, /rollbackDetails/)
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
  assert.match(client, /GitHub-only/)
  assert.match(client, /DSH第三方插件商城/)
  assert.match(client, /label: \(\) => '插件商城'/)
  assert.match(client, /迁移到商城版/)
  assert.match(client, /require\('@deepseek-ai\/dsh-client-ui-primitives'\)/)
  assert.match(client, /PluginDetailsModal/)
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
  const planSource = client.slice(client.indexOf('function PlanPanel'), client.indexOf('function ManagerPanel'))
  assert.match(planSource, /React\.createElement\(Modal/)
  assert.match(planSource, /正在生成操作计划/)
  assert.match(planSource, /操作预览与确认/)
  assert.match(client, /执行并启用自动回滚/)
  assert.match(client, /Profile 文件恢复/)
  assert.equal(client.match(/操作失败并已触发回滚/g)?.length, 1)
  assert.doesNotMatch(client, /id:\s*'all'/)
})

test('GitHub Pages marketplace handles omitted featured flags deterministically', async () => {
  const source = await readFile(new URL('marketplace/index.html', project), 'utf8')
  assert.match(source, /featured === true/)
  assert.match(source, /status !== 'unlisted'/)
  assert.match(source, /按分类筛选/)
  assert.match(source, /data-details-id/)
  assert.match(source, /showDetails/)
  assert.match(source, /详情来自 GitHub catalog\.json/)
  assert.match(source, /前往 GitHub 手动安装/)
})
