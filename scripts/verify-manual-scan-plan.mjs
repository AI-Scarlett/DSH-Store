#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateManualScanPlan } from '../src/manual-scan-plan.mjs'

const path = process.argv[2]
if (!path || process.argv.length !== 3) throw new Error('Usage: verify-manual-scan-plan.mjs FILE')
const plan = validateManualScanPlan(JSON.parse(await readFile(resolve(path), 'utf8')))
if (plan.type === 'author-requested-catalog-recheck') {
  process.stdout.write(`AUTHOR_CATALOG_RECHECK_PLAN_OK id=${plan.planId} issue=${plan.request.issueNumber} source=${plan.source.commit}\n`)
} else {
  process.stdout.write(`MANUAL_DSH_SCAN_PLAN_OK id=${plan.scan.planId} targets=${plan.scan.targetCount} selected=${plan.selected.length}\n`)
}
