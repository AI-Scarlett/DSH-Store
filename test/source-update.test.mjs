import assert from 'node:assert/strict'
import test from 'node:test'
import { createSourceUpdateService, effectivePolicy } from '../src/source-update.mjs'

const catalogCommit = 'a'.repeat(40)
const candidateCommit = 'b'.repeat(40)

function entry(overrides = {}) {
  return {
    id: 'demo', name: 'Demo', packageName: 'dsh-demo', status: 'approved',
    repositoryUrl: 'https://github.com/example/dsh-demo', defaultBranch: 'main', manifestPath: 'package.json', installPath: null,
    commit: catalogCommit, version: '1.0.0', entryIds: ['demo'],
    details: {
      license: 'MIT', permissions: { level: 'low', files: 'none', network: 'none', commands: 'none', credentials: ['none'] },
    },
    risk: { installScripts: [] },
    ...overrides,
  }
}

function response(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

function githubFetch({ patch = '+export const version = 2', commit = candidateCommit } = {}) {
  return async url => {
    const parsedUrl = new URL(url)
    if (url.includes('/commits/main')) return response({ sha: commit })
    if (parsedUrl.hostname === 'raw.githubusercontent.com' && url.endsWith('/package.json')) {
      const version = url.includes(`/${catalogCommit}/`) ? '1.0.0' : '2.0.0'
      return response(JSON.stringify({ name: 'dsh-demo', version, license: 'MIT', main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: {} }))
    }
    if (parsedUrl.hostname === 'raw.githubusercontent.com' && url.endsWith('/cordis.patch.yml')) return response('- id: demo\n')
    if (url.includes('/compare/')) return response({ status: 'ahead', total_commits: 1, files: [{ filename: 'lib/index.js', patch }] })
    throw new Error(`unexpected URL ${url}`)
  }
}

test('low-risk source update resolves to a fixed candidate commit and is reusable only after local verification', async () => {
  const service = createSourceUpdateService({
    fetch: githubFetch(), sourceVerifier: async candidate => ({ status: 'verified', version: candidate.version }), now: () => 10,
  })
  const result = await service.inspect(entry(), { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` })
  assert.equal(result.status, 'update-ready')
  assert.equal(result.policy, 'source-verified')
  assert.equal(result.candidateCommit, candidateCommit)
  assert.equal(result.candidateVersion, '2.0.0')
  assert.equal(service.approvedCandidate(entry(), candidateCommit).commit, candidateCommit)
})

test('higher-risk plugins and new permission signals require Registry review', async () => {
  const highRisk = entry({
    updatePolicy: 'source-verified',
    details: { license: 'MIT', permissions: { level: 'high', files: 'none', network: 'any', commands: 'none', credentials: ['none'] } },
  })
  assert.equal(effectivePolicy(highRisk), 'registry-reviewed')
  const highService = createSourceUpdateService({ fetch: githubFetch(), sourceVerifier: async () => ({ status: 'verified' }) })
  const high = await highService.inspect(highRisk, { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` })
  assert.equal(high.status, 'registry-review-required')
  assert.match(high.reasons.join(' '), /Registry/)

  const driftService = createSourceUpdateService({
    fetch: githubFetch({ patch: '+import { exec } from "node:child_process"' }),
    sourceVerifier: async () => ({ status: 'verified' }),
  })
  const drift = await driftService.inspect(entry(), { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` })
  assert.equal(drift.status, 'registry-review-required')
  assert.match(drift.reasons.join(' '), /权限/)
  assert.throws(() => driftService.approvedCandidate(entry(), candidateCommit), error => error.code === 'SOURCE_UPDATE_NOT_VERIFIED')
})

test('matching source commit is current without downloading or installing source', async () => {
  const service = createSourceUpdateService({ fetch: githubFetch({ commit: catalogCommit }) })
  const result = await service.inspect(entry(), { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` })
  assert.equal(result.status, 'current')
  assert.equal(result.candidate, null)
})
