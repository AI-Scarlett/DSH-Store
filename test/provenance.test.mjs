import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readMarketplaceProvenance } from '../src/provenance.mjs'

test('provenance derives marketplace-managed installs from successful audit events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-provenance-'))
  try {
    const dir = join(root, 'dsh-safe-plugin-manager')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'history.jsonl'), [
      JSON.stringify({ status: 'applied', action: 'install', profile: 'web', packageName: 'one' }),
      JSON.stringify({ status: 'rolled-back', action: 'install', profile: 'web', packageName: 'two' }),
      JSON.stringify({ status: 'applied', action: 'uninstall', profile: 'web', packageName: 'one' }),
      JSON.stringify({ status: 'applied', action: 'update', profile: 'web', packageName: 'three' }),
      JSON.stringify({ status: 'applied', action: 'migrate', profile: 'web', packageName: 'four' }),
      'not-json',
    ].join('\n'))
    assert.deepEqual([...await readMarketplaceProvenance(root, 'web')], ['three', 'four'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
