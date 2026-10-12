import assert from 'node:assert/strict'
import test from 'node:test'
import { packageSourceSurface, missingLocalModuleReasons, unsupportedPackageEntry } from '../src/package-source-surface.mjs'
import { reviewFixedSource } from '../src/fixed-source-review.mjs'
import { localModuleEvidence } from '../src/automation-source-policy.mjs'

const candidate = { id: 'demo', repositoryUrl: 'https://github.com/example/demo', installPath: null }
const policy = {
  sourceBounds: { maxTreeEntries: 1200, maxRuntimeFiles: 240, maxFileBytes: 262144, maxTotalRuntimeBytes: 2097152 },
  automaticApproval: { allowSymlinks: false, allowSubmodules: false, permissionSignals: {
    files: false, network: false, commands: false, credentials: false, protectedDsh: false, nativeOrExecutableArtifacts: false,
  } },
}
const manifest = { files: ['index.js', 'lib/', 'cordis.patch.yml'], main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }
const sources = { 'package.json': JSON.stringify(manifest), 'index.js': 'export const demo = true', 'lib/client.js': 'export const client = true', 'cordis.patch.yml': '- insert: []', 'README.md': '# demo', LICENSE: 'MIT' }
function treeOf(files, modes = {}) {
  return { truncated: false, tree: Object.entries(files).map(([path, source]) => ({ path, type: 'blob', mode: modes[path] ?? '100644', size: Buffer.byteLength(source) })) }
}
async function review(files = sources, meta = manifest, tree = treeOf(files), config = policy) {
  const reads = []
  const result = await reviewFixedSource(candidate, meta, tree, config, async path => { reads.push(path); return files[path] })
  return { ...result, reads }
}

test('package surface ignores unshipped large datasets and scripts, not published code', async () => {
  const files = { ...sources, 'scripts/deploy.sh': 'rm -rf /', 'data/lessons.json': ' '.repeat(270000) }
  for (let index = 0; index < 1300; index++) files[`workers/file${index}.js`] = 'fetch(endpoint)'
  const result = await review(files)
  assert.equal(result.scope.repositoryEntries, 1308)
  assert.equal(result.scope.files, 6)
  assert.equal(result.runtimeFiles, 4)
  assert.equal(result.filesScanned, 4)
  assert.equal(result.scanComplete, true)
  assert.deepEqual(result.reasons, [])
  assert.equal(result.signals.nativeOrExecutableArtifacts, false)
  assert.ok(result.reads.every(path => !path.startsWith('workers/') && !path.startsWith('scripts/')))
})

test('positive globs include hidden published resources and implicit main/bin metadata', () => {
  const files = { ...sources, '.plugin/assets/icon.png': 'png', '.plugin/plugin.json': '{}', 'bin/cli.js': 'export {}' }
  const surface = packageSourceSurface({ files: ['.plugin/**'], main: 'index.js', bin: { demo: 'bin/cli.js' } }, treeOf(files))
  assert.equal(surface.complete, true)
  assert.deepEqual(surface.entries.map(item => item.relativePath).sort(), ['.plugin/assets/icon.png', '.plugin/plugin.json', 'LICENSE', 'README.md', 'bin/cli.js', 'index.js', 'package.json'].sort())
})

test('shipped test, docs, dist and minified sources are not hidden by directory names', async () => {
  const files = { ...sources, 'tests/fixture.js': "import fs from 'node:fs'", 'docs/entry.js': 'fetch(url)', 'dist/app.min.js': 'spawn(cmd)' }
  const result = await review(files, { ...manifest, files: [...manifest.files, 'tests', 'docs', 'dist'] })
  assert.equal(result.signals.files, true)
  assert.equal(result.signals.network, true)
  assert.equal(result.signals.commands, true)
  assert.equal(result.runtimeFiles, 7)
})

test('unknown selectors, negation, traversal and escapes never silently narrow scope', () => {
  for (const pattern of ['!lib/**', '../x', '/tmp/x', 'lib/{a,b}.js', 'lib/?.js', 'lib\\x', 'a/**b']) {
    const surface = packageSourceSurface({ files: [pattern] }, treeOf(sources))
    assert.equal(surface.complete, false, pattern)
    assert.equal(surface.entries.length, 6, pattern)
  }
})

