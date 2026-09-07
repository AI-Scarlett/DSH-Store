import test from 'node:test'
import assert from 'node:assert/strict'

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
