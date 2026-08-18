import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  SUBMISSION_REPORT_MARKER,
  buildCandidateEntry,
  checkSubmission,
  parseIssueForm,
  renderSubmissionReport,
} from '../scripts/check-plugin-submission.mjs'

const baseFields = {
  'Catalog ID': 'dsh-demo',
  'Display name': 'DSH Demo',
  Description: 'A useful DSH fixture plugin.',
  'GitHub repository': 'https://github.com/example/dsh-demo',
  'Immutable commit': 'a'.repeat(40),
  'Manifest path': 'package.json',
  'Install path': '.',
  'Package name': 'dsh-demo',
  'Package version': '1.2.0',
  Categories: 'tools, workflow',
  'DSH entry IDs': 'demo',
  'Install lifecycle scripts': 'none',
  'Plugin type': 'feature — 功能插件',
  License: 'MIT',
  'Permission level': 'low — 低',
  'File permission': 'none — 不访问',
  'Network permission': 'none — 无',
  'Command execution': 'none — 否',
  'Credential access': 'none',
  'External dependencies': 'none',
  'DSH compatibility': '>=0.1.0-rc.7',
  'Node.js compatibility': '^22.19.0 || >=24.0.0',
  'Supported systems': 'macOS, Linux, Windows',
  'Supported profiles': 'web, headless',
  'Registry guarantees': [
    '- [x] The package declares a Bundle Patch.',
    '- [x] The patch does not disable official entries.',
    '- [x] The metadata is accurate.',
  ].join('\n'),
}

function issueBody(overrides = {}) {
  const fields = { ...baseFields, ...overrides }
  return Object.entries(fields).map(([label, value]) => `### ${label}\n\n${value}`).join('\n\n')
}

function catalog(entries = []) {
  return {
    schemaVersion: 1,
    registry: {
      name: 'Fixture registry',
      repositoryUrl: 'https://github.com/example/registry',
      homepageUrl: 'https://example.test',
      updatedAt: '2026-08-18T00:00:00Z',
      categories: { tools: '工具', workflow: '工作流与自动化' },
    },
    entries,
  }
}

function sourceFetch(options = {}) {
  return async url => {
    if (url.endsWith('/package.json') || url.endsWith('/plugins/demo/package.json')) {
      return new Response(JSON.stringify({
        name: options.packageName ?? 'dsh-demo',
        version: options.version ?? '1.2.0',
        license: 'MIT',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
        scripts: options.scripts ?? {},
      }))
    }
    return new Response(options.patch ?? '- insert:\n    - id: demo\n      name: dsh-demo\n')
  }
}

test('submission checker accepts a fixed root package without executing it', async () => {
  const result = await checkSubmission(issueBody(), { catalogDocument: catalog(), fetch: sourceFetch() })
  assert.equal(result.status, 'passed')
  assert.equal(result.candidate.installPath, null)
  assert.equal(result.source.packageName, 'dsh-demo')
  const report = renderSubmissionReport(result)
  assert.ok(report.startsWith(SUBMISSION_REPORT_MARKER))
  assert.match(report, /不会执行第三方代码/)
})

