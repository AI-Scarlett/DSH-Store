import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validateCatalogRepairPlan } from '../scripts/verify-catalog-repair-plan.mjs'

test('Catalog repair binds exact source scope and pre/post hashes without permitting new credentials or file paths', () => {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  const base = Buffer.from('base'), current = Buffer.from('reviewed')
  const plan = { schemaVersion: 1, operation: 'catalog-workflow-repair', baseCommit: 'a'.repeat(40), createdAt: '2026-10-17T00:00:00Z', scope: ['src/catalog.mjs'], preconditions: { 'src/catalog.mjs': hash(base) }, postconditions: { 'src/catalog.mjs': hash(current) }, authorization: { source: 'direct-user-request', githubWriteCredential: 'short-lived-token-required' } }
  const run = (p = plan, changed = plan.scope, before = base, after = current) => validateCatalogRepairPlan(p, changed, () => before, () => after)
  run()
  assert.throws(() => run(plan, ['registry/catalog.json']), /outside/)
  assert.throws(() => run(plan, undefined, Buffer.from('drift')), /base hash/)
  assert.throws(() => run(plan, undefined, base, Buffer.from('drift')), /reviewed content/)
  assert.throws(() => run({ ...plan, postconditions: {} }), /missing reviewed/)
  assert.throws(() => run({ ...plan, authorization: { ...plan.authorization, githubWriteCredential: 'unknown' } }), /invalid/)
})
