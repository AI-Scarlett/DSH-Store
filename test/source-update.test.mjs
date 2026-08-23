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

function githubFetch({ patch = '+export const version = 2', commit = candidateCommit, candidateVersion = '2.0.0' } = {}) {
  return async url => {
    const parsedUrl = new URL(url)
    if (url.includes('/commits/main')) return response({ sha: commit })
    if (parsedUrl.hostname === 'raw.githubusercontent.com' && url.endsWith('/package.json')) {
      const version = url.includes(`/${catalogCommit}/`) ? '1.0.0' : candidateVersion
      return response(JSON.stringify({ name: 'dsh-demo', version, license: 'MIT', main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: {} }))
    }
    if (parsedUrl.hostname === 'raw.githubusercontent.com' && url.endsWith('/cordis.patch.yml')) return response('- id: demo\n')
    if (url.includes('/compare/')) return response({
      status: 'ahead', total_commits: 1,
      files: [{ filename: 'lib/index.js', status: 'modified', additions: 2, deletions: 1, changes: 3, patch }],
    })
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
  assert.deepEqual(result.diff.files, [{ path: 'lib/index.js', status: 'modified', additions: 2, deletions: 1, changes: 3, patchComplete: true }])
  assert.equal(result.diff.additions, 2)
  assert.equal(result.diff.deletions, 1)
  assert.deepEqual(result.diff.networkHosts, [])
  assert.equal(service.approvedCandidate(entry(), candidateCommit).commit, candidateCommit)
})

test('higher-risk plugins and new permission signals require local user review', async () => {
  const highRisk = entry({
    updatePolicy: 'source-verified',
    details: { license: 'MIT', permissions: { level: 'high', files: 'none', network: 'any', commands: 'none', credentials: ['none'] } },
  })
  assert.equal(effectivePolicy(highRisk), 'user-reviewed')
  const highService = createSourceUpdateService({ fetch: githubFetch(), sourceVerifier: async () => ({ status: 'verified' }) })
  const high = await highService.inspect(highRisk, { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` })
  assert.equal(high.status, 'user-review-required')
  assert.match(high.reasons.join(' '), /用户本机逐次审阅/)
  assert.throws(() => highService.approvedCandidate(highRisk, candidateCommit), error => error.code === 'SOURCE_UPDATE_RISK_NOT_ACCEPTED')
  assert.equal(highService.approvedCandidate(highRisk, candidateCommit, { userAcceptedRisk: true }).commit, candidateCommit)

  const driftService = createSourceUpdateService({
    fetch: githubFetch({ patch: '+import { exec } from "node:child_process"' }),
    sourceVerifier: async () => ({ status: 'verified' }),
  })
  const drift = await driftService.inspect(entry(), { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` })
  assert.equal(drift.status, 'user-review-required')
  assert.match(drift.reasons.join(' '), /权限/)
  assert.equal(drift.diff.permissionSignals.commandExecution, true)
  assert.equal(driftService.approvedCandidate(entry(), candidateCommit, { userAcceptedRisk: true }).sourceReview.status, 'user-review-required')
})

test('source update exposes bounded network and file-change signals without returning source patches', async () => {
  const service = createSourceUpdateService({
    fetch: githubFetch({ patch: '+await fetch("https://api.example.test/v1")' }),
    sourceVerifier: async () => ({ status: 'verified' }),
  })
  const result = await service.inspect(entry(), { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` })
  assert.deepEqual(result.diff.networkHosts, ['api.example.test'])
  assert.equal(result.diff.permissionSignals.network, true)
  assert.equal(Object.hasOwn(result.diff.files[0], 'patch'), false)
})

test('protected DSH mutations remain external-only and cannot produce a marketplace plan', async () => {
  const service = createSourceUpdateService({
    fetch: githubFetch({ patch: '+await writeFile("node_modules/@deepseek-ai/dsh-core/index.js", source)' }),
    sourceVerifier: async () => ({ status: 'verified' }),
  })
  const result = await service.inspect(entry(), { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` })
  assert.equal(result.status, 'external-only')
  assert.match(result.reasons.join(' '), /DSH 原生代码/)
  assert.throws(() => service.approvedCandidate(entry(), candidateCommit, { userAcceptedRisk: true }), error => error.code === 'SOURCE_UPDATE_NOT_VERIFIED')
})

test('matching source commit is current without downloading or installing source', async () => {
  const service = createSourceUpdateService({ fetch: githubFetch({ commit: catalogCommit }) })
  const result = await service.inspect(entry(), { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` })
  assert.equal(result.status, 'current')
  assert.equal(result.candidate, null)
})

test('same-version source commits stay informational and do not show a blocked update', async () => {
  const service = createSourceUpdateService({
    fetch: githubFetch({ candidateVersion: '1.0.0' }),
    sourceVerifier: async () => { throw new Error('same-version candidates must not enter full update audit') },
  })
  const result = await service.inspect(entry(), { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` })
  assert.equal(result.status, 'current')
  assert.equal(result.sameVersionSourceChange, true)
  assert.equal(result.candidateVersion, '1.0.0')
  assert.equal(result.diff, null)
  assert.match(result.reasons[0], /同版本提交/)
})

test('numeric DOMException abort codes map to a stable source update timeout', async () => {
  const service = createSourceUpdateService({
    fetch: async () => {
      const error = new Error('This operation was aborted')
      error.name = 'AbortError'
      error.code = 20
      throw error
    },
    timeoutMs: 1,
  })
  await assert.rejects(
    service.inspect(entry(), { version: '1.0.0', source: 'git', declaredSpecifier: `git#${catalogCommit}` }),
    error => error.code === 'SOURCE_UPDATE_TIMEOUT'
      && error.message === 'GitHub 源更新检查超时。',
  )
})
