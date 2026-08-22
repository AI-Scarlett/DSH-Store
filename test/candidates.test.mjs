import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createCandidateService, searchCandidates, validateCandidateRegistry } from '../src/candidates.mjs'

const candidate = {
  id: 'demo-candidate', name: 'Demo Candidate', description: 'Discovered but not trusted.',
  repositoryUrl: 'https://github.com/example/demo-candidate', defaultBranch: 'main', latestCommit: 'a'.repeat(40),
  sourceUpdatedAt: '2026-08-19T00:00:00Z', discoveredAt: '2026-08-20T00:00:00Z',
  discoverySources: ['github-topic'], topics: ['dsh-plugin'], status: 'discovered', route: 'direct-review', statusReason: null,
}

function document(entries = [candidate]) {
  return {
    schemaVersion: 1,
    registry: {
      name: 'Candidates', repositoryUrl: 'https://github.com/example/registry', updatedAt: '2026-08-20T00:00:00Z',
      trustBoundary: { installActionsDisabled: true, catalogPromotionRequired: true, unknownIsNotVerified: true },
    },
    entries,
  }
}

test('candidate discovery records are read-only and reject trusted install fields', () => {
  const registry = validateCandidateRegistry(document())
  assert.equal(registry.entries[0].installable, false)
  assert.deepEqual(registry.entries[0].allowedActions, [])
  assert.equal(searchCandidates(registry, 'github-topic')[0].id, 'demo-candidate')
  for (const field of ['packageName', 'manifestPath', 'installPath', 'entryIds', 'compatibility', 'details', 'risk', 'updatePolicy']) {
    assert.throws(() => validateCandidateRegistry(document([{ ...candidate, [field]: field === 'entryIds' ? [] : {} }])), /forbidden install fields/)
  }
})

test('candidate registry fails closed when its trust boundary is weakened', () => {
  const unsafe = document()
  unsafe.registry.trustBoundary.installActionsDisabled = false
  assert.throws(() => validateCandidateRegistry(unsafe), /trust boundary/)
})

test('bundled candidate registry is valid and remote failure stays read-only', async () => {
  const bundled = JSON.parse(await readFile(new URL('../registry/candidates.json', import.meta.url), 'utf8'))
  const registry = validateCandidateRegistry(bundled)
  assert.ok(registry.entries.length > 0)
  assert.equal(new Set(registry.entries.map(entry => entry.id)).size, registry.entries.length)
  const ios = registry.entries.find(entry => entry.id === 'zseven-w-dsh-ios')
  assert.ok(ios, 'the requested DSH iOS repository must have an auditable candidate decision')
  assert.equal(ios.status, 'rejected')
  assert.equal(ios.route, 'blocked')
  assert.equal(ios.latestCommit, 'e8d94c39d348e2c38b10d0b4ae24bfe005515c97')
  assert.match(ios.statusReason, /lib\/index\.js/)
  assert.match(ios.statusReason, /lib\/client\.js/)
  assert.match(ios.statusReason, /prepare/)
  assert.equal(ios.installable, false)
  assert.deepEqual(ios.allowedActions, [])
  assert.equal(searchCandidates(registry, 'dsh-ios').length, 0, 'rejected candidates must stay hidden from discovery search')
  const service = createCandidateService({ candidateUrl: 'https://example.test/candidates.json', fetch: async () => new Response('missing', { status: 404 }) })
  const result = await service.load()
  assert.equal(result.source.kind, 'bundled')
  assert.equal(result.registry.trustBoundary.installActionsDisabled, true)
})
