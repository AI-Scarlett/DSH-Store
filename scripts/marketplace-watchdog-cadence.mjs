import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const MARKETPLACE_WATCHDOG_MIN_INTERVAL_MS = 150 * 60 * 1000

export function decideMarketplaceWatchdogRun({
  eventName,
  lastSuccessfulAt,
  now = Date.now(),
} = {}) {
  if (eventName !== 'schedule') return { due: true, reason: 'manual-dispatch' }
  if (!lastSuccessfulAt) return { due: true, reason: 'no-successful-patrol' }

  const lastSuccessMs = Date.parse(lastSuccessfulAt)
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(lastSuccessMs) || !Number.isFinite(nowMs) || lastSuccessMs > nowMs) {
    return { due: true, reason: 'patrol-history-unknown' }
  }

  if (nowMs - lastSuccessMs < MARKETPLACE_WATCHDOG_MIN_INTERVAL_MS) {
    return { due: false, reason: 'recent-success' }
  }
  return { due: true, reason: 'patrol-due' }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const decision = decideMarketplaceWatchdogRun({
    eventName: process.env.GITHUB_EVENT_NAME,
    lastSuccessfulAt: process.env.LAST_SUCCESSFUL_WATCHDOG_AT,
  })
  process.stdout.write(`due=${decision.due}\nreason=${decision.reason}\n`)
}
