import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('backend deployment includes the ranking module dependency in both setup paths', async () => {
  const setup = await readFile(new URL('deploy/setup-model-service.sh', root), 'utf8')
  const service = await readFile(new URL('scripts/serve-marketplace.mjs', root), 'utf8')
  assert.match(setup, /EnvironmentFile=-\/etc\/dsh-store\/model-service\.env/)
  assert.match(setup, /sudoedit \/etc\/dsh-store\/model-service\.env/)
  assert.doesNotMatch(setup, /初始密码/)
  assert.match(service, /from '\.\.\/marketplace\/rankings\/model\.js'/)

  const stagedFiles = [
    'src/author-exclusions.mjs',
    'src/catalog.mjs',
    'src/bundle-patch-contract.mjs',
    'marketplace/rankings/model.js',
    'marketplace/lib/community-recommendations.js',
    'marketplace/lib/server-author-exclusions.js',
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
    ...stagedFiles.filter(path => !path.startsWith('marketplace/')),
  ]) {
    assert.ok(bundledFiles.has(path), `standalone bundle must contain ${path}`)
    const extracted = spawnSync('tar', ['-xzf', '-', '-O', path], { input: archive, encoding: 'buffer' })
    assert.equal(extracted.status, 0, extracted.stderr)
    assert.deepEqual(extracted.stdout, await readFile(new URL(path, root)), `standalone bundle must match ${path}`)
  }

  const rankingPatch = setup.match(/cat << 'RANKING_PATCH_EOF' \| base64 -d \| tar -xz -C "\$SERVICE_DIR"\n([\s\S]*?)\nRANKING_PATCH_EOF/)
  assert.ok(rankingPatch, 'standalone ranking dependency overlay must be present')
  const rankingArchive = Buffer.from(rankingPatch[1].replace(/\s+/g, ''), 'base64')
  const rankingListing = spawnSync('tar', ['-tzf', '-'], { input: rankingArchive, encoding: 'utf8' })
  assert.equal(rankingListing.status, 0, rankingListing.stderr)
  const rankingFiles = new Set(rankingListing.stdout.trim().split('\n'))
  for (const path of [
    'marketplace/rankings/model.js',
    'marketplace/lib/community-recommendations.js',
    'marketplace/lib/server-author-exclusions.js',
  ]) {
    assert.ok(rankingFiles.has(path), `standalone ranking overlay must contain ${path}`)
    const extracted = spawnSync('tar', ['-xzf', '-', '-O', path], { input: rankingArchive, encoding: 'buffer' })
    assert.equal(extracted.status, 0, extracted.stderr)
    assert.deepEqual(extracted.stdout, await readFile(new URL(path, root)), `standalone ranking overlay must match ${path}`)
  }
})
