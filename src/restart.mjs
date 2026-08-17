import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PLAN_TTL_MS = 5 * 60 * 1000

export function createRestartService(options = {}) {
  const runtimeStatus = options.runtimeStatus
  const restartSpec = options.restartSpec
  const helperPath = options.helperPath ?? fileURLToPath(new URL('./restart-helper.mjs', import.meta.url))
  const spawnProcess = options.spawn ?? spawn
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay))
  const terminate = options.terminate ?? (() => process.kill(process.pid, 'SIGTERM'))
  const plans = new Map()

  function createPlan(input = {}) {
    const profile = input.profile ?? runtimeStatus.profile
    if (profile !== runtimeStatus.profile) throw Object.assign(new Error('restart is available only for the running Profile'), { code: 'RESTART_PROFILE_MISMATCH' })
    const planId = randomUUID()
    const createdAt = new Date()
    const plan = {
      schemaVersion: 1, planId, profile, createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + (options.planTtlMs ?? PLAN_TTL_MS)).toISOString(),
      confirmation: `RESTART DSH ${profile}`,
      currentBootId: runtimeStatus.bootId,
      impact: {
        stopsCurrentHost: true,
        startsSameProfile: true,
        modifiesProfile: false,
        fallbackCommand: runtimeStatus.restartCommand,
        fallbackCommandText: runtimeStatus.restartCommandText,
        workingDirectory: runtimeStatus.restartWorkingDirectory,
      },
    }
    plans.set(planId, plan)
    return plan
  }

  function execute(input = {}) {
    const plan = plans.get(input.planId)
    if (!plan) throw Object.assign(new Error('restart plan is missing or already used'), { code: 'RESTART_PLAN_NOT_FOUND' })
    plans.delete(input.planId)
    if (Date.now() > Date.parse(plan.expiresAt)) throw Object.assign(new Error('restart plan expired'), { code: 'RESTART_PLAN_EXPIRED' })
    if (input.confirmation !== plan.confirmation) throw Object.assign(new Error('confirmation text does not match the restart plan'), { code: 'RESTART_CONFIRMATION_MISMATCH' })
    const spec = { ...restartSpec(plan.profile), oldPid: process.pid, host: '127.0.0.1', port: 3080 }
    const encoded = Buffer.from(JSON.stringify(spec)).toString('base64url')
    const helper = spawnProcess(process.execPath, [helperPath, encoded], { detached: true, stdio: 'ignore', shell: false })
    helper.unref()
    schedule(terminate, options.terminateDelayMs ?? 350)
    return {
      schemaVersion: 1, status: 'restart-scheduled', profile: plan.profile,
      previousBootId: runtimeStatus.bootId, helperPid: helper.pid,
      fallbackCommand: runtimeStatus.restartCommand,
      fallbackCommandText: runtimeStatus.restartCommandText,
    }
  }

  return { createPlan, execute }
}
