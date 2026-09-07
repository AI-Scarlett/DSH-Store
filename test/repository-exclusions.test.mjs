import test from 'node:test'
import assert from 'node:assert/strict'
import { excludedRepositoryKeys, pruneExcludedCandidates } from '../src/repository-exclusions.mjs'
const policy = { search: { excludedRepositories: [{ repositoryUrl: 'https://github.com/mengxingGG/dsh-desktop', reason: 'Downstream distribution, author requested exclusion', evidenceUrl: 'https://github.com/AI-Scarlett/DSH-Store/issues/230#issuecomment-5426569042' }] } }
test('exclusion removes only the exact canonical downstream repository, preserving the separate marketplace plugin', () => {
  const candidates = { entries: [{ id: 'desktop', repositoryUrl: 'https://github.com/mengxinggg/dsh-desktop' }, { id: 'plugin', repositoryUrl: 'https://github.com/mengxingGG/dsh-plugin-marketplace' }] }
  assert.equal(pruneExcludedCandidates(candidates, policy)[0].id, 'desktop')
  assert.deepEqual(candidates.entries.map(item => item.id), ['plugin'])
  assert.equal(excludedRepositoryKeys(policy).has('mengxinggg/dsh-desktop'), false)
  assert.throws(() => excludedRepositoryKeys({ search: { excludedRepositories: [{ repositoryUrl: 'https://github.com/a/b' }] } }), /evidence/)
})
