import assert from 'node:assert/strict'
import test from 'node:test'
import { diagnoseCommand } from '../src/diagnostics.mjs'
test('pnpm errors retain codes without private stderr', () => {
  const value = diagnoseCommand({ stderr: 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED token=secret-value /Users/private/document.txt\nprivate article contents' })
  assert.equal(value.code, 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')
  assert.ok(!JSON.stringify(value).includes('secret-value')); assert.ok(!JSON.stringify(value).includes('/Users/'))
  assert.equal(value.retryAllowed, false)
})
test('file locks do not request blind automatic retry', () => {
  assert.equal(diagnoseCommand({ stderr: 'EPERM: operation not permitted, rename' }).code, 'WINDOWS_FILE_LOCKED')
  assert.equal(diagnoseCommand({ timedOut: true }).code, 'COMMAND_TIMEOUT')
})
test('a failure without a pnpm code still yields a bounded, redacted reason', () => {
  const raw = 'Error: dsh: cannot resolve profile bundle "dsh-legacy" from the dsh installation or /Users/private/profile\nsecret=must-not-leak'
  const value = diagnoseCommand({ exitCode: 1, stderr: raw })
  assert.equal(value.code, 'DSH_PROFILE_BUNDLE_UNRESOLVED')
  assert.match(value.reason, /dsh-legacy/)
  assert.ok(!JSON.stringify(value).includes('must-not-leak'))
  assert.ok(!JSON.stringify(value).includes('/Users/'))
  assert.ok(!JSON.stringify(value).includes('/private'))
})
test('peer incompatibility without a pnpm code is classified, not left opaque', () => {
  const value = diagnoseCommand({ exitCode: 1, stderr: 'Plugin dsh-resume@0.1.0 is incompatible with dsh 0.2.0-rc.2: peerDependencies {"@deepseek-ai/dsh-llm":"^0.1.7-rc.1"}' })
  assert.equal(value.code, 'DSH_PLUGIN_PEER_INCOMPATIBLE')
  assert.match(value.reason, /0\.2\.0-rc\.2/)
})
test('an unclassified failure never echoes raw command output', () => {
  const value = diagnoseCommand({ exitCode: 1, stderr: 'some totally unknown explosion with token=must-not-leak' })
  assert.equal(value.code, 'COMMAND_FAILED')
  assert.equal(value.reason, null)
  assert.ok(!JSON.stringify(value).includes('must-not-leak'))
})
