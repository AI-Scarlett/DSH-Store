import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compareCatalogEntries, validateCatalog } from '../src/catalog.mjs'
import { validateCandidateRegistry } from '../src/candidates.mjs'

const DISCOVERY = 'blue-whale-fixed-ee0f3167f213144680f1b80be8cd30fe6353c8aa'
const REVIEW_METHOD = 'github-fixed-commit-static-contract-review'

test('Blue Whale review keeps fixed-source admissions separate from rejected candidates', async () => {
  const catalogSource = JSON.parse(await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8'))
  const candidateSource = JSON.parse(await readFile(new URL('../registry/candidates.json', import.meta.url), 'utf8'))
  const catalog = validateCatalog(catalogSource)
  const candidates = validateCandidateRegistry(candidateSource)
  const admitted = catalog.entries.filter(entry => entry.assurance.discovery.method === REVIEW_METHOD)
  const rejected = candidates.entries.filter(entry => entry.discoverySources.includes(DISCOVERY))

  assert.equal(new Set(catalog.entries.map(entry => entry.id)).size, catalog.entries.length)
  assert.equal(new Set(candidates.entries.map(entry => entry.id)).size, candidates.entries.length)
  assert.equal(admitted.length, 146)
  assert.equal(new Set(admitted.map(entry => entry.repositoryUrl.toLowerCase())).size, 138)
  assert.equal(rejected.length, 1255)
  assert.ok(admitted.every(entry => entry.status === 'approved'))
  assert.ok(admitted.every(entry => entry.updatePolicy === 'user-reviewed'))
  assert.ok(admitted.every(entry => entry.details.reviewStatus === 'automated-scan'))
  assert.ok(admitted.every(entry => entry.assurance.installability.status === 'unknown'))
  assert.ok(admitted.every(entry => entry.assurance.runtime.status === 'unknown'))
  assert.ok(admitted.every(entry => entry.assurance.securityReview.status === 'unknown'))
  assert.ok(rejected.every(entry => entry.status === 'rejected'))
  assert.ok(rejected.every(entry => entry.installable === false))
  assert.ok(rejected.every(entry => entry.allowedActions.length === 0))

  const admittedRepositories = new Set(admitted.map(entry => entry.repositoryUrl.toLowerCase()))
  assert.ok(rejected.every(entry => !admittedRepositories.has(entry.repositoryUrl.toLowerCase())))

  const sorted = [...catalog.entries].sort(compareCatalogEntries).map(entry => entry.id)
  assert.deepEqual(catalogSource.entries.map(entry => entry.id), sorted)
  const compatibilityCounts = Object.fromEntries(['compatible', 'unknown', 'incompatible'].map(status => [
      status,
      catalog.entries.filter(entry => entry.compatibility.dshReleases['0.1.1-rc.1'] === status).length,
    ]))
  assert.ok(compatibilityCounts.compatible >= 275)
  assert.ok(compatibilityCounts.unknown >= 117)
  assert.ok(compatibilityCounts.incompatible >= 9)
  assert.equal(
    Object.values(compatibilityCounts).reduce((sum, count) => sum + count, 0),
    catalog.entries.filter(entry => entry.compatibility.dshReleases['0.1.1-rc.1']).length,
  )

  for (const repository of [
    'https://github.com/agentic-control-plane/dsh-acp-plugin',
    'https://github.com/evanfang0054/dsh-tailscale-console',
    'https://github.com/HongzhongL/dsh-hotswap',
  ]) {
    assert.equal(catalog.entries.some(entry => entry.repositoryUrl.toLowerCase() === repository.toLowerCase()), false)
    const decision = candidates.entries.find(entry => entry.repositoryUrl.toLowerCase() === repository.toLowerCase())
    assert.ok(decision)
    assert.equal(decision.status, 'rejected')
    assert.equal(decision.route, 'blocked')
  }

  const wecom = catalog.entries.find(entry => entry.id === 'dsh-wecom-cli')
  assert.equal(wecom?.status, 'unlisted')
})