test('exports and Bundle resources must be inside the distributable surface', () => {
  const surface = packageSourceSurface({ ...manifest, files: ['index.js'], exports: { './client': './lib/client.js' } }, treeOf(sources))
  assert.equal(surface.complete, false)
  assert.match(surface.reasons.join('\n'), /lib\/client.js/)
  assert.match(surface.reasons.join('\n'), /cordis.patch.yml/)
})

test('fixed tree truncation and malformed paths remain unknown instead of negative capability evidence', async () => {
  const result = await review(sources, manifest, { ...treeOf(sources), truncated: true })
  assert.equal(result.scanComplete, false)
  assert.equal(result.filesScanned, 0)
  assert.equal(result.signals.network, null)
  assert.deepEqual(result.reads, [])
  const invalid = packageSourceSurface(manifest, { truncated: false, tree: [...treeOf(sources).tree, { path: '../outside', type: 'blob' }] })
  assert.equal(invalid.complete, false)
})

test('scan bounds remain enforced against the entire selected source surface', async () => {
  const result = await review(sources, manifest, treeOf(sources), { ...policy, sourceBounds: { ...policy.sourceBounds, maxRuntimeFiles: 2 } })
  assert.equal(result.scanComplete, false)
  assert.equal(result.filesScanned, 0)
  assert.equal(result.signals.files, null)
  assert.match(result.reasons.join('\n'), /file count/)
})

test('shipped native/executable, unknown artifacts, symlinks and submodules fail closed', async () => {
  for (const [path, mode, type] of [['lib/addon.node', '100644', 'blob'], ['lib/link.js', '120000', 'blob'], ['lib/module', '160000', 'commit'], ['lib/script', '100755', 'blob'], ['lib/unknown.dat', '100644', 'blob']]) {
    const files = { ...sources, [path]: 'not executable in tests' }
    const tree = treeOf(files, { [path]: mode })
    tree.tree.find(item => item.path === path).type = type
    const result = await review(files, manifest, tree)
    assert.equal(result.scanComplete, false, path)
    assert.ok(result.reasons.length > 0, path)
  }
})

test('monorepo package scope stays relative to its fixed install directory', () => {
  const tree = treeOf(Object.fromEntries(Object.entries(sources).map(([path, value]) => [`packages/demo/${path}`, value])))
  tree.tree.push({ path: 'other/a.sh', type: 'blob', mode: '100755', size: 9 })
  const surface = packageSourceSurface(manifest, tree, 'packages/demo')
  assert.equal(surface.complete, true)
  assert.equal(surface.entries.length, 6)
  assert.ok(surface.entries.every(item => item.path.startsWith('packages/demo/')))
})

test('static local imports must exist in package and dynamic loading is not auto approved', async () => {
  const files = { ...sources, 'index.js': "import './workers/not-shipped.js'; import(variable)" }
  const result = await review(files)
  assert.match(result.reasons.join('\n'), /local module is missing/)
  assert.equal(result.reviewSignals.dynamicModuleLoading, true)
  const evidence = localModuleEvidence("// import('./missing.js')\nconst help = \"require('no')\"; export { a } from './lib/client.js'", 'index.js')
  assert.deepEqual(evidence, { references: ['./lib/client.js'], dynamic: false })
  assert.deepEqual(missingLocalModuleReasons(evidence.references, 'index.js', packageSourceSurface(manifest, treeOf(sources)).entries), [])
  assert.match(missingLocalModuleReasons(['../../outside'], 'index.js', []).join(''), /escapes/)
})

test('browser module query suffixes resolve only to selected local files', () => {
  const entries = packageSourceSurface(manifest, treeOf(sources)).entries
  assert.deepEqual(missingLocalModuleReasons(['./lib/client.js?v=20261009-reasons', './lib/client.js#panel'], 'index.js', entries), [])
  assert.match(missingLocalModuleReasons(['./lib/missing.js?v=1'], 'index.js', entries).join(''), /local module is missing/)
  assert.match(missingLocalModuleReasons(['../../outside.js?v=1'], 'index.js', entries).join(''), /escapes/)
  assert.match(missingLocalModuleReasons(['./?v=1'], 'index.js', entries).join(''), /path is invalid/)
})

