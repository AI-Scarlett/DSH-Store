import test from 'node:test'
import assert from 'node:assert/strict'
import { permissionSignals, permissionSignalReasons } from '../src/automation-source-policy.mjs'

test('Tool views require ownership review without being mislabeled as protected component mutations', () => {
  const keyed = `
    type ImageToolProps = PropsRuntime<'tool.call.toolview'>
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview', key: 'dsh-image-fixture.render',
    }, ImageToolRow))
  `
  const sources = [
    keyed,
    `ctx.slots.register('tool.call.toolview', CatchAllRow)`,
    `ctx.slots.register({ name: 'tool.call.toolview', key: 'official_file_read' }, ToolRow)`,
    `ctx.slots.register({ name: 'tool.call.toolview', key: prefix + name }, ToolRow)`,
    `${keyed}; ctx.slots.register('tool.call.toolview', CatchAllRow)`,
  ]
  for (const source of sources) {
    const signals = permissionSignals(source)
    assert.equal(signals.protectedDsh, false)
    assert.equal(signals.toolViews, true)
    for (const settings of [{}, { toolViews: true }, { toolViews: false }]) {
      assert.deepEqual(permissionSignalReasons(signals, settings), [
        'runtime Tool-view slot use requires manual scope and key-ownership review',
      ])
    }
  }
})

test('a keyed Tool view never hides real protected DSH mutations', () => {
  const keyed = `ctx.slots.register({ name: 'tool.call.toolview', key: 'dsh-image-fixture.render' }, ToolRow)`
  for (const mutation of [
    `window.__ModuleLoader__.remove('@deepseek-ai/dsh-client-ui-tool')`,
    `Fiber.disable('@deepseek-ai/dsh-client-runtime')`,
    `ctx.loader.patch('official-plugin')`,
    `{ name: '@deepseek-ai/dsh-client-ui-tool', disabled: true }`,
  ]) {
    const signals = permissionSignals(`${keyed}; ${mutation}`)
    assert.equal(signals.protectedDsh, true)
    assert.equal(signals.toolViews, true)
    assert.deepEqual(permissionSignalReasons(signals, { protectedDsh: false }), [
      'runtime Tool-view slot use requires manual scope and key-ownership review',
      'runtime source contains the protectedDsh permission signal',
    ])
  }
})

test('Git source cannot pass runtime artifact checks merely because package files names a generated directory', async () => {
  const { missingRuntimeEntryReasons } = await import('../src/automation-source-policy.mjs')
  const manifest = { main: './lib/index.js', files: ['lib'], exports: { '.': './lib/index.js' } }
  const tree = [{ type: 'blob', mode: '100644', path: 'packages/plugin/package.json' }]
  assert.deepEqual(missingRuntimeEntryReasons(manifest, tree, 'packages/plugin/'), ['runtime artifact is missing from the fixed Git Commit: ./lib/index.js'])
  tree.push({ type: 'blob', mode: '100644', path: 'packages/plugin/lib/index.js' })
  assert.deepEqual(missingRuntimeEntryReasons(manifest, tree, 'packages/plugin/'), [])
  tree[1].mode = '120000'
  assert.equal(missingRuntimeEntryReasons(manifest, tree, 'packages/plugin/').length, 1)
})

test('test-named scripts are not scanned as runtime permission signals', async () => {
  const { isTestSourceFile } = await import('../src/automation-source-policy.mjs')
  assert.equal(isTestSourceFile('build-dsh-plugin/scripts/test-marketplace-entry.mjs'), true)
  assert.equal(isTestSourceFile('scripts/test-normalize-brief.mjs'), true)
  assert.equal(isTestSourceFile('src/marketplace.test.mjs'), true)
  assert.equal(isTestSourceFile('scripts/official-dsh-releases.mjs'), false)
  assert.equal(isTestSourceFile('src/index.mjs'), false)
})

test('bounded source lineage accepts direct descendants by default and divergence only when explicitly enabled', async () => {
  const { isBoundedSourceLineage } = await import('../src/automation-source-policy.mjs')
  const ahead = { status: 'ahead', total_commits: 3 }
  const diverged = {
    status: 'diverged', total_commits: 37, ahead_by: 37, behind_by: 4,
    merge_base_commit: { sha: 'a'.repeat(40) },
  }
  assert.equal(isBoundedSourceLineage(ahead, 200), true)
  assert.equal(isBoundedSourceLineage({ ...ahead, total_commits: 201 }, 200), false)
  assert.equal(isBoundedSourceLineage(diverged, 200), false)
  assert.equal(isBoundedSourceLineage(diverged, 200, { allowDiverged: true }), true)
  assert.equal(isBoundedSourceLineage({ ...diverged, behind_by: 164 }, 200, { allowDiverged: true }), false)
  assert.equal(isBoundedSourceLineage({ ...diverged, merge_base_commit: null }, 200, { allowDiverged: true }), false)
  assert.equal(isBoundedSourceLineage({ ...diverged, status: 'identical' }, 200, { allowDiverged: true }), false)
})
