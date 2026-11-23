import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseStorefrontCurationBytes } from '../scripts/validate-storefront-curation.mjs'

const root = new URL('../', import.meta.url)
const rootPath = fileURLToPath(root)

test('the committed storefront curation file validates and reports a bounded summary', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-storefront-curation.mjs'], { cwd: rootPath, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^STOREFRONT_CURATION_OK revision=\d+ featured=\d+ extras=\d+ /)
})

test('the curation validator fails closed on empty, oversized, malformed or contradictory input', () => {
  assert.throws(() => parseStorefrontCurationBytes(Buffer.alloc(0)), /empty/)
  assert.throws(() => parseStorefrontCurationBytes(Buffer.alloc(257 * 1024, 0x20)), /exceeds 256 KiB/)
  assert.throws(() => parseStorefrontCurationBytes(Buffer.from('{')), /not valid JSON/)
  const extra = { id: 'manual-owner-third', repositoryUrl: 'https://github.com/owner/third', nameZh: '第三', nameEn: 'Third', description: '', categories: [], addedAt: '2026-11-22T00:00:00.000Z' }
  assert.throws(() => parseStorefrontCurationBytes(Buffer.from(JSON.stringify({
    schemaVersion: 1, revision: 2, updatedAt: '2026-11-22T00:00:00.000Z',
    boards: { listed: { mode: 'manual', ids: ['manual-owner-third'] } }, extras: [extra],
  }))), /Listed board cannot include manual extras/)
  const ok = parseStorefrontCurationBytes(Buffer.from(JSON.stringify({
    schemaVersion: 1, revision: 2, updatedAt: '2026-11-22T00:00:00.000Z',
    home: { featured: [] }, boards: {}, extras: [],
  })))
  assert.equal(ok.revision, 2)
  assert.equal(ok.boards.popular.mode, 'auto')
})

test('the storefront PR auto-merge workflow is scoped, validated and ordered before merging', async () => {
  const workflow = await readFile(new URL('.github/workflows/storefront-pr-automerge.yml', root), 'utf8')
  assert.match(workflow, /startsWith\(github\.head_ref, 'plugin-scout\/storefront-'\)/)
  assert.match(workflow, /OWNER\|MEMBER\|COLLABORATOR/)
  assert.match(workflow, /registry\/storefront-curation\.json/)
  assert.match(workflow, /node scripts\/validate-storefront-curation\.mjs/)
  assert.match(workflow, /gh pr merge --auto --squash --delete-branch/)
  assert.ok(
    workflow.indexOf('Validate the exact curation scope') < workflow.indexOf('Enable squash auto-merge'),
    'scope validation must run before auto-merge is enabled',
  )
})