test('bounded web metadata is static while executables and unknown artifacts stay blocked', () => {
  for (const path of ['marketplace/site.webmanifest', 'marketplace/sitemap.xml']) {
    assert.equal(unsupportedPackageEntry({ relativePath: path, type: 'blob', mode: '100644' }), false)
  }
  for (const path of ['marketplace/helper.exe', 'marketplace/unknown.dat']) {
    assert.equal(unsupportedPackageEntry({ relativePath: path, type: 'blob', mode: '100644' }), true)
  }
})

test('only the canonical Store excludes generated registry data from executable-source signals', async () => {
  const files = {
    ...sources,
    'registry/catalog.json': JSON.stringify({ description: 'tool.call.toolview' }),
    'registry/catalog-index.json': '{}',
    'registry/candidates.json': '{}',
    'registry/catalog/details/example.json': '{}',
  }
  const meta = { ...manifest, files: [...manifest.files, 'registry/'] }
  const tree = treeOf(files)
  const manager = { id: 'dsh-safe-plugin-manager', repositoryUrl: 'https://github.com/AI-Scarlett/DSH-Store', installPath: null }
  const scan = async identity => reviewFixedSource(identity, meta, tree, policy, async path => files[path])
  const own = await scan(manager)
  assert.equal(own.scanComplete, true)
  assert.equal(own.runtimeFiles, 4)
  assert.equal(own.reviewSignals.toolViewExtension, false)
  const fork = await scan({ ...manager, repositoryUrl: 'https://github.com/example/fork' })
  assert.equal(fork.reviewSignals.toolViewExtension, true)
  assert.match(fork.reasons.join('\n'), /key ownership review/)
})

test('nested ignore rules and source/tree size mismatch are incomplete, not clean', async () => {
  const files = { ...sources, 'lib/.npmignore': 'client.js' }
  assert.equal(packageSourceSurface(manifest, treeOf(files)).complete, false)
  const tree = treeOf(sources)
  tree.tree[1].size++
  const result = await review(sources, manifest, tree)
  assert.equal(result.scanComplete, false)
  assert.match(result.reasons.join('\n'), /size does not match/)
})

test('ordinary tool-view extensions remain review-required without protected-mutation accusation', async () => {
  const files = { ...sources, 'lib/client.js': "ctx.slots.register({ name: 'tool.call.toolview', key: TOOL_KEYS[i] }, View)" }
  const result = await review(files)
  assert.equal(result.signals.protectedDsh, false)
  assert.equal(result.reviewSignals.toolViewExtension, true)
  assert.match(result.reasons.join('\n'), /key ownership review/)
  assert.doesNotMatch(result.reasons.join('\n'), /contains the protectedDsh/)
})


test('globstar includes zero or multiple directory levels, never drops root runtime files', () => {
  const files = { ...sources, 'root-extra.js': 'fetch(endpoint)', 'lib/nested/a.js': 'export {}' }
  const surface = packageSourceSurface({ files: ['**/*.js'] }, treeOf(files))
  assert.ok(surface.entries.some(item => item.relativePath === 'root-extra.js'))
  assert.ok(surface.entries.some(item => item.relativePath === 'lib/client.js'))
  assert.ok(surface.entries.some(item => item.relativePath === 'lib/nested/a.js'))
})

test('per-file and total byte limits block reads without reporting absent capabilities', async () => {
  for (const bounds of [{ maxFileBytes: 5 }, { maxTotalRuntimeBytes: 5 }]) {
    const result = await review(sources, manifest, treeOf(sources), { ...policy, sourceBounds: { ...policy.sourceBounds, ...bounds } })
    assert.equal(result.scanComplete, false)
    assert.equal(result.filesScanned, 0)
    assert.equal(result.signals.commands, null)
    assert.match(result.reasons.join('\n'), /byte bound/)
  }
})
