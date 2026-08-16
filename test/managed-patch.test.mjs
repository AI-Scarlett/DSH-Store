import assert from 'node:assert/strict'
import test from 'node:test'
import { readManagedDisabledIds, setManagedDisabled } from '../src/managed-patch.mjs'

test('managed block turns an empty patch into a disable and restores it', () => {
  const disabled = setManagedDisabled('[]\n', ['demo'], true)
  assert.deepEqual(readManagedDisabledIds(disabled), ['demo'])
  assert.match(disabled, /base-empty/)
  assert.equal(setManagedDisabled(disabled, ['demo'], false), '[]\n')
})

test('managed block preserves external sequence bytes', () => {
  const original = '# user content\n- insert:\n    - id: custom\n      name: custom\n'
  const disabled = setManagedDisabled(original, ['demo-b', 'demo-a'], true)
  assert.ok(disabled.startsWith(original))
  assert.deepEqual(readManagedDisabledIds(disabled), ['demo-a', 'demo-b'])
  assert.equal(setManagedDisabled(disabled, ['demo-a', 'demo-b'], false), original)
})

test('managed block fails closed on malformed markers or unsupported YAML shape', () => {
  assert.throws(() => readManagedDisabledIds('# dsh-safe-plugin-manager:start\n'), /malformed/)
  assert.throws(() => setManagedDisabled('name: value\n', ['demo'], true), /top-level YAML sequence/)
})
