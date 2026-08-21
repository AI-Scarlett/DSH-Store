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
    assert.ok(release.files['registry/catalog.json'])
    assert.ok(home.includes(`"softwareVersion": "${manager.version}"`))
    assert.match(home, new RegExp(manager.commit))
    assert.match(home, /name="dsh-catalog-delivery" content="external-json"/)
    assert.doesNotMatch(home, /id="catalog-snapshot"/)
    assert.equal((plugins.match(/data-static-plugin-id=/g) || []).length, Math.min(24, catalog.entries.filter(entry => entry.status !== 'unlisted').length))
    assert.match(plugins, /name="dsh-catalog-delivery" content="external-json"/)
    assert.doesNotMatch(plugins, /id="catalog-snapshot"/)
    assert.ok(Buffer.byteLength(home) < 300_000, 'home HTML must not embed the complete catalog')
    assert.ok(Buffer.byteLength(plugins) < 500_000, 'directory HTML must contain only the first static page')
    assert.match(styles, /\.load-error\[hidden\]\s*\{\s*display:\s*none;/)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
