import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const root = new URL('../', import.meta.url)
const rootPath = fileURLToPath(root)
const sha256 = value => createHash('sha256').update(value).digest('hex')

test('GitHub enrichment skips non-approved sources that are intentionally unavailable', async () => {
  const builder = await readFile(new URL('scripts/build-marketplace-static.mjs', root), 'utf8')
  assert.match(builder, /mapLimit\(snapshot\.entries\.filter\(entry => entry\.status === 'approved'\), 5/)
})

test('static marketplace derives manager identity and catalog cards without mutating the authority file', async () => {
  const output = await mkdtemp(new URL('.tmp-marketplace-static-', root))
  const catalogPath = new URL('registry/catalog.json', root)
  const catalogBefore = await readFile(catalogPath)
  const catalog = JSON.parse(catalogBefore)
  const manager = catalog.entries.find(entry => entry.id === 'dsh-safe-plugin-manager')
  assert.ok(manager)

  try {
    const outputArgument = relative(rootPath, output)
    const { stdout } = await execFileAsync(process.execPath, [
      new URL('scripts/build-marketplace-static.mjs', root).pathname,
      '--out', outputArgument,
      '--source-sha', 'test-source-sha',
    ], { cwd: rootPath })
    assert.match(stdout, /STATIC_MARKETPLACE_OK/)

    const catalogAfter = await readFile(catalogPath)
    assert.equal(sha256(catalogAfter), sha256(catalogBefore))

    const home = await readFile(join(output, 'marketplace/index.html'), 'utf8')
    const plugins = await readFile(join(output, 'marketplace/plugins/index.html'), 'utf8')
    const guide = await readFile(join(output, 'marketplace/dsh-plugins/index.html'), 'utf8')
    const sitemap = await readFile(join(output, 'marketplace/sitemap.xml'), 'utf8')
    const styles = await readFile(join(output, 'marketplace/styles.css'), 'utf8')
    const manifest = JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8'))
    const release = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'))
    const automationStatus = JSON.parse(await readFile(join(output, 'automation-status.json'), 'utf8'))

    assert.equal(manifest.manager.version, manager.version)
    assert.equal(manifest.manager.commit, manager.commit)
    assert.equal(manifest.manager.license, manager.details.license)
    assert.equal(manifest.manager.status, manager.status)
    assert.equal(manifest.sourceCommit, 'test-source-sha')
    assert.equal(manifest.alternateOrigin, 'https://dsh-store.cn')
    assert.equal(manifest.githubEnriched, false)
    assert.equal(release.sourceCommit, 'test-source-sha')
    assert.ok(release.files['marketplace/index.html'])
    assert.ok(release.files['marketplace/plugins/index.html'])
    assert.ok(release.files['registry/catalog.json'])
    assert.equal(release.files['automation-status.json'], undefined, 'run-only status must not rotate production releases')
    assert.equal(automationStatus.overall.status, 'unknown')
    assert.equal(automationStatus.catalog.entries, catalog.entries.length)
    assert.ok(home.includes(`"softwareVersion": "${manager.version}"`))
    assert.match(home, new RegExp(manager.commit))
    assert.match(home, /name="dsh-catalog-delivery" content="external-json"/)
    assert.match(home, /data-automation-overall/)
    assert.match(home, /class="site-switch-link"[^>]*href="https:\/\/dsh-store\.cn\//)
    assert.match(home, /<html lang="en" data-default-locale="en">/)
    assert.match(home, /DSH STORE \| DeepSeek Harness Plugin Marketplace/)
    assert.match(home, /name="applicable-device" content="pc,mobile"/)
    assert.match(home, /href="\.\/dsh-plugins\/"[^>]*data-analytics-event="guide_open"/)
    assert.match(home, /hreflang="en"[^>]*https:\/\/dsh\.store\//)
    assert.match(home, /hreflang="zh-CN"[^>]*https:\/\/dsh-store\.cn\//)
    assert.doesNotMatch(home, /DSH_ALTERNATE_SITE/)
    assert.doesNotMatch(home, /id="catalog-snapshot"/)
    assert.equal((plugins.match(/data-static-plugin-id=/g) || []).length, Math.min(24, catalog.entries.filter(entry => entry.status !== 'unlisted').length))
    assert.match(plugins, /name="dsh-catalog-delivery" content="external-json"/)
    assert.match(plugins, /搜索中文名、用途、别名或英文包名/)
    assert.doesNotMatch(plugins, /id="catalog-snapshot"/)
    assert.ok(Buffer.byteLength(home) < 300_000, 'home HTML must not embed the complete catalog')
    assert.ok(Buffer.byteLength(plugins) < 500_000, 'directory HTML must contain only the first static page')
    assert.match(guide, /DSH 插件/)
    assert.match(guide, /DeepSeek Harness/)
    assert.match(guide, /build-dsh-plugin/)
    assert.match(guide, /hreflang="x-default"/)
    assert.match(sitemap, /https:\/\/dsh\.store\/dsh-plugins\//)
    assert.match(sitemap, /xmlns:mobile="http:\/\/www\.baidu\.com\/schemas\/sitemap-mobile\/1\//)
    assert.match(sitemap, /<mobile:mobile type="pc,mobile" \/>/)
    assert.match(sitemap, new RegExp(`<lastmod>${catalog.registry.updatedAt.slice(0, 10)}</lastmod>`))
    assert.match(styles, /\.load-error\[hidden\]\s*\{\s*display:\s*none;/)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('static marketplace accepts a domestic origin and renders the ICP record', async () => {
  const output = await mkdtemp(new URL('.tmp-marketplace-domestic-', root))
  const icp = '鄂ICP备2026010180号-2'
  try {
    await execFileAsync(process.execPath, [
      new URL('scripts/build-marketplace-static.mjs', root).pathname,
      '--out', relative(rootPath, output),
      '--source-sha', 'domestic-test-sha',
      '--site-origin', 'https://dsh-store.cn',
      '--alternate-origin', 'https://dsh.store',
      '--icp', icp,
    ], { cwd: rootPath })

    const pagePaths = [
      'marketplace/index.html',
      'marketplace/plugins/index.html',
      'marketplace/build/index.html',
      'marketplace/faq/index.html',
      'marketplace/about/index.html',
      'marketplace/dsh-plugins/index.html',
    ]
    for (const pagePath of pagePaths) {
      const page = await readFile(join(output, pagePath), 'utf8')
      assert.match(page, /https:\/\/dsh-store\.cn/)
      assert.match(page, new RegExp(icp))
      assert.match(page, /<html lang="zh-CN" data-default-locale="zh">/)
      assert.match(page, /class="site-switch-link"[^>]*href="https:\/\/dsh\.store\/"/)
    }
    const robots = await readFile(join(output, 'marketplace/robots.txt'), 'utf8')
    const sitemap = await readFile(join(output, 'marketplace/sitemap.xml'), 'utf8')
    const manifest = JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8'))
    assert.match(robots, /Sitemap: https:\/\/dsh-store\.cn\/sitemap\.xml/)
    assert.match(sitemap, /https:\/\/dsh-store\.cn\//)
    assert.match(sitemap, /https:\/\/dsh-store\.cn\/dsh-plugins\//)
    assert.doesNotMatch(sitemap, /https:\/\/dsh\.store/)
    assert.equal(manifest.siteOrigin, 'https://dsh-store.cn')
    assert.equal(manifest.alternateOrigin, 'https://dsh.store')
    assert.equal(manifest.icp, icp)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
