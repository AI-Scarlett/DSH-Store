import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { curatedRankingEntries } from '../marketplace/rankings/model.js'
import { writeRankingReleaseFixture } from './fixtures/ranking-release.mjs'

const root = new URL('../', import.meta.url)
const rootPath = fileURLToPath(root)

test('ranking curation APIs authenticate admins, verify local releases, and persist private revisioned choices', async () => {
  const directory = await mkdtemp(new URL('.tmp-ranking-curation-', root))
  const releaseDirectory = join(directory, 'release')
  const stateDirectory = join(directory, 'state')
  await mkdir(stateDirectory, { mode: 0o700 })
  const curationPath = join(stateDirectory, 'ranking-curation.json')
  const settingsPath = join(directory, 'model-settings.json')
  const keyPath = join(directory, 'model-settings.key')
  const sourceCommit = 'c'.repeat(40)
  const fixture = await writeRankingReleaseFixture(releaseDirectory, { sourceCommit })
  const port = 49152 + Math.floor(Math.random() * 5000)
  const child = spawn(process.execPath, ['scripts/serve-marketplace.mjs'], {
    cwd: rootPath,
    env: {
      ...process.env,
      DSH_MARKETPLACE_PORT: String(port),
      DSH_STORE_RELEASE_DIR: releaseDirectory,
      DSH_RANKING_CURATION_PATH: curationPath,
      MODEL_SETTINGS_CONFIG_PATH: settingsPath,
      MODEL_SETTINGS_KEY_PATH: keyPath,
      DSH_ADMIN_USERNAME: 'admin',
      DSH_ADMIN_PASSWORD: 'ranking-fixture-password',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', data => {
        if (data.toString().includes('DSH plugin marketplace:')) resolve()
      })
      child.stderr.on('data', data => {
        const message = data.toString()
        if (message.includes('Error [ERR_MODULE_NOT_FOUND]')) reject(new Error(message))
      })
      child.on('error', reject)
      child.on('exit', code => reject(new Error(`Server exited before startup (${code})`)))
      setTimeout(() => reject(new Error('Server failed to start within 5s')), 5000)
    })
    const baseUrl = `http://127.0.0.1:${port}`
    const unauthenticated = await fetch(`${baseUrl}/api/admin/rankings`)
    assert.equal(unauthenticated.status, 401)

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'ranking-fixture-password' }),
    })
    assert.equal(login.status, 200)
    const { token } = await login.json()
    const headers = { 'x-admin-token': token }

    const initialResponse = await fetch(`${baseUrl}/api/admin/rankings`, { headers })
    assert.equal(initialResponse.status, 200)
    const initial = await initialResponse.json()
    assert.equal(initial.revision, 0)
    assert.equal(initial.sourceCommit, sourceCommit)
    for (const type of ['recommended', 'essential']) {
      assert.ok(initial.choices[type].entries.length > 0)
      assert.equal(initial.choices[type].entries.some(entry => ['blocked-plugin', 'rejected-plugin'].includes(entry.id)), false)
    }

    const unknownId = await fetch(`${baseUrl}/api/admin/rankings`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: 0, sourceCommit,
        boards: { recommended: { mode: 'manual', ids: ['not-in-the-ranking'] }, essential: { mode: 'auto', ids: [] } },
      }),
    })
    assert.equal(unknownId.status, 400)

    const boards = {}
    for (const type of ['recommended', 'essential']) {
      const choices = initial.choices[type]
      const selectable = choices.entries.filter(entry => !entry.officialToolPick)
      boards[type] = {
        mode: 'manual',
        ids: selectable.slice(0, choices.minimumManualEntries).map(entry => entry.id).reverse(),
      }
    }
    const submission = JSON.stringify({ revision: 0, sourceCommit, boards })
    const concurrentSaves = await Promise.all([1, 2].map(() => fetch(`${baseUrl}/api/admin/rankings`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: submission,
    })))
    assert.deepEqual(concurrentSaves.map(response => response.status).sort(), [200, 409])
    const saved = await concurrentSaves.find(response => response.status === 200).json()
    assert.equal(saved.revision, 1)
    assert.deepEqual(saved.boards, boards)

    const publicResponse = await fetch(`${baseUrl}/api/rankings/curation`)
    assert.equal(publicResponse.status, 200)
    const publicData = await publicResponse.json()
    assert.deepEqual(Object.keys(publicData).sort(), ['boards', 'ok', 'sourceCommit'])
    assert.equal(publicData.sourceCommit, sourceCommit)
    assert.deepEqual(publicData.boards, boards)
    assert.equal(JSON.stringify(publicData).includes('candidate'), false)
    const serverRenderedHtml = fixture.htmlBytes.toString('utf8').replace(
      '<!-- DSH_SERVER_ARTICLES_NAV -->',
      '<a href="../articles/" data-i18n="nav.articles">DSH Field Notes</a>',
    )
    await writeFile(join(releaseDirectory, 'marketplace/rankings/index.html'), serverRenderedHtml)
    assert.equal((await fetch(`${baseUrl}/api/rankings/curation`)).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/admin/rankings`, { headers })).status, 200)
    await writeFile(join(releaseDirectory, 'marketplace/rankings/index.html'), fixture.htmlBytes)
    for (const type of ['recommended', 'essential']) {
      const result = curatedRankingEntries(fixture.snapshot, type, publicData)
      const official = initial.choices[type].officialSlots
      for (const slot of official) assert.equal(result[slot.index]?.id, slot.id)
      assert.deepEqual(result.filter(entry => !entry.officialToolPick).map(entry => entry.id), boards[type].ids)
    }

    const persisted = JSON.parse(await readFile(curationPath, 'utf8'))
    assert.equal(persisted.revision, 1)
    assert.equal(JSON.stringify(persisted).includes('ranking-fixture-password'), false)
    assert.equal((await stat(stateDirectory)).mode & 0o777, 0o700)
    assert.equal((await stat(curationPath)).mode & 0o777, 0o600)

    const staleRevision = await fetch(`${baseUrl}/api/admin/rankings`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 0, sourceCommit, boards }),
    })
    assert.equal(staleRevision.status, 409)

    const nextBoards = { recommended: { mode: 'auto', ids: [] }, essential: boards.essential }
    const secondSave = await fetch(`${baseUrl}/api/admin/rankings`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 1, sourceCommit, boards: nextBoards }),
    })
    assert.equal(secondSave.status, 200)
    assert.equal((await secondSave.json()).revision, 2)
    assert.equal(JSON.parse(await readFile(`${curationPath}.bak`, 'utf8')).revision, 1)
    assert.equal((await stat(`${curationPath}.bak`)).mode & 0o777, 0o600)

    await writeFile(join(releaseDirectory, 'marketplace/rankings/index.html'), Buffer.concat([fixture.htmlBytes, Buffer.from('tampered')]))
    assert.equal((await fetch(`${baseUrl}/api/admin/rankings`, { headers })).status, 503)
    assert.equal((await fetch(`${baseUrl}/api/rankings/curation`)).status, 503)

    await writeFile(join(releaseDirectory, 'marketplace/rankings/index.html'), fixture.htmlBytes)
    await writeFile(curationPath, '{malformed', { mode: 0o600 })
    assert.equal((await fetch(`${baseUrl}/api/admin/rankings`, { headers })).status, 503)
    assert.equal((await fetch(`${baseUrl}/api/rankings/curation`)).status, 503)
  } finally {
    child.kill('SIGTERM')
    await rm(directory, { recursive: true, force: true })
  }
})
