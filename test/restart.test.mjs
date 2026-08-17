import assert from 'node:assert/strict'
import test from 'node:test'
import { createRestartService } from '../src/restart.mjs'
import { createRuntimeStatus, restartCommand } from '../src/runtime.mjs'

test('runtime status exposes a stable boot id and profile-specific fallback command', () => {
  const status = createRuntimeStatus({ profile: 'web', bootId: 'boot-one', startedAt: '2026-08-17T00:00:00Z' })
  assert.equal(status.bootId, 'boot-one')
  assert.deepEqual(status.restartCommand, ['dsh', 'web'])
  assert.equal(status.restartCommandText, 'dsh web')
  assert.deepEqual(restartCommand('tui'), ['dsh', '--profile', 'tui'])
  assert.equal(status.restartSupported, true)
  assert.equal(status.restartMode, 'external-guardian')
})

test('restart requires a single-use exact plan and delegates to the external guardian', async () => {
  const calls = []
  let scheduled = null
  const service = createRestartService({
    runtimeStatus: createRuntimeStatus({ profile: 'web', bootId: 'boot-one' }),
    guardianService: {
      status: async () => ({ available: true, state: 'healthy', heartbeatAt: '2026-08-17T00:00:00Z' }),
      requestRestart: async value => { calls.push(['guardian', value]); return { requestId: 'request-one' } },
    },
    schedule: callback => { scheduled = callback },
    terminate: () => calls.push(['terminate']),
  })
  const rejected = await service.createPlan()
  await assert.rejects(service.execute({ planId: rejected.planId, confirmation: 'wrong' }), error => error.code === 'RESTART_CONFIRMATION_MISMATCH')
  await assert.rejects(service.execute({ planId: rejected.planId, confirmation: rejected.confirmation }), error => error.code === 'RESTART_PLAN_NOT_FOUND')
  const plan = await service.createPlan()
  assert.equal(plan.confirmation, 'RESTART DSH web')
  assert.equal(plan.impact.fallbackCommandText, 'dsh web')
  const result = await service.execute({ planId: plan.planId, confirmation: plan.confirmation })
  assert.equal(result.status, 'restart-scheduled')
  assert.equal(result.guardianRequestId, 'request-one')
  assert.equal(calls[0][0], 'guardian')
  assert.equal(typeof scheduled, 'function')
  scheduled()
  assert.deepEqual(calls.at(-1), ['terminate'])
})
