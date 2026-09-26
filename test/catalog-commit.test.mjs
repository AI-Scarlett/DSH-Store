import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectChanges, expectedTree, mutationInput, createVerifiedCommit } from '../scripts/create-catalog-commit.mjs'

const base = 'a'.repeat(40)
const tree = 'b'.repeat(40)
const head = 'c'.repeat(40)
const plan = { repository: 'AI-Scarlett/DSH-Store', branch: 'automation/catalog-123-1', base, expectedTree: tree, changes: [{ path: 'registry/catalog.json', contents: Buffer.from('{}\n') }] }
function fixture() {
  const state = { main: base, head: base, calls: 0, waits: 0, signed: true, tree, parent: base }
  const io = {
    getMain: async () => state.main,
    getBranch: async () => state.head,
    getCommit: async sha => ({ sha, parents: [{ sha: state.parent }], commit: { tree: { sha: state.tree }, verification: { verified: state.signed } } }),
    createCommit: async () => { state.calls++; state.head = head; return head },
    delay: async () => { state.waits++ },
  }
  return { state, io }
}
const transient = () => Object.assign(new Error('HTTP 502'), { transient: true })

test('a signed exact commit is required and accepted after a successful mutation', async () => {
  const { state, io } = fixture()
  assert.equal(await createVerifiedCommit(plan, io), head)
  assert.equal(state.calls, 1)
})

test('lost 502 response after server commit is recovered without replaying the write', async () => {
  const { state, io } = fixture()
  io.createCommit = async () => { state.calls++; state.head = head; throw transient() }
  assert.equal(await createVerifiedCommit(plan, io), head)
  assert.equal(state.calls, 1)
  assert.equal(state.waits, 0)
})

test('502 before commit retries only after readback proves the branch is unchanged', async () => {
  const { state, io } = fixture()
  io.createCommit = async () => { if (++state.calls === 1) throw transient(); state.head = head; return head }
  assert.equal(await createVerifiedCommit(plan, io), head)
  assert.equal(state.calls, 2)
  assert.equal(state.waits, 1)
})

test('repeated transient failures exhaust a bounded attempt count', async () => {
  const { state, io } = fixture()
  io.createCommit = async () => { state.calls++; throw transient() }
  await assert.rejects(createVerifiedCommit(plan, io, 3), /not verified/)
  assert.equal(state.calls, 3)
})

test('permission and validation failures are not retried', async () => {
  const { state, io } = fixture()
  io.createCommit = async () => { state.calls++; throw new Error('denied') }
  await assert.rejects(createVerifiedCommit(plan, io), /not verified/)
  assert.equal(state.calls, 1)
})

test('unavailable readback never permits another mutation', async () => {
  const { state, io } = fixture()
  io.createCommit = async () => { state.calls++; throw transient() }
  io.getBranch = async () => { if (state.calls) throw new Error('readback unavailable'); return base }
  await assert.rejects(createVerifiedCommit(plan, io), /readback unavailable/)
  assert.equal(state.calls, 1)
})

test('main drift before creation or after an uncertain response stops the stale plan', async () => {
  for (const after of [false, true]) {
    const { state, io } = fixture()
    if (after) io.createCommit = async () => { state.calls++; state.main = head; throw transient() }
    else state.main = head
    await assert.rejects(createVerifiedCommit(plan, io), /main changed/)
    assert.equal(state.calls, after ? 1 : 0)
  }
})

test('recovery refuses unsigned commits, different trees and unexpected parents', async () => {
  for (const change of [{ signed: false }, { tree: base }, { parent: head }]) {
    const { state, io } = fixture()
    Object.assign(state, change, { head })
    await assert.rejects(createVerifiedCommit(plan, io), /planned signed commit/)
    assert.equal(state.calls, 0)
  }
})

test('a previously verified branch result can be resumed without creating duplicates', async () => {
  const { state, io } = fixture(); state.head = head
  assert.equal(await createVerifiedCommit(plan, io), head)
  assert.equal(state.calls, 0)
})

test('mutation response and actual branch must agree', async () => {
  const { state, io } = fixture()
  io.createCommit = async () => { state.head = head; return tree }
  await assert.rejects(createVerifiedCommit(plan, io), /disagree/)
})

test('payload contains only explicit additions and deletions, with strict paths and bounds', () => {
  const changes = [...plan.changes, { path: 'registry/catalog/details/removed-plugin.json', contents: null }]
  const input = mutationInput({ ...plan, changes })
  assert.equal(input.expectedHeadOid, base)
  assert.equal(input.fileChanges.additions.length, 1)
  assert.deepEqual(input.fileChanges.deletions, [{ path: changes[1].path }])
  for (const path of ['registry/automation-policy.json', '../catalog.json', 'registry/catalog/details/../secret.json', '.github/workflows/pages.yml']) {
    assert.throws(() => mutationInput({ ...plan, changes: [{ path, contents: Buffer.from('{}') }] }), /Unsafe/)
  }
  assert.throws(() => mutationInput({ ...plan, changes: [...plan.changes, ...plan.changes] }), /duplicate/)
  assert.throws(() => mutationInput({ ...plan, changes: [] }), /count/)
  assert.throws(() => mutationInput({ ...plan, changes: [{ ...plan.changes[0], contents: Buffer.alloc(8 * 1024 * 1024 + 1) }] }), /bounds/)
})

test('Git change collection preserves unrelated files and real index while covering added and deleted details', async () => {
  const prior = process.cwd()
  const root = await mkdtemp(join(tmpdir(), 'catalog-commit-test-'))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  try {
    await mkdir(join(root, 'registry/catalog/details'), { recursive: true })
    await writeFile(join(root, 'registry/catalog.json'), '{}\n')
    await writeFile(join(root, 'registry/catalog/details/old.json'), '{}\n')
    await writeFile(join(root, 'unrelated.txt'), 'retain\n')
    git(['init', '-q']); git(['add', '.'])
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
    const base = git(['rev-parse', 'HEAD'])
    const indexBefore = await readFile(join(root, '.git/index'))
    await writeFile(join(root, 'registry/catalog.json'), '{"updated":true}\n')
    await rm(join(root, 'registry/catalog/details/old.json'))
    await writeFile(join(root, 'registry/catalog/details/new.json'), '{"new":true}\n')
    await writeFile(join(root, 'unrelated.txt'), 'uncommitted and excluded\n')
    process.chdir(root)
    const changes = await collectChanges(base)
    assert.deepEqual(changes.map(change => change.path), ['registry/catalog.json', 'registry/catalog/details/new.json', 'registry/catalog/details/old.json'])
    const tree = await expectedTree(base, changes)
    assert.equal(git(['show', `${tree}:unrelated.txt`]), 'retain')
    assert.equal(git(['show', `${tree}:registry/catalog/details/new.json`]), '{"new":true}')
    assert.deepEqual(await readFile(join(root, '.git/index')), indexBefore)
    git(['add', 'registry/'])
    assert.equal(git(['write-tree']), tree)
    await writeFile(join(root, 'registry/automation-policy.json'), '{}')
    await assert.rejects(collectChanges(base), /outside the allowed/)
  } finally { process.chdir(prior); await rm(root, { recursive: true, force: true }) }
})
