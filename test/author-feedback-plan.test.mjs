import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validateResolutionPlan, planPath } from '../scripts/verify-author-feedback-plan.mjs'
const hash = s => createHash('sha256').update(s).digest('hex')
const plan = { schemaVersion: 1, type: 'author-feedback-resolution', baseCommit: 'a'.repeat(40),
  scope: [planPath, 'src/demo.mjs'], preconditions: { [planPath]: null, 'src/demo.mjs': hash('before') },
  postconditions: { 'src/demo.mjs': hash('after') }, authorization: { githubWriteCredential: 'short-lived-token-required' } }
const readBase = p => p === planPath ? null : Buffer.from('before')
const readCurrent = () => Buffer.from('after')
test('policy binds base bytes, reviewed output and complete exact scope', () => {
  validateResolutionPlan(plan, [planPath, 'src/demo.mjs'], readBase, readCurrent)
  assert.throws(() => validateResolutionPlan(plan, ['src/other.mjs'], readBase, readCurrent), /outside/)
  assert.throws(() => validateResolutionPlan(plan, ['src/demo.mjs'], () => Buffer.from('drift'), readCurrent), /base/)
  assert.throws(() => validateResolutionPlan(plan, ['src/demo.mjs'], readBase, () => Buffer.from('drift')), /content/)
  assert.throws(() => validateResolutionPlan({ ...plan, postconditions: {} }, ['src/demo.mjs'], readBase, readCurrent), /missing/)
})

test('existing credential exception requires this direct user request and exact publication scope', () => {
  const authorization = { githubWriteCredential: 'existing-credential-explicitly-authorized',
    credentialException: { source: 'direct-user-request', request: '你直接上线啊 不要用短期的', scope: 'this-feedback-publication-only' } }
  const reviewed = { ...plan, authorization }
  validateResolutionPlan(reviewed, [planPath, 'src/demo.mjs'], readBase, readCurrent)
  for (const credentialException of [undefined, { ...authorization.credentialException, scope: 'all-future-writes' },
    { ...authorization.credentialException, request: 'inferred permission' }]) {
    assert.throws(() => validateResolutionPlan({ ...reviewed, authorization: { ...authorization, credentialException } },
      [planPath, 'src/demo.mjs'], readBase, readCurrent), /policy plan/)
  }
})
