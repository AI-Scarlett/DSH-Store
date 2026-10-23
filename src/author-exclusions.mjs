import { createHash } from 'node:crypto'
import { canonicalGithubRepository } from './catalog.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const SHA256 = /^[a-f0-9]{64}$/

// Store deterministic fingerprints rather than readable login names or
// repository URLs. These digests are stable identifiers, not a guarantee of
// anonymity; immutable GitHub user IDs remain the identity authority.
export function githubUserIdFingerprint(userId) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new TypeError('GitHub user ID must be a positive safe integer')
  return sha256(`github-user-id:${userId}`)
}

export function repositoryFingerprint(repositoryUrl) {
  const canonical = canonicalGithubRepository(repositoryUrl).toLowerCase()
  return sha256(`github-repository:${canonical}`)
}

function evidenceHashes(entry, label) {
  if (!SHA256.test(entry?.requestRefSha256 ?? '') || !SHA256.test(entry?.requestBodySha256 ?? '')) {
    throw new Error(`${label} requires request-reference and exact request-body hashes`)
  }
}

export function blockedAuthorFingerprints(policy) {
  const entries = policy?.blockedAuthors ?? []
  if (!Array.isArray(entries) || entries.length > 1000) throw new Error('blockedAuthors must be a bounded array')
  const fingerprints = new Set()
  for (const entry of entries) {
    if (!SHA256.test(entry?.userIdSha256 ?? '')
      || typeof entry.reason !== 'string' || !entry.reason.trim()
      || !Number.isFinite(Date.parse(entry.blockedAt))) throw new Error('blocked author requires a fingerprint, reason, and date')
    evidenceHashes(entry, 'blocked author')
    if (fingerprints.has(entry.userIdSha256)) throw new Error('duplicate blocked author fingerprint')
    fingerprints.add(entry.userIdSha256)
  }
  return fingerprints
}

export function isBlockedAuthor(userId, policy) {
  if (!Number.isSafeInteger(userId) || userId < 1) return false
  return blockedAuthorFingerprints(policy).has(githubUserIdFingerprint(userId))
}

export function withdrawnRepositoryFingerprints(policy) {
  const entries = policy?.withdrawnRepositories ?? []
  if (!Array.isArray(entries) || entries.length > 2000) throw new Error('withdrawnRepositories must be a bounded array')
  const fingerprints = new Set()
  for (const entry of entries) {
    if (!SHA256.test(entry?.repositoryUrlSha256 ?? '')
      || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error('withdrawn repository requires a canonical repository fingerprint and reason')
    }
    evidenceHashes(entry, 'withdrawn repository')
    if (fingerprints.has(entry.repositoryUrlSha256)) throw new Error('duplicate withdrawn repository fingerprint')
    fingerprints.add(entry.repositoryUrlSha256)
  }
  return fingerprints
}

export function isWithdrawnRepository(repositoryUrl, policy) {
  let fingerprint
  try { fingerprint = repositoryFingerprint(repositoryUrl) } catch { return false }
  return withdrawnRepositoryFingerprints(policy).has(fingerprint)
}

export function pruneExcludedRecommendations(document, policy) {
  if (!Array.isArray(document?.entries)) throw new Error('community recommendations require an entries array')
  const removed = []
  document.entries = document.entries.filter(entry => {
    if (!isWithdrawnRepository(entry?.repositoryUrl, policy) && !isBlockedAuthor(entry?.userId, policy)) return true
    removed.push({ id: entry.id, reason: isBlockedAuthor(entry?.userId, policy)
      ? 'permanently-excluded-author-identity' : 'author-requested-permanent-withdrawal' })
    return false
  })
  return removed
}

export function assertNoExcludedRecommendations(document, policy) {
  if (!Array.isArray(document?.entries)) throw new Error('community recommendations require an entries array')
  for (const entry of document.entries) {
    if (isWithdrawnRepository(entry?.repositoryUrl, policy) || isBlockedAuthor(entry?.userId, policy)) {
      throw new Error('community recommendations contain a permanently withdrawn project or excluded author')
    }
  }
  return document
}
