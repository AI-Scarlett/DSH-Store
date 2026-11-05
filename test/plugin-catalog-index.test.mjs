import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadVerifiedCatalogRelease, PluginCatalogIndex } from '../src/plugin-catalog-index.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function entry(id, packageName, description, { status = 'approved', commit = 'a'.repeat(40), searchTerms = [] } = {}) {
  return {
    id,
    packageName,
    name: packageName,
    displayName: packageName,
    alias: packageName,
    description,
    searchTerms,
    categories: ['tools'],
    status,
    commit,
  }
}

async function writeRelease(root, name, generatedAt, sourceCommit, entries) {
  const releaseRoot = join(root, 'releases', name)
  await mkdir(join(releaseRoot, 'registry'), { recursive: true })
  const catalogBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, entries }))
  const buildBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    generatedAt,
    sourceCommit,
    siteOrigin: 'https://dsh.store',
  }))
  await writeFile(join(releaseRoot, 'registry/catalog.json'), catalogBytes)
  await writeFile(join(releaseRoot, 'build-manifest.json'), buildBytes)
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    sourceCommit,
    files: {
      'registry/catalog.json': { sha256: digest(catalogBytes), size: catalogBytes.length },
      'build-manifest.json': { sha256: digest(buildBytes), size: buildBytes.length },
    },
  }
  await writeFile(join(releaseRoot, 'release-manifest.json'), JSON.stringify(manifest))
  return { releaseRoot, catalogSha256: digest(catalogBytes) }
}

async function setCurrent(root, releaseRoot) {
  const current = join(root, 'current')
  await unlink(current).catch(() => {})
  await symlink(releaseRoot, current, process.platform === 'win32' ? 'junction' : 'dir')
}

test('SQLite FTS5 sync verifies local release hashes and preserves the last good index on source failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-catalog-'))
  const storeRoot = join(root, 'store')
  const databasePath = join(root, 'data', 'plugin-catalog.sqlite3')
  const firstGeneratedAt = '2026-11-04T01:58:52.000Z'
  const firstCommit = '1'.repeat(40)
  const goodVision = entry('vision-reader', 'dsh-auto-vision', '将图片和截图转换为文字描述，支持视觉理解。', {
    searchTerms: ['读取图片', '识图', 'vision'],
  })
  const englishOnlyVision = entry('image-reader', 'dsh-auto-image', 'Bridges images into text for DeepSeek Harness; a configured vision model describes images.', {
    searchTerms: ['image', 'images', 'vision'],
  })
  const blockedVision = entry('blocked-vision', 'blocked-vision', '图片识别插件', { status: 'blocked' })
  const unpinnedVision = entry('unpinned-vision', 'unpinned-vision', '图片识别插件', { commit: 'main' })
  const first = await writeRelease(storeRoot, 'first', firstGeneratedAt, firstCommit, [goodVision, englishOnlyVision, blockedVision, unpinnedVision])
  const current = join(storeRoot, 'current')
  await setCurrent(storeRoot, first.releaseRoot)
  await loadVerifiedCatalogRelease(current)

  const index = new PluginCatalogIndex({
    databasePath,
    sourceRoots: [current],
    fallbackCatalogPath: join(root, 'missing-catalog.json'),
    requireVerifiedRelease: true,
    refreshIntervalMs: 25,
  })

  try {
    const initial = await index.search('我需要dsh能读取图片 要用什么插件')
    assert.deepEqual(initial.map(item => item.packageName).sort(), ['dsh-auto-image', 'dsh-auto-vision'])
    const firstStatus = await index.status()
    assert.equal(firstStatus.backend, 'sqlite-fts5')
    assert.equal(firstStatus.entryCount, 4)
    assert.equal(firstStatus.sourceCommit, firstCommit)
    assert.equal(firstStatus.catalogSha256, first.catalogSha256)

    if (process.platform !== 'win32') {
      const database = await readFile(databasePath)
      assert.ok(database.length > 0)
      const { mode } = await stat(databasePath)
      assert.equal(mode & 0o777, 0o600)
      const directory = await stat(join(root, 'data'))
      assert.equal(directory.mode & 0o777, 0o700)
    }

    await writeFile(join(first.releaseRoot, 'registry/catalog.json'), JSON.stringify({ entries: [entry('bad', 'bad', 'tampered')] }))
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await index.status()).lastRefreshStatus === 'failed') break
      await pause(15)
    }
    const afterInvalidSource = await index.status()
    assert.equal(afterInvalidSource.lastRefreshStatus, 'failed')
    assert.equal(afterInvalidSource.catalogSha256, first.catalogSha256)
    assert.deepEqual((await index.search('我需要dsh能读取图片 要用什么插件')).map(item => item.packageName).sort(), ['dsh-auto-image', 'dsh-auto-vision'])

    const secondGeneratedAt = '2026-11-05T02:00:00.000Z'
    const secondCommit = '2'.repeat(40)
    const newVision = entry('vision-reader-v2', 'dsh-vision-caption', '从截图读取文字并描述图片内容。', {
      searchTerms: ['图片读取', '截图识别', 'vision'],
    })
    const second = await writeRelease(storeRoot, 'second', secondGeneratedAt, secondCommit, [goodVision, englishOnlyVision, newVision])
    await setCurrent(storeRoot, second.releaseRoot)
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((await index.status()).sourceCommit === secondCommit) break
      await pause(15)
    }
    const secondStatus = await index.status()
    assert.equal(secondStatus.lastRefreshStatus, 'synced')
    assert.equal(secondStatus.sourceCommit, secondCommit)
    assert.equal(secondStatus.catalogSha256, second.catalogSha256)
    assert.deepEqual((await index.search('截图读取图片')).map(item => item.packageName).sort(), ['dsh-auto-image', 'dsh-auto-vision', 'dsh-vision-caption'])
  } finally {
    await index.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('newest verified local release is selected when multiple storefront roots are present', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-catalog-latest-'))
  const olderRoot = join(root, 'older')
  const newerRoot = join(root, 'newer')
  const databasePath = join(root, 'data', 'plugin-catalog.sqlite3')
  const older = await writeRelease(olderRoot, 'older', '2026-11-03T00:00:00.000Z', '3'.repeat(40), [
    entry('old-plugin', 'dsh-old-search', '旧版搜索工具。', { searchTerms: ['旧版'] }),
  ])
  const newer = await writeRelease(newerRoot, 'newer', '2026-11-04T00:00:00.000Z', '4'.repeat(40), [
    entry('new-plugin', 'dsh-current-search', '当前版搜索工具。', { searchTerms: ['当前版'] }),
  ])
  await setCurrent(olderRoot, older.releaseRoot)
  await setCurrent(newerRoot, newer.releaseRoot)
  const index = new PluginCatalogIndex({
    databasePath,
    sourceRoots: [join(olderRoot, 'current'), join(newerRoot, 'current')],
    requireVerifiedRelease: true,
    refreshIntervalMs: 0,
  })
  try {
    const status = await index.status()
    assert.equal(status.sourceCommit, '4'.repeat(40))
    assert.equal(status.catalogSha256, newer.catalogSha256)
    assert.deepEqual((await index.search('当前版搜索')).map(item => item.packageName), ['dsh-current-search'])
  } finally {
    await index.close()
    await rm(root, { recursive: true, force: true })
  }
})
