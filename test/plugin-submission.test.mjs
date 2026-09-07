import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  SUBMISSION_REPORT_MARKER,
  checkRepository,
  checkSubmission,
  parseIssueForm,
  parseRepositoryInput,
  renderSubmissionReport,
  runCli,
  scanSubmissionRepository,
} from '../scripts/check-plugin-submission.mjs'
import { SUBMISSION_SCAN_BOUNDS, scanSubmissionSources } from '../src/submission-security-scan.mjs'

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
  const sources = options.sources ?? {}
  const blobPaths = [...new Set([...Object.keys(packages), ...Object.keys(patches), ...Object.keys(sources)])]
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
        tree: blobPaths.map(path => {
          const content = Object.hasOwn(packages, path) ? JSON.stringify(packages[path])
            : Object.hasOwn(patches, path) ? patches[path] : sources[path]
          return {
            type: options.treeTypes?.[path] ?? 'blob',
            mode: options.treeModes?.[path] ?? '100644',
            path,
            size: options.treeSizes?.[path] ?? Buffer.byteLength(content),
          }
        }),
      }))
    }
    if (parsed.hostname === 'raw.githubusercontent.com') {
      const prefix = `/example/dsh-demo/${SHA}/`
      const path = decodeURIComponent(parsed.pathname.slice(prefix.length))
      if (Object.hasOwn(packages, path)) return new Response(JSON.stringify(packages[path]))
      if (Object.hasOwn(patches, path)) return new Response(patches[path])
      if (Object.hasOwn(sources, path)) return new Response(sources[path])
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
  assert.deepEqual(result.candidate.compatibility.dshReleases, {})
  assert.equal(result.discovery.publisher, 'example')
  const report = renderSubmissionReport(result)
  assert.ok(report.startsWith(SUBMISSION_REPORT_MARKER))
  assert.match(report, /没有执行第三方代码/)
  assert.match(report, /不是安全审计、运行验证或自动上架/)
})

