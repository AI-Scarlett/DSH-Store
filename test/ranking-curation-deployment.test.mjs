import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('backend deployment includes the ranking module dependency in both setup paths', async () => {
  const setup = await readFile(new URL('deploy/setup-model-service.sh', root), 'utf8')
  const service = await readFile(new URL('scripts/serve-marketplace.mjs', root), 'utf8')
  assert.match(service, /from '\.\.\/marketplace\/rankings\/model\.js'/)

  const stagedFiles = [
    'src/author-exclusions.mjs',
    'src/catalog.mjs',
    'src/bundle-patch-contract.mjs',
    'marketplace/rankings/model.js',
    'marketplace/lib/community-recommendations.js',
  ]
  for (const path of stagedFiles) {
    assert.ok(setup.includes(`"$REPO_ROOT/${path}"`), `repository install path must copy ${path}`)
    assert.ok(setup.includes(`test -f "$SERVICE_DIR/${path}"`), `setup must validate staged ${path}`)
  }

  const bundle = setup.match(/cat << 'BUNDLE_EOF' \| base64 -d \| tar -xz -C "\$SERVICE_DIR"\n([\s\S]*?)\nBUNDLE_EOF/)
  assert.ok(bundle, 'standalone setup bundle must be present')
  const archive = Buffer.from(bundle[1].replace(/\s+/g, ''), 'base64')
  const listed = spawnSync('tar', ['-tzf', '-'], {
    input: archive,
    encoding: 'utf8',
  })
  assert.equal(listed.status, 0, listed.stderr)
  const bundledFiles = new Set(listed.stdout.trim().split('\n'))
  for (const path of [
    'package.json',
    'scripts/serve-marketplace.mjs',
    'src/ai-model-settings.mjs',
    'src/ai-recommend.mjs',
    ...stagedFiles,
  ]) {
    assert.ok(bundledFiles.has(path), `standalone bundle must contain ${path}`)
    const extracted = spawnSync('tar', ['-xzf', '-', '-O', path], { input: archive, encoding: 'buffer' })
    assert.equal(extracted.status, 0, extracted.stderr)
    assert.deepEqual(extracted.stdout, await readFile(new URL(path, root)), `standalone bundle must match ${path}`)
  }
})
