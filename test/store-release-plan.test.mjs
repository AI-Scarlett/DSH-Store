import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { planPath, validateStoreRelease } from '../scripts/verify-store-release-plan.mjs'

test('Store release gate rejects scope, source and output drift before Catalog publication', () => {
  const plan = JSON.parse(readFileSync(new URL(`../${planPath}`, import.meta.url)))
  const show = (commit, path) => { try { return execFileSync('git', ['show', `${commit}:${path}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 24 * 1024 * 1024 }) } catch { return null } }
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url))
  const run = (paths, source = path => show(plan.sourceCommit, path), current = read) => validateStoreRelease(plan, paths, path => show(plan.baseCommit, path), current, source)
  assert.throws(() => run(['registry/other.json']), /Outside/)
  assert.throws(() => run([], () => Buffer.from('changed')), /Fixed source/)
  assert.throws(() => run([], undefined, path => path === 'registry/catalog.json' ? Buffer.from('changed') : read(path)), /Reviewed content/)
})
