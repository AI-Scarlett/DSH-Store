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
