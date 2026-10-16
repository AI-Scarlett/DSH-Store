import test from 'node:test'
import assert from 'node:assert/strict'
import { browserScriptSignals, localModuleEvidence, permissionSignals } from '../src/automation-source-policy.mjs'

test('DOM script loaders expose network and executable-source review without fetch or import (#910)', () => {
  for (const source of [
    "const s = document.createElement('script'); s.src = CDN; document.head.append(s)",
    'const s = document["createElement"]("script"); s["src"] = CDN; document.head.append(s)',
    'const s = document.createElement?.(`script`); s.setAttribute("src", CDN)',
    'const s = document.createElementNS("http://www.w3.org/1999/xhtml", "script"); s.src = CDN',
  ]) {
    assert.equal(permissionSignals(source, 'client.js').network, true, source)
    assert.equal(localModuleEvidence(source, 'client.js').dynamic, true, source)
  }
})

test('external HTML script sources require review while comments and local script files do not become remote evidence', () => {
  for (const source of ['<script src="https://cdn.example.test/sdk.js"></script>', '<script src=//cdn.example.test/sdk.js></script>', '<script src="data:text/javascript,void(0)"></script>']) {
    assert.equal(permissionSignals(source, 'demo/index.html').network, true)
    assert.equal(localModuleEvidence(source, 'demo/index.html').dynamic, true)
  }
  for (const source of ['<!-- <script src="https://cdn.example.test/sdk.js"></script> -->', '<script src="./packaged-client.js"></script>', '<scr<!-- explanation -->ipt src="https://cdn.example.test/sdk.js"></script>']) {
    assert.deepEqual(browserScriptSignals(source, 'demo/index.html'), { dynamic: false, network: false })
  }
})

test('script-loader examples remain prose and inline script creation is not claimed as an observed network call', () => {
  for (const source of [
    "// document.createElement('script'); s.src = CDN",
    'const help = "document.createElement(\'script\'); s.src = CDN"',
    'const help = `document.createElement("script"); s.src = CDN`',
    'const pattern = /document.createElement("script")/g',
    "const image = document.createElement('img'); image.src = imageUrl",
  ]) assert.deepEqual(browserScriptSignals(source, 'client.js'), { dynamic: false, network: false })
  assert.deepEqual(browserScriptSignals("const s = document.createElement('script'); s.textContent = code", 'client.js'), { dynamic: true, network: false })
})

test('Git source cannot pass runtime artifact checks merely because package files names a generated directory', async () => {
  const { missingRuntimeEntryReasons } = await import('../src/automation-source-policy.mjs')
  const manifest = { main: './lib/index.js', files: ['lib'], exports: { '.': './lib/index.js' } }
  const tree = [{ type: 'blob', mode: '100644', path: 'packages/plugin/package.json' }]
  assert.deepEqual(missingRuntimeEntryReasons(manifest, tree, 'packages/plugin/'), ['runtime artifact is missing from the fixed Git Commit: ./lib/index.js'])
  tree.push({ type: 'blob', mode: '100644', path: 'packages/plugin/lib/index.js' })
  assert.deepEqual(missingRuntimeEntryReasons(manifest, tree, 'packages/plugin/'), [])
  tree[1].mode = '120000'
  assert.equal(missingRuntimeEntryReasons(manifest, tree, 'packages/plugin/').length, 1)
})

test('test-named scripts are not scanned as runtime permission signals', async () => {
  const { isTestSourceFile } = await import('../src/automation-source-policy.mjs')
  assert.equal(isTestSourceFile('build-dsh-plugin/scripts/test-marketplace-entry.mjs'), true)
  assert.equal(isTestSourceFile('scripts/test-normalize-brief.mjs'), true)
  assert.equal(isTestSourceFile('src/marketplace.test.mjs'), true)
  assert.equal(isTestSourceFile('scripts/official-dsh-releases.mjs'), false)
  assert.equal(isTestSourceFile('src/index.mjs'), false)
})

test('bounded source lineage accepts direct descendants by default and divergence only when explicitly enabled', async () => {
  const { isBoundedSourceLineage } = await import('../src/automation-source-policy.mjs')
  const ahead = { status: 'ahead', total_commits: 3 }
  const diverged = {
    status: 'diverged', total_commits: 37, ahead_by: 37, behind_by: 4,
    merge_base_commit: { sha: 'a'.repeat(40) },
  }
  assert.equal(isBoundedSourceLineage(ahead, 200), true)
  assert.equal(isBoundedSourceLineage({ ...ahead, total_commits: 201 }, 200), false)
  assert.equal(isBoundedSourceLineage(diverged, 200), false)
  assert.equal(isBoundedSourceLineage(diverged, 200, { allowDiverged: true }), true)
  assert.equal(isBoundedSourceLineage({ ...diverged, behind_by: 164 }, 200, { allowDiverged: true }), false)
  assert.equal(isBoundedSourceLineage({ ...diverged, merge_base_commit: null }, 200, { allowDiverged: true }), false)
  assert.equal(isBoundedSourceLineage({ ...diverged, status: 'identical' }, 200, { allowDiverged: true }), false)
})
