import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolveDshUpgradeMatrix } from '../scripts/resolve-dsh-upgrade-matrix.mjs'

test('upgrade matrix uses the exact ordered official latest-three release window', async () => {
  const result = await resolveDshUpgradeMatrix(async options => {
    assert.equal(options.releaseCount, 3)
    return {
      authority: 'official-github-releases-and-npm-published-versions',
      releaseCount: 3,
      latestVersion: '0.1.7-rc.1',
      releases: ['0.1.7-alpha.1', '0.1.7-alpha.2', '0.1.7-rc.1'],
    }
  })
  assert.deepEqual(result, {
    latestVersion: '0.1.7-rc.1',
    releases: ['0.1.7-alpha.1', '0.1.7-alpha.2', '0.1.7-rc.1'],
    previousReleases: ['0.1.7-alpha.1', '0.1.7-alpha.2'],
  })
})

test('upgrade matrix fails closed on incomplete or unordered official release evidence', async () => {
  await assert.rejects(
    resolveDshUpgradeMatrix(async () => ({
      authority: 'official-github-releases-and-npm-published-versions',
      releaseCount: 3,
      latestVersion: '0.1.7-rc.1',
      releases: ['0.1.7-alpha.1', '0.1.7-rc.1'],
    })),
    /complete ordered latest-three window/,
  )
  await assert.rejects(
    resolveDshUpgradeMatrix(async () => ({
      authority: 'untrusted',
      releaseCount: 3,
      latestVersion: '0.1.7-alpha.2',
      releases: ['0.1.7-alpha.1', '0.1.7-alpha.2', '0.1.7-rc.1'],
    })),
    /complete ordered latest-three window/,
  )
})

test('runtime workflow has one timeout and keeps the expensive disposable smoke bounded', async () => {
  const workflow = await readFile(new URL('../.github/workflows/upgrade-matrix.yml', import.meta.url), 'utf8')
  const runtime = workflow.split('\n  runtime:\n')[1]?.split('\n  previous-latest-three:\n')[0]
  assert.ok(runtime)
  assert.equal(runtime.match(/^\s+timeout-minutes:/gm)?.length, 1)
  assert.match(runtime, /timeout-minutes: 20/)
  assert.equal(workflow.match(/DSH_TEST_PLUGIN_SPEC: github:AI-Scarlett\/DSH-Store#/g)?.length, 2)
})
