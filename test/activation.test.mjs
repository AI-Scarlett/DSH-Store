import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyActivation } from '../src/activation.mjs'
const plugin = { installed: true, declaredAsBundle: true, version: '1.0.0', declaredSpecifier: 'fixed' }
const input = { plugin, baseline: plugin, entryIds: ['demo'], rows: [{ id: 'demo', state: 2 }], bootId: 'boot' }
test('activation requires current identity and unambiguous active rows', () => {
  assert.equal(classifyActivation(input).status, 'live')
  assert.equal(classifyActivation({ ...input, plugin: { ...plugin, version: '2.0.0' } }).status, 'restart')
  assert.equal(classifyActivation({ ...input, rows: null }).status, 'unknown')
  assert.equal(classifyActivation({ ...input, rows: [{ id:'demo', state:2 }, { id:'nested:demo', state:2 }] }).status, 'unknown')
  assert.equal(classifyActivation({ ...input, rows: [{ id:'demo', state:3 }] }).status, 'broken')
  assert.equal(classifyActivation({ ...input, rows: [] }).status, 'inert')
  assert.equal(classifyActivation({ ...input, disabledIds: ['demo'] }).status, 'disabled')
  assert.equal(classifyActivation({ ...input, plugin: { ...plugin, installed:false } }).status, 'missing')
})
