import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertNoExcludedRecommendations, githubUserIdFingerprint, isBlockedAuthor, isWithdrawnRepository,
  pruneExcludedRecommendations, repositoryFingerprint,
} from '../src/author-exclusions.mjs'

const evidence = {
  requestRefSha256: '1'.repeat(64),
  requestBodySha256: '2'.repeat(64),
}

test('permanent author exclusion is keyed only by immutable numeric GitHub identity', () => {
  const policy = { blockedAuthors: [{ userIdSha256: githubUserIdFingerprint(12345), reason: 'explicit permanent exclusion', blockedAt: '2026-10-01T00:00:00Z', ...evidence }] }
  assert.equal(isBlockedAuthor(12345, policy), true)
  assert.equal(isBlockedAuthor(54321, policy), false)
  assert.equal(isBlockedAuthor(undefined, policy), false)
  assert.throws(() => isBlockedAuthor(12345, { blockedAuthors: [{ ...policy.blockedAuthors[0], requestBodySha256: '' }] }), /exact request-body hashes/)
})

test('repository withdrawal fingerprints hide mutable repository text while matching canonically', () => {
  const policy = { withdrawnRepositories: [{ repositoryUrlSha256: repositoryFingerprint('https://github.com/Example/Plugin'), reason: 'author requested withdrawal', ...evidence }] }
  assert.equal(isWithdrawnRepository('https://github.com/example/plugin', policy), true)
  assert.equal(isWithdrawnRepository('https://github.com/example/other', policy), false)
  assert.throws(() => isWithdrawnRepository('https://github.com/example/plugin', { withdrawnRepositories: [{ ...policy.withdrawnRepositories[0], repositoryUrlSha256: 'nope' }] }), /canonical repository fingerprint/)
})

test('permanently excluded recommendation records are pruned and fail closed if retained', () => {
  const policy = {
    blockedAuthors: [{ userIdSha256: githubUserIdFingerprint(12345), reason: 'explicit permanent exclusion', blockedAt: '2026-10-01T00:00:00Z', ...evidence }],
    withdrawnRepositories: [{ repositoryUrlSha256: repositoryFingerprint('https://github.com/example/withdrawn'), reason: 'author withdrawal', ...evidence }],
  }
  const document = { entries: [
    { id: 'same-author', userId: 12345, repositoryUrl: 'https://github.com/example/one' },
    { id: 'withdrawn-repo', userId: 67890, repositoryUrl: 'https://github.com/example/withdrawn' },
    { id: 'unrelated', userId: 67890, repositoryUrl: 'https://github.com/example/two' },
  ] }
  assert.deepEqual(pruneExcludedRecommendations(document, policy).map(item => item.id), ['same-author', 'withdrawn-repo'])
  assert.deepEqual(document.entries.map(item => item.id), ['unrelated'])
  assert.equal(assertNoExcludedRecommendations(document, policy), document)
  assert.throws(() => assertNoExcludedRecommendations({ entries: [{ id: 'blocked', userId: 12345 }] }, policy), /permanently withdrawn/)
})
