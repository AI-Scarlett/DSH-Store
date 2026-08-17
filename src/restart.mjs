import { randomUUID } from 'node:crypto'

const PLAN_TTL_MS = 5 * 60 * 1000

export function createRestartService(options = {}) {
  const runtimeStatus = options.runtimeStatus
  const guardianService = options.guardianService
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay))
  const terminate = options.terminate ?? (() => process.kill(process.pid, 'SIGTERM'))
  const plans = new Map()

  async function createPlan(input = {}) {
    const profile = input.profile ?? runtimeStatus.profile
    if (profile !== runtimeStatus.profile) throw Object.assign(new Error('restart is available only for the running Profile'), { code: 'RESTART_PROFILE_MISMATCH' })
    const guardian = await guardianService.status()
    if (!guardian.available) throw Object.assign(new Error('DSH Guardian 未安装或未运行；为避免关闭后无法恢复，已拒绝一键重启。'), { code: guardian.errorCode ?? 'GUARDIAN_UNAVAILABLE' })
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
        guardian: { state: guardian.state, heartbeatAt: guardian.heartbeatAt },
      },
    }
    plans.set(planId, plan)
    return plan
  }

  async function execute(input = {}) {
    const plan = plans.get(input.planId)
    if (!plan) throw Object.assign(new Error('restart plan is missing or already used'), { code: 'RESTART_PLAN_NOT_FOUND' })
    plans.delete(input.planId)
    if (Date.now() > Date.parse(plan.expiresAt)) throw Object.assign(new Error('restart plan expired'), { code: 'RESTART_PLAN_EXPIRED' })
    if (input.confirmation !== plan.confirmation) throw Object.assign(new Error('confirmation text does not match the restart plan'), { code: 'RESTART_CONFIRMATION_MISMATCH' })
    const request = await guardianService.requestRestart({
      profile: plan.profile, oldPid: process.pid, previousBootId: runtimeStatus.bootId,
    })
    schedule(terminate, options.terminateDelayMs ?? 350)
    return {
      schemaVersion: 1, status: 'restart-scheduled', profile: plan.profile,
      previousBootId: runtimeStatus.bootId, guardianRequestId: request.requestId,
      fallbackCommand: runtimeStatus.restartCommand,
      fallbackCommandText: runtimeStatus.restartCommandText,
    }
  }

  return { createPlan, execute }
}
