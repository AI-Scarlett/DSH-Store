#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateManualScanPlan } from '../src/manual-scan-plan.mjs'

const path = process.argv[2]
if (!path || process.argv.length !== 3) throw new Error('Usage: verify-manual-scan-plan.mjs FILE')
const plan = validateManualScanPlan(JSON.parse(await readFile(resolve(path), 'utf8')))
process.stdout.write(`MANUAL_DSH_SCAN_PLAN_OK id=${plan.scan.planId} targets=${plan.scan.targetCount} selected=${plan.selected.length}\n`)
