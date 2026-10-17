import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { validateUpgradePlan } from '../scripts/verify-dsh-upgrade-plan.mjs'

test('upgrade authorization binds exact base, file scope and reviewed output', () => {
  const hash = text => createHash('sha256').update(text).digest('hex')
  const plan = { schemaVersion: 1, type: 'dsh-native-market-upgrade', baseCommit: 'a'.repeat(40), scope: ['src/demo.mjs'],
    preconditions: { 'src/demo.mjs': hash('before') }, postconditions: { 'src/demo.mjs': hash('after') },
    authorization: { source: 'direct-user-request', githubWriteCredential: 'existing-credential-explicitly-authorized', credentialExceptionRequest: '你直接上线啊 不要用短期的' } }
  const check = (p = plan, paths = ['src/demo.mjs'], base = 'before', current = 'after') => validateUpgradePlan(p, paths, () => Buffer.from(base), () => Buffer.from(current))
  check()
  check({ ...plan, authorization: { source: 'direct-user-request', githubWriteCredential: 'short-lived-token-required' } })
  assert.throws(() => check(plan, ['outside.mjs']), /Outside/)
  assert.throws(() => check(plan, undefined, 'drift'), /Base hash/)
  assert.throws(() => check(plan, undefined, undefined, 'drift'), /Reviewed content/)
  assert.throws(() => check({ ...plan, authorization: {} }), /Invalid/)
})
