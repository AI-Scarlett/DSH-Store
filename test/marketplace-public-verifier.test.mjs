import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const verifier = fileURLToPath(new URL('../scripts/verify-marketplace-public.mjs', import.meta.url))

test('public verifier hydrates the manager detail before checking split-Catalog repair surfaces', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-public-verifier-'))
  const preload = join(temporary, 'mock-public-fetch.mjs')
  const sourceCommit = 'b'.repeat(40)
  await writeFile(preload, `
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const root = process.env.DSH_VERIFIER_FIXTURE_ROOT
const sourceCommit = '${sourceCommit}'
const bridge = await readFile(join(root, 'registry/catalog.json'))
const index = await readFile(join(root, 'registry/catalog-index.json'))
const candidates = await readFile(join(root, 'registry/candidates.json'))
const manager = JSON.parse(await readFile(join(root, 'registry/catalog/details/dsh-safe-plugin-manager.json')))
const repairManifest = JSON.stringify({
  status: 'active', target: { version: manager.version, commit: manager.commit },
  lifecyclePolicy: 'ignore-all-scripts', requiresInteractiveConfirmation: true,
  repairTool: { command: 'pnpm --config.ignore-scripts=true dlx fixed#' + manager.commit + ' --target-version ' + manager.version },
})

globalThis.fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.href)
  const path = url.pathname
  if (url.hostname === 'api.github.com' && path.endsWith('/commits/main')) {
    return new Response(JSON.stringify({ sha: sourceCommit }))
  }
  if (path.endsWith('/release-manifest.json')) return new Response(JSON.stringify({ sourceCommit }))
  if (path.endsWith('/repair/repair-manifest.json')) return new Response(repairManifest)
  if (path.endsWith('/repair/')) return new Response('<main data-repair-state="active">' + manager.commit + '</main>')
  if (path.endsWith('/registry/catalog.json')) return new Response(bridge)
  if (path.endsWith('/registry/catalog-index.json')) return new Response(index)
  if (path.endsWith('/registry/candidates.json')) return new Response(candidates)
  if (path.includes('/registry/catalog/details/')) {
    return new Response(await readFile(join(root, 'registry/catalog/details', basename(path))))
  }
  throw new Error('unexpected verifier URL: ' + url.href)
}
`)

  try {
    const { stdout } = await execFileAsync(process.execPath, ['--import', pathToFileURL(preload).href, verifier, '--attempts', '1'], {
      cwd: root,
      env: { ...process.env, DSH_VERIFIER_FIXTURE_ROOT: root },
      maxBuffer: 4 * 1024 * 1024,
    })
    assert.match(stdout, /MARKETPLACE_PUBLIC_OK catalogs=4\/4 candidates=4\/4 repairs=3\/3 failures=0/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
