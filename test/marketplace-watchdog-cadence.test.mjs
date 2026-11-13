import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decideMarketplaceWatchdogRun,
  MARKETPLACE_WATCHDOG_MIN_INTERVAL_MS,
} from '../scripts/marketplace-watchdog-cadence.mjs'

const lastSuccess = Date.parse('2026-11-13T00:00:00.000Z')

test('manual dispatch always performs the full patrol', () => {
  assert.deepEqual(decideMarketplaceWatchdogRun({
    eventName: 'workflow_dispatch',
    lastSuccessfulAt: new Date(lastSuccess).toISOString(),
    now: lastSuccess + 60_000,
  }), { due: true, reason: 'manual-dispatch' })
})

test('scheduled pulse runs when no completed patrol is recorded', () => {
  assert.deepEqual(decideMarketplaceWatchdogRun({
    eventName: 'schedule',
    lastSuccessfulAt: '',
    now: lastSuccess,
  }), { due: true, reason: 'no-successful-patrol' })
})

test('scheduled pulse skips while the last successful patrol is recent', () => {
  assert.deepEqual(decideMarketplaceWatchdogRun({
    eventName: 'schedule',
    lastSuccessfulAt: new Date(lastSuccess).toISOString(),
    now: lastSuccess + MARKETPLACE_WATCHDOG_MIN_INTERVAL_MS - 1,
  }), { due: false, reason: 'recent-success' })
})

test('scheduled pulse runs at the catch-up threshold', () => {
  assert.deepEqual(decideMarketplaceWatchdogRun({
    eventName: 'schedule',
    lastSuccessfulAt: new Date(lastSuccess).toISOString(),
    now: lastSuccess + MARKETPLACE_WATCHDOG_MIN_INTERVAL_MS,
  }), { due: true, reason: 'patrol-due' })
})

test('ambiguous or future patrol timestamps run a verification instead of suppressing it', () => {
  for (const timestamp of ['not-a-date', new Date(lastSuccess + 60_000).toISOString()]) {
    assert.deepEqual(decideMarketplaceWatchdogRun({
      eventName: 'schedule',
      lastSuccessfulAt: timestamp,
      now: lastSuccess,
    }), { due: true, reason: 'patrol-history-unknown' })
  }
})
