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
    const pluginRecord = await readFile(join(output, 'marketplace/plugins', manager.id, 'index.html'), 'utf8')
    const englishHome = await readFile(join(output, 'marketplace/en/index.html'), 'utf8')
    const englishCatalog = await readFile(join(output, 'marketplace/en/plugins/index.html'), 'utf8')
    const sitemap = await readFile(join(output, 'marketplace/sitemap.xml'), 'utf8')
    const styles = await readFile(join(output, 'marketplace/styles.css'), 'utf8')
    const manifest = JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8'))
    const release = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'))

    assert.equal(manifest.manager.version, manager.version)
    assert.equal(manifest.manager.commit, manager.commit)
    assert.equal(manifest.manager.license, manager.details.license)
    assert.equal(manifest.manager.status, manager.status)
    assert.equal(manifest.sourceCommit, 'test-source-sha')
    assert.equal(manifest.githubEnriched, false)
    assert.equal(release.sourceCommit, 'test-source-sha')
    assert.ok(release.files['marketplace/index.html'])
    assert.ok(release.files['marketplace/plugins/index.html'])
    assert.ok(release.files[`marketplace/plugins/${manager.id}/index.html`])
    assert.ok(release.files['marketplace/en/plugins/index.html'])
    assert.ok(release.files['registry/catalog.json'])
    assert.ok(home.includes(`"softwareVersion": "${manager.version}"`))
    assert.match(home, new RegExp(manager.commit))
    assert.match(home, /id="catalog-snapshot" type="application\/json"/)
    assert.equal((plugins.match(/data-static-plugin-id=/g) || []).length, Math.min(24, catalog.entries.filter(entry => entry.status !== 'unlisted').length))
    assert.match(plugins, new RegExp(`href="\\./${manager.id}/"`))
    assert.match(plugins, /id="catalog-snapshot" type="application\/json"/)
    assert.match(pluginRecord, new RegExp(`https://dsh\\.store/plugins/${manager.id}/`))
    assert.match(pluginRecord, new RegExp(manager.commit))
    assert.match(pluginRecord, /PUBLIC RECORD BOUNDARY/)
    assert.match(englishHome, /https:\/\/dsh\.store\/en\//)
    assert.match(englishHome, /hreflang="zh-CN"/)
    assert.match(englishCatalog, /data-static-plugin-id=/)
    assert.match(sitemap, /xmlns:xhtml=/)
    assert.equal((sitemap.match(/<loc>https:\/\/dsh\.store\/plugins\/[a-z0-9-]+\/<\/loc>/g) || []).length, catalog.entries.filter(entry => entry.status !== 'unlisted').length)
    assert.match(styles, /\.load-error\[hidden\]\s*\{\s*display:\s*none;/)
    assert.match(styles, /\.plugin-detail-hero/)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