test('submission precheck hydrates the v2 Catalog before validating a candidate entry', async () => {
  const v2Catalog = JSON.parse(await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8'))
  const result = await checkRepository('https://github.com/example/dsh-demo', '', {
    catalogDocument: v2Catalog, fetch: sourceFetch(), retryDelaysMs: [],
  })
  assert.equal(result.status, 'passed')
  assert.equal(result.candidate.id, 'dsh-demo')
})

test('repository automation reuses the same fixed-source gate without an Issue form', async () => {
  const result = await checkRepository('https://github.com/example/dsh-demo', '', {
    catalogDocument: catalog(), fetch: sourceFetch(), retryDelaysMs: [],
  })
  assert.equal(result.status, 'passed')
  assert.equal(result.candidate.commit, SHA)
  assert.equal(result.candidate.packageName, 'dsh-demo')
  assert.equal(result.candidate.details.permissions.level, 'unknown')
})

test('GitHub submission scan reads bounded files from the same fixed commit', async () => {
  const fetch = sourceFetch({ sources: { 'src/index.mjs': 'export function activate() { return true }\n' } })
  const result = await checkRepository('https://github.com/example/dsh-demo', '', {
    catalogDocument: catalog(), fetch, retryDelaysMs: [],
  })
  const scan = await scanSubmissionRepository(result, { fetch, retryDelaysMs: [] })
  assert.equal(scan.verdict, 'pass')
  assert.equal(scan.complete, true)
  assert.equal(scan.filesScanned, 3)
  assert.equal(scan.eligibleFiles, 3)
  assert.equal(scan.engine, 'dsh-store-submission-static-v1')
})

test('security scan warns for common CLI process capability but blocks high-risk secrets', () => {
  const warning = scanSubmissionSources([{ path: 'src/cli.mjs', source: "import { execFileSync } from 'node:child_process'\n" }])
  assert.equal(warning.verdict, 'warn')
  assert.equal(warning.counts.warning, 1)

  const token = `ghp_${'a'.repeat(36)}`
  const blocked = scanSubmissionSources([{ path: 'src/index.mjs', source: `const token = '${token}'\n` }])
  assert.equal(blocked.verdict, 'fail')
  assert.equal(blocked.counts.critical, 1)
  assert.doesNotMatch(JSON.stringify(blocked), new RegExp(token))
  assert.match(renderSubmissionReport({
    status: 'failed', code: 'SUBMISSION_SECURITY_HIGH_RISK', message: 'high risk', securityScan: blocked,
  }), /critical\/secrets\/github-token/)
})

test('oversize scan sources are reported as incomplete instead of silently treated as clean', async () => {
  const path = 'src/generated.mjs'
  const fetch = sourceFetch({
    sources: { [path]: 'not fetched' },
    treeSizes: { [path]: SUBMISSION_SCAN_BOUNDS.maxFileBytes + 1 },
  })
  const result = await checkRepository('https://github.com/example/dsh-demo', '', {
    catalogDocument: catalog(), fetch, retryDelaysMs: [],
  })
  const scan = await scanSubmissionRepository(result, { fetch, retryDelaysMs: [] })
  assert.equal(scan.verdict, 'warn')
  assert.equal(scan.complete, false)
  assert.equal(scan.skippedOversize, 1)
  assert.equal(scan.filesScanned, 2)
  assert.match(renderSubmissionReport({ ...result, securityScan: scan }), /扫描面不完整/)
})

test('CLI converts a high-risk scan into a failed Issue gate and persists the scan summary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-submission-cli-'))
  try {
    const eventPath = join(directory, 'event.json')
    const reportPath = join(directory, 'report.md')
    const resultPath = join(directory, 'result.json')
    await writeFile(eventPath, JSON.stringify({ issue: { body: issueBody() } }), 'utf8')
    const code = await runCli([
      '--event', eventPath, '--report', reportPath, '--result', resultPath,
    ], {
      catalogDocument: catalog(), fetch: sourceFetch(), retryDelaysMs: [],
      scanRepository: async () => scanSubmissionSources([{
        path: 'src/index.mjs', source: `const token = 'ghp_${'b'.repeat(36)}'`,
      }]),
    })
    assert.equal(code, 1)
    const persisted = JSON.parse(await readFile(resultPath, 'utf8'))
    assert.equal(persisted.status, 'failed')
    assert.equal(persisted.code, 'SUBMISSION_SECURITY_HIGH_RISK')
    assert.equal(persisted.securityScan.verdict, 'fail')
    assert.match(await readFile(reportPath, 'utf8'), /安全启发式扫描：\*\*阻断\*\*/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('submission preserves only an explicitly declared per-release compatibility matrix', async () => {
  const result = await checkRepository('https://github.com/example/dsh-demo', '', {
    catalogDocument: catalog(),
    fetch: sourceFetch({ manifest: {
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        compatibility: {
          dsh: '>=0.1.0-rc.8 <0.2.0',
          dshReleases: { '0.1.1-rc.2': 'compatible' },
        },
      },
    } }),
    retryDelaysMs: [],
  })
  assert.deepEqual(result.candidate.compatibility.dshReleases, { '0.1.1-rc.2': 'compatible' })
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

test('an explicit root path selects the root package in a multi-plugin repository', async () => {
  const packages = {
    'package.json': manifest({ name: 'dsh-root' }),
    'plugins/nested/package.json': manifest({ name: 'dsh-nested' }),
  }
  const result = await checkRepository('https://github.com/example/dsh-demo', '.', {
    catalogDocument: catalog(), fetch: sourceFetch({ packages }), retryDelaysMs: [],
  })
  assert.equal(result.candidate.packageName, 'dsh-root')
  assert.equal(result.candidate.manifestPath, 'package.json')
  assert.equal(result.candidate.installPath, null)
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
  assert.match(workflow, /Check fixed source and bounded security heuristics without executing third-party code/)
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
