import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createOperationJournal } from '../src/operation-journal.mjs'
const plan = { profile: 'web', action: 'update', planId: 'plan', preconditions: [], plugin: { packageName: 'fixture', commit: 'a'.repeat(40) } }
test('durable reservation, bounded retention, no replay after a new boot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'store-journal-'))
  try {
    const journal = createOperationJournal({ dshHome: root, bootId: 'first', capacity: 2 })
    const id = randomUUID(); await journal.reserve(plan, id)
    await assert.rejects(journal.reserve(plan, randomUUID()), /OPERATION_RECOVERY_REQUIRED/)
    await journal.update(id, { state: 'running' })
    const successor = createOperationJournal({ dshHome: root, bootId: 'second' })
    assert.equal((await successor.get(id)).state, 'recovery-required')
    await assert.rejects(successor.update(id, { state: 'succeeded' }), /TRANSITION/)
    await journal.update(id, { state: 'rolled-back' })
    await assert.rejects(journal.update(id, { state: 'running' }), /TRANSITION/)
    const two = randomUUID(); await journal.reserve(plan, two); await journal.update(two, { state: 'succeeded' })
    await journal.reserve(plan, randomUUID()); assert.equal((await journal.list()).length, 2)
    await assert.rejects(journal.get('../secret'), /INVALID_OPERATION_ID/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('corrupt journal blocks mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'store-journal-'))
  try {
    const journal = createOperationJournal({ dshHome: root, bootId: 'first' })
    const id = randomUUID(); await journal.reserve(plan, id)
    const path = join(root, 'dsh-safe-plugin-manager', 'operations', `${id}.json`)
    await writeFile(path, JSON.stringify({ schemaVersion: 1, id, bootId: 'first', state: 'running' }))
    await assert.rejects(journal.reserve(plan, randomUUID()), /JOURNAL_INVALID/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
