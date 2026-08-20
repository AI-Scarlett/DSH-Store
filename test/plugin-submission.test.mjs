import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  SUBMISSION_REPORT_MARKER,
  checkSubmission,
  parseIssueForm,
  parseRepositoryInput,
  renderSubmissionReport,
} from '../scripts/check-plugin-submission.mjs'

const SHA = 'a'.repeat(40)

function issueBody(overrides = {}) {
  const fields = {
    'GitHub repository': 'https://github.com/example/dsh-demo',
    'Plugin path (optional)': '_No response_',
    'Notes (optional)': '_No response_',
    ...overrides,
  }
  return Object.entries(fields).map(([label, value]) => `### ${label}\n\n${value}`).join('\n\n')
}

function manifest(overrides = {}) {
  return {
    name: 'dsh-demo', version: '1.2.0', description: 'A useful DSH fixture plugin.', license: 'MIT',
    engines: { node: '^22.19.0 || >=24.0.0' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    scripts: {}, ...overrides,
  }
}

function catalog(entries = []) {
  return {
    schemaVersion: 1,
    registry: {
      name: 'Fixture registry', repositoryUrl: 'https://github.com/example/registry',
      homepageUrl: 'https://example.test', updatedAt: '2026-08-18T00:00:00Z',
      categories: { experimental: '实验', tools: '工具' },
      trustPolicy: { candidateInstallDisabled: true, unknownIsNotVerified: true, promotionIndependentOfVerification: true },
    },
    entries,
  }
}

function sourceFetch(options = {}) {
  const packages = options.packages ?? { 'package.json': manifest(options.manifest) }
  const patches = options.patches ?? Object.fromEntries(Object.keys(packages).map(path => {
    const directory = path === 'package.json' ? '' : `${path.slice(0, -'package.json'.length)}`
    return [`${directory}cordis.patch.yml`, options.patch ?? '- insert:\n    - id: demo\n      name: dsh-demo\n']
  }))
  return async url => {
    const parsed = new URL(url)
    if (parsed.hostname === 'api.github.com' && parsed.pathname === '/repos/example/dsh-demo') {
      return new Response(JSON.stringify({
        private: options.private === true, archived: options.archived === true, default_branch: 'main',
      }))
    }
    if (parsed.hostname === 'api.github.com' && parsed.pathname.endsWith('/commits/main')) {
      return new Response(JSON.stringify({ sha: SHA }))
    }
    if (parsed.hostname === 'api.github.com' && parsed.pathname.includes('/git/trees/')) {
      return new Response(JSON.stringify({
        truncated: options.truncated === true,
        tree: Object.keys(packages).map(path => ({ type: 'blob', path })),
      }))
    }
    if (parsed.hostname === 'raw.githubusercontent.com') {
      const prefix = `/example/dsh-demo/${SHA}/`
      const path = decodeURIComponent(parsed.pathname.slice(prefix.length))
      if (Object.hasOwn(packages, path)) return new Response(JSON.stringify(packages[path]))
      if (Object.hasOwn(patches, path)) return new Response(patches[path])
      if (path === 'README.md' || path.endsWith('/README.md')) {
        return new Response('# DSH Demo\n\nA fixture README description for the marketplace.\n')
      }
      return new Response('missing', { status: 404 })
    }
    throw new Error(`unexpected URL ${url}`)
  }
}

test('simple submission reads a fixed root package without executing it', async () => {
  const result = await checkSubmission(issueBody(), {
    catalogDocument: catalog(), fetch: sourceFetch(), retryDelaysMs: [],
  })
  assert.equal(result.status, 'passed')
  assert.equal(result.candidate.installPath, null)
  assert.equal(result.candidate.packageName, 'dsh-demo')
  assert.equal(result.candidate.commit, SHA)
  assert.equal(result.candidate.details.permissions.level, 'unknown')
  assert.equal(result.candidate.compatibility.node, '^22.19.0 || >=24.0.0')
  assert.deepEqual(result.candidate.compatibility.profiles, ['web'])
  assert.equal(result.discovery.publisher, 'example')
  const report = renderSubmissionReport(result)
  assert.ok(report.startsWith(SUBMISSION_REPORT_MARKER))
  assert.match(report, /没有执行第三方代码/)
  assert.match(report, /不是安全审计、运行验证或自动上架/)
})

test('repository tree link supplies a monorepo plugin path automatically', async () => {
  const packages = { 'plugins/demo/package.json': manifest() }
  const result = await checkSubmission(issueBody({
    'GitHub repository': 'https://github.com/example/dsh-demo/tree/main/plugins/demo',
  }), { catalogDocument: catalog(), fetch: sourceFetch({ packages }), retryDelaysMs: [] })
  assert.equal(result.candidate.installPath, 'plugins/demo')
  assert.equal(result.candidate.manifestPath, 'plugins/demo/package.json')
})

test('multiple DSH packages ask only for an optional plugin path and then resolve deterministically', async () => {
  const packages = {
    'plugins/one/package.json': manifest({ name: 'dsh-one' }),
    'plugins/two/package.json': manifest({ name: 'dsh-two' }),
  }
  const fetch = sourceFetch({ packages })
  await assert.rejects(
    () => checkSubmission(issueBody(), { catalogDocument: catalog(), fetch, retryDelaysMs: [] }),
    error => error.code === 'SUBMISSION_PACKAGE_AMBIGUOUS' && /plugins\/one/.test(error.message),
  )
  const selected = await checkSubmission(issueBody({ 'Plugin path (optional)': 'plugins/two' }), {
    catalogDocument: catalog(), fetch, retryDelaysMs: [],
  })
  assert.equal(selected.candidate.packageName, 'dsh-two')
})

test('submission input rejects non-GitHub and escaping paths', async () => {
  assert.equal(parseRepositoryInput('https://github.com/example/dsh-demo').repositoryUrl, 'https://github.com/example/dsh-demo')
  assert.throws(() => parseRepositoryInput('https://example.test/dsh-demo'), error => error.code === 'SUBMISSION_REPOSITORY_INVALID')
  await assert.rejects(
    () => checkSubmission(issueBody({ 'Plugin path (optional)': '../secret' }), {
      catalogDocument: catalog(), fetch: sourceFetch(), retryDelaysMs: [],
    }),
    error => error.code === 'SUBMISSION_PATH_INVALID',
  )
  assert.equal(parseIssueForm(issueBody()).get('GitHub repository'), 'https://github.com/example/dsh-demo')
})

test('submission rejects private, archived, protected, and malformed plugin sources', async () => {
  await assert.rejects(
    () => checkSubmission(issueBody(), { catalogDocument: catalog(), fetch: sourceFetch({ private: true }), retryDelaysMs: [] }),
    error => error.code === 'SUBMISSION_REPOSITORY_PRIVATE',
  )
  await assert.rejects(
    () => checkSubmission(issueBody(), { catalogDocument: catalog(), fetch: sourceFetch({ archived: true }), retryDelaysMs: [] }),
    error => error.code === 'SUBMISSION_REPOSITORY_ARCHIVED',
  )
  await assert.rejects(
    () => checkSubmission(issueBody(), {
      catalogDocument: catalog(), fetch: sourceFetch({ manifest: { name: '@deepseek-ai/fake' } }), retryDelaysMs: [],
    }),
    error => error.code === 'SUBMISSION_PACKAGE_PROTECTED',
  )
  await assert.rejects(
    () => checkSubmission(issueBody(), {
      catalogDocument: catalog(), fetch: sourceFetch({ patch: '- insert:\n    - id: dsh-safe-plugin-manager\n      name: fake\n' }), retryDelaysMs: [],
    }),
    error => error.code === 'SUBMISSION_ENTRY_PROTECTED',
  )
})

test('submission derives lifecycle scripts and rejects existing entry collisions', async () => {
  const first = await checkSubmission(issueBody(), {
    catalogDocument: catalog(), fetch: sourceFetch({ manifest: { scripts: { prepare: 'node build.mjs' } } }), retryDelaysMs: [],
  })
  assert.deepEqual(first.candidate.risk.installScripts, ['prepare'])
  await assert.rejects(
    () => checkSubmission(issueBody(), {
      catalogDocument: catalog([{ ...first.candidate, id: 'existing', packageName: 'dsh-existing', repositoryUrl: 'https://github.com/example/existing' }]),
      fetch: sourceFetch({ manifest: { name: 'dsh-other' } }), retryDelaysMs: [],
    }),
    error => error.code === 'SUBMISSION_ENTRY_COLLISION',
  )
})

test('submission report escapes untrusted failure text', () => {
  const report = renderSubmissionReport({ status: 'failed', code: 'SUBMISSION_TEST', message: 'path\\`break\nnext' })
  assert.match(report, /path\\\\\\`break next/)
  assert.doesNotMatch(report, /break\nnext/)
})

test('GitHub workflow gates a one-required-field form with an upserted bot report', async () => {
  const workflow = await readFile(new URL('../.github/workflows/plugin-submission.yml', import.meta.url), 'utf8')
  const form = await readFile(new URL('../.github/ISSUE_TEMPLATE/plugin-submission.yml', import.meta.url), 'utf8')
  assert.match(workflow, /types: \[opened, edited, reopened\]/)
  assert.match(workflow, /contents: read/)
  assert.match(workflow, /issues: write/)
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/)
  assert.match(workflow, /continue-on-error: true/)
  assert.match(workflow, /dsh-plugin-submission-check/)
  assert.match(workflow, /updateComment/)
  assert.match(workflow, /submission-passed/)
  assert.match(workflow, /submission-failed/)
  assert.doesNotMatch(workflow, /npm (?:install|ci)|pnpm|yarn/)
  assert.equal((form.match(/required: true/g) || []).length, 1)
  assert.match(form, /label: GitHub repository/)
  assert.match(form, /label: Plugin path \(optional\)/)
  assert.doesNotMatch(form, /label: (?:Manifest path|Package name|Permission level|Immutable commit)/)
  assert.match(form, /不会.*运行第三方/)
})
