/Users/zhouxiaoming/.bash_profile: line 16: /Users/zhouxiaoming/.local/bin/env: No such file or directory
import assert from 'node:assert/strict'
import test from 'node:test'
import { validateManualScanPlan } from '../src/manual-scan-plan.mjs'

const digest = 'a'.repeat(64)
const releases = ['0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3']

function planFixture() {
  return {
    schemaVersion: 1,
    type: 'manual-dsh-known-plugin-rescan',
    scan: {
      status: 'complete',
      planId: 'manual-dsh-scan-20261114',
      baseCommit: 'b'.repeat(40),
      sourceUrl: 'https://cdn.dsh.so/plugins-index.json',
      sourceGeneratedAt: '2026-11-14T00:29:40.007Z',
      sourceIndexSha256: digest,
      mainResultsSha256: 'c'.repeat(64),
      supplementalResultsSha256: 'd'.repeat(64),
      officialWindowSha256: 'e'.repeat(64),
      targetCount: 1,
      completedTargetCount: 1,
      outcomes: { eligible: 1 },
      latestDshReleases: releases,
      selectedCount: 1,
    },
    selected: [{
      repositoryUrl: 'https://github.com/example/dsh-plugin',
      commit: 'f'.repeat(40),
      packageName: 'dsh-plugin',
      version: '1.2.3',
      manifestPath: 'package.json',
      entryIds: ['dsh-plugin-entry'],
      outcome: 'eligible',
      scanComplete: true,
      admissionState: 'source-verified',
      sourceBinding: '1'.repeat(64),
      sourceDigest: '2'.repeat(64),
      compatibility: {
        dsh: '>=0.2.2-rc.1',
        dshReleases: {
          '0.2.2-rc.1': 'compatible',
          '0.2.2-rc.2': 'unknown',
          '0.2.2-rc.3': 'unknown',
        },
      },
    }],
  }
}

test('manual scan plans bind a complete scan and immutable eligible sources', () => {
  const validated = validateManualScanPlan(planFixture())
  assert.equal(validated.selected[0].repositoryUrl, 'https://github.com/example/dsh-plugin')
  assert.deepEqual(validated.scan.latestDshReleases, releases)
})

test('manual scan plan rejects incomplete scans, malformed commits, and compatibility outside the scanned window', () => {
  const pending = planFixture()
  pending.scan.outcomes = { eligible: 0, 'pending-transient': 1 }
  assert.throws(() => validateManualScanPlan(pending), /outcome counts must cover all targets with no pending transient result/)

  const mutableCommit = planFixture()
  mutableCommit.selected[0].commit = 'main'
  assert.throws(() => validateManualScanPlan(mutableCommit), /Commit must be full and immutable/)

  const oldCompatibility = planFixture()
  oldCompatibility.selected[0].compatibility.dshReleases = { '0.1.9-rc.1': 'compatible' }
  assert.throws(() => validateManualScanPlan(oldCompatibility), /no compatible result in the scanned official latest-three window/)
})

test('manual scan plan rejects duplicate bundle IDs and noncanonical repositories', () => {
  const duplicate = planFixture()
  duplicate.selected.push({
    ...duplicate.selected[0],
    repositoryUrl: 'https://github.com/other/dsh-plugin',
    commit: '3'.repeat(40),
  })
  duplicate.scan.targetCount = 2
  duplicate.scan.completedTargetCount = 2
  duplicate.scan.outcomes = { eligible: 2 }
  duplicate.scan.selectedCount = 2
  assert.throws(() => validateManualScanPlan(duplicate), /selected Bundle entry ID collision/)

  const noncanonical = planFixture()
  noncanonical.selected[0].repositoryUrl = 'https://github.com/example/dsh-plugin.git'
  assert.throws(() => validateManualScanPlan(noncanonical), /repository must be canonical/)
})