test('submission report escapes backslashes and backticks before rendering untrusted text', () => {
  const report = renderSubmissionReport({
    status: 'failed',
    code: 'SUBMISSION_TEST',
    message: 'path\\`break\nnext',
  })
  assert.match(report, /path\\\\\\`break next/)
  assert.doesNotMatch(report, /break\nnext/)
})

test('submission checker accepts a monorepo package path', async () => {
  const result = await checkSubmission(issueBody({
    'Manifest path': 'plugins/demo/package.json',
    'Install path': 'plugins/demo',
  }), { catalogDocument: catalog(), fetch: sourceFetch() })
  assert.equal(result.candidate.installPath, 'plugins/demo')
  assert.equal(result.candidate.manifestPath, 'plugins/demo/package.json')
})

test('submission checker rejects missing fields, moving refs, and path traversal', () => {
  assert.throws(
    () => buildCandidateEntry(parseIssueForm(issueBody({ 'Package version': '_No response_' }))),
    error => error.code === 'SUBMISSION_FIELD_MISSING',
  )
  assert.throws(
    () => buildCandidateEntry(parseIssueForm(issueBody({ 'Immutable commit': 'main' }))),
    error => error.code === 'SUBMISSION_COMMIT_INVALID',
  )
  assert.throws(
    () => buildCandidateEntry(parseIssueForm(issueBody({ 'Manifest path': '../package.json' }))),
    error => error.code === 'SUBMISSION_PATH_INVALID',
  )
  assert.throws(
    () => buildCandidateEntry(parseIssueForm(issueBody({
      'Manifest path': 'plugins/demo/package.json',
      'Install path': '.',
    }))),
    error => error.code === 'SUBMISSION_INSTALL_PATH_MISMATCH',
  )
})

test('submission checker rejects manifest and lifecycle mismatches', async () => {
  await assert.rejects(
    () => checkSubmission(issueBody(), {
      catalogDocument: catalog(),
      fetch: sourceFetch({ packageName: 'dsh-other' }),
    }),
    error => error.code === 'SOURCE_MANIFEST_MISMATCH',
  )
  await assert.rejects(
    () => checkSubmission(issueBody({ 'Install lifecycle scripts': 'prepare' }), {
      catalogDocument: catalog(),
      fetch: sourceFetch({ scripts: {} }),
    }),
    error => error.code === 'SOURCE_MANIFEST_MISMATCH',
  )
})

test('submission checker rejects protected packages, protected entries, and catalog collisions', async () => {
  assert.throws(
    () => buildCandidateEntry(parseIssueForm(issueBody({ 'Package name': '@deepseek-ai/dsh-fake' }))),
    error => error.code === 'SUBMISSION_PACKAGE_PROTECTED',
  )
  assert.throws(
    () => buildCandidateEntry(parseIssueForm(issueBody({ 'DSH entry IDs': 'ui-settings-plugin-inventory' }))),
    error => error.code === 'SUBMISSION_ENTRY_PROTECTED',
  )
  assert.throws(
    () => buildCandidateEntry(parseIssueForm(issueBody({ 'Credential access': 'none, api-key' }))),
    error => error.code === 'SUBMISSION_CREDENTIAL_INVALID',
  )
  const existing = buildCandidateEntry(parseIssueForm(issueBody({
    'Catalog ID': 'existing',
    'Package name': 'dsh-existing',
    'DSH entry IDs': 'taken',
  })))
  await assert.rejects(
    () => checkSubmission(issueBody({ 'DSH entry IDs': 'taken' }), {
      catalogDocument: catalog([existing]),
      fetch: sourceFetch(),
    }),
    error => error.code === 'SUBMISSION_ENTRY_COLLISION',
  )
})

test('submission checker rejects undeclared patch entries and protected package impersonation', async () => {
  await assert.rejects(
    () => checkSubmission(issueBody(), {
      catalogDocument: catalog(),
      fetch: sourceFetch({ patch: '- insert:\n    - id: demo\n      name: dsh-demo\n    - id: hidden\n      name: dsh-hidden\n' }),
    }),
    error => error.code === 'SUBMISSION_PATCH_ENTRIES_MISMATCH',
  )
  await assert.rejects(
    () => checkSubmission(issueBody(), {
      catalogDocument: catalog(),
      fetch: sourceFetch({ patch: '- insert:\n    - id: demo\n      name: "@deepseek-ai/dsh-fake"\n' }),
    }),
    error => error.code === 'SUBMISSION_PATCH_PROTECTED',
  )
})

test('GitHub issue workflow gates opened and edited submissions with one upserted bot report', async () => {
  const workflow = await readFile(new URL('../.github/workflows/plugin-submission.yml', import.meta.url), 'utf8')
  const form = await readFile(new URL('../.github/ISSUE_TEMPLATE/plugin-submission.yml', import.meta.url), 'utf8')
  assert.match(workflow, /types: \[opened, edited, reopened\]/)
  assert.match(workflow, /contents: read/)
  assert.match(workflow, /issues: write/)
  assert.match(workflow, /continue-on-error: true/)
  assert.match(workflow, /dsh-plugin-submission-check/)
  assert.match(workflow, /updateComment/)
  assert.match(workflow, /submission-passed/)
  assert.match(workflow, /submission-failed/)
  assert.doesNotMatch(workflow, /npm (?:install|ci)|pnpm|yarn/)
  assert.match(form, /label: Manifest path/)
  assert.match(form, /label: Install path/)
  assert.match(form, /without executing third-party code/)
})
