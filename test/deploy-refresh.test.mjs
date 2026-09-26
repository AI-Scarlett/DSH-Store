import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { catalogBridgeBuffer, loadCatalogFromFiles, splitCatalogDocument } from '../src/catalog.mjs'
import { COMPATIBILITY_HOLD_PREFIX } from '../src/catalog-compatibility-policy.mjs'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))

test('production candidate gate accepts a held manager but rejects an exposed install action',
  { skip: process.platform === 'win32' }, async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-store-refresh-fixture-'))
    try {
      await mkdir(join(fixture, 'scripts'))
      await Promise.all([
        cp(join(root, 'package.json'), join(fixture, 'package.json')),
        cp(join(root, 'src'), join(fixture, 'src'), { recursive: true }),
        cp(join(root, 'marketplace'), join(fixture, 'marketplace'), { recursive: true }),
        cp(join(root, 'registry'), join(fixture, 'registry'), { recursive: true }),
        cp(join(root, 'scripts/build-marketplace-static.mjs'), join(fixture, 'scripts/build-marketplace-static.mjs')),
      ])
      const catalog = await loadCatalogFromFiles()
      const manager = catalog.entries.find(entry => entry.id === 'dsh-safe-plugin-manager')
      assert.ok(manager)
      manager.status = 'unlisted'
      manager.statusReason = `${COMPATIBILITY_HOLD_PREFIX} fixture has no exact compatible result`
      const split = splitCatalogDocument(catalog)
      await Promise.all([
        writeFile(join(fixture, 'registry/catalog.json'), catalogBridgeBuffer(split.bridge)),
        writeFile(join(fixture, 'registry/catalog-index.json'), `${JSON.stringify(split.index, null, 2)}\n`),
        writeFile(join(fixture, 'registry/catalog/details/dsh-safe-plugin-manager.json'), `${JSON.stringify(manager, null, 2)}\n`),
      ])
      await execFileAsync(process.execPath, [join(fixture, 'scripts/build-marketplace-static.mjs'),
        '--out', '_site', '--source-sha', 'a'.repeat(40)], { cwd: fixture })
      const script = await readFile(join(root, 'deploy/refresh-from-pages.sh'), 'utf8')
      const candidateGate = /python3 - "\$candidate" <<'PY'\n([\s\S]*?)\nPY/.exec(script)?.[1]
      assert.ok(candidateGate, 'production candidate validation block must remain present')
      const artifact = join(fixture, '_site')
      const passed = await execFileAsync('python3', ['-c', candidateGate, artifact])
      assert.match(passed.stdout, /DSH_STORE_CANDIDATE_OK .* unlisted MIT/)

      const homePath = join(artifact, 'marketplace/index.html')
      const home = await readFile(homePath, 'utf8')
      const indexBytes = await readFile(join(artifact, 'registry/catalog-index.json'))
      const index = JSON.parse(indexBytes.toString('utf8'))
      const indexSha256 = createHash('sha256').update(indexBytes).digest('hex')
      assert.match(home, new RegExp(`<meta name="dsh-catalog-index-sha256" content="${indexSha256}">`))
      assert.match(home, new RegExp(`<meta name="dsh-catalog-index-bytes" content="${indexBytes.byteLength}">`))
      assert.match(home, new RegExp(`<meta name="dsh-catalog-index-count" content="${index.entries.length}">`))
      assert.equal((home.match(/data-static-home-plugin-id=/g) || []).length, 6, 'homepage must render six catalog previews in static HTML')
      assert.doesNotMatch(home, /home-plugin-placeholder/, 'homepage must not ship empty loading cards')
      const app = await readFile(join(artifact, 'marketplace/app.js'), 'utf8')
      assert.match(app, /new URL\('catalog-index\.json', new URL\(CATALOG_URL, window\.location\.href\)\)\.href/)
      assert.match(app, /Catalog index SHA-256 does not match the build/)
      const homeCss = await readFile(join(artifact, 'marketplace/home-redesign.css'), 'utf8')
      assert.match(homeCss, /body\.home-page \.featured-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
      assert.match(homeCss, /body\.home-page \.featured-card \{[\s\S]*?min-height: 0 !important/)
      assert.match(homeCss, /body\.home-page \.catalog-gateway \{[\s\S]*?min-height: 0 !important/)
      const exposed = home.replace('data-copy-target="install-command" disabled aria-disabled="true"', 'data-copy-target="install-command"')
      assert.notEqual(exposed, home)
      await writeFile(homePath, exposed)
      const releasePath = join(artifact, 'release-manifest.json')
      const release = JSON.parse(await readFile(releasePath, 'utf8'))
      release.files['marketplace/index.html'] = {
        size: Buffer.byteLength(exposed),
        sha256: createHash('sha256').update(exposed).digest('hex'),
      }
      await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`)
      await assert.rejects(execFileAsync('python3', ['-c', candidateGate, artifact]), error => {
        assert.match(error.stderr, /static homepage exposes an unavailable manager install command/)
        return true
      })
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })
