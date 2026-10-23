import test from 'node:test'
import assert from 'node:assert/strict'
import { excludedRepositoryKeys, isRepositoryExcluded, pruneExcludedCandidates } from '../src/repository-exclusions.mjs'
import { githubUserIdFingerprint, repositoryFingerprint } from '../src/author-exclusions.mjs'
const policy = {
  search: { excludedRepositories: [
    { repositoryUrl: 'https://github.com/mengxingGG/dsh-desktop', reason: 'Downstream distribution, author requested exclusion', evidenceUrl: 'https://github.com/AI-Scarlett/DSH-Store/issues/230#issuecomment-5426569042' },
    { repositoryUrl: 'https://github.com/EricFL1998/deepseek-harness-mobile', reason: 'Android client, not a plugin', evidenceUrl: 'https://github.com/AI-Scarlett/DSH-Store/issues/1528#issuecomment-6340836271' },
  ] },
  withdrawnRepositories: [{ repositoryUrlSha256: repositoryFingerprint('https://github.com/example/withdrawn'), reason: 'author requested permanent withdrawal', requestRefSha256: '1'.repeat(64), requestBodySha256: '2'.repeat(64) }],
  blockedAuthors: [{ userIdSha256: githubUserIdFingerprint(12345), reason: 'permanent owner exclusion', blockedAt: '2026-10-01T00:00:00Z', requestRefSha256: '3'.repeat(64), requestBodySha256: '4'.repeat(64) }],
}
test('exclusion removes only the exact canonical downstream repository, preserving the separate marketplace plugin', () => {
  const candidates = { entries: [
    { id: 'desktop', repositoryUrl: 'https://github.com/mengxinggg/dsh-desktop' },
    { id: 'android-client', repositoryUrl: 'https://github.com/ericfl1998/deepseek-harness-mobile' },
    { id: 'withdrawn', repositoryUrl: 'https://github.com/example/withdrawn' },
    { id: 'blocked-author', repositoryUrl: 'https://github.com/blocked/other-plugin' },
    { id: 'plugin', repositoryUrl: 'https://github.com/mengxingGG/dsh-plugin-marketplace' },
  ] }
  const owners = new Map([['https://github.com/blocked/other-plugin', 12345]])
  assert.deepEqual(pruneExcludedCandidates(candidates, policy, owners).map(item => item.id), ['desktop', 'android-client', 'withdrawn', 'blocked-author'])
  assert.deepEqual(pruneExcludedCandidates({ entries: [{ id: 'blocked-author', repositoryUrl: 'https://github.com/blocked/other-plugin' }] }, policy, owners)
    .map(item => item.reason), ['permanently-excluded-author-identity'])
  assert.deepEqual(candidates.entries.map(item => item.id), ['plugin'])
  assert.equal(excludedRepositoryKeys(policy).has('mengxinggg/dsh-desktop'), false)
  assert.equal(isRepositoryExcluded('https://github.com/example/withdrawn', policy), true)
  assert.throws(() => excludedRepositoryKeys({ search: { excludedRepositories: [{ repositoryUrl: 'https://github.com/a/b' }] } }), /evidence/)
})
