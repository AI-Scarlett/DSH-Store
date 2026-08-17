import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectColdStartContract } from '../src/cold-start.mjs'

test('cold-start inspection rejects duplicate entry ids across profile and bundle patches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cold-start-'))
  try {
    const profile = join(root, 'profiles', 'web')
    const plugin = join(root, 'plugin')
    await mkdir(profile, { recursive: true }); await mkdir(plugin)
    await writeFile(join(profile, 'cordis.patch.yml'), '- insert:\n    id: duplicate-id\n    name: local\n')
    await writeFile(join(plugin, 'cordis.patch.yml'), '- insert:\n    id: duplicate-id\n    name: bundle\n')
    await writeFile(join(plugin, 'package.json'), JSON.stringify({ dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    const result = await inspectColdStartContract({
      dshHome: root, profile: 'web', inventory: { plugins: [{ packageName: 'demo', installed: true, manifestPath: join(plugin, 'package.json') }] },
    })
    assert.equal(result.status, 'error')
    assert.equal(result.collisions[0].id, 'duplicate-id')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('cold-start inspection passes unique entry ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cold-start-'))
  try {
    const profile = join(root, 'profiles', 'web'); await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'cordis.patch.yml'), '- insert:\n    id: unique-id\n')
    const result = await inspectColdStartContract({ dshHome: root, profile: 'web', inventory: { plugins: [] } })
    assert.equal(result.status, 'pass')
  } finally { await rm(root, { recursive: true, force: true }) }
})
