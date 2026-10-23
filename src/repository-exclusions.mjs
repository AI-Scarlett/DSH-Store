import { canonicalGithubRepository } from './catalog.mjs'
import { isBlockedAuthor, isWithdrawnRepository } from './author-exclusions.mjs'
export function excludedRepositoryKeys(policy) {
  const values = policy?.search?.excludedRepositories ?? []
  if (!Array.isArray(values)) throw new Error('excludedRepositories must be an array')
  return new Set(values.map(item => {
    if (!item.reason || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:#issuecomment-\d+)?$/.test(item.evidenceUrl ?? '')) throw new Error('repository exclusion requires a reason and issue evidence')
    return canonicalGithubRepository(item.repositoryUrl).toLowerCase()
  }))
}
export function isRepositoryExcluded(repositoryUrl, policy) {
  return excludedRepositoryKeys(policy).has(canonicalGithubRepository(repositoryUrl).toLowerCase())
    || isWithdrawnRepository(repositoryUrl, policy)
}
export function pruneExcludedCandidates(candidates, policy, ownerUserIds = new Map()) {
  const excluded = excludedRepositoryKeys(policy)
  const ownerIdFor = item => ownerUserIds.get(canonicalGithubRepository(item.repositoryUrl).toLowerCase())
    ?? ownerUserIds.get(canonicalGithubRepository(item.repositoryUrl).toLowerCase().replace(/^https:\/\/github\.com\//, ''))
  const authorBlocked = item => isBlockedAuthor(ownerIdFor(item), policy)
  const removed = candidates.entries.filter(item => excluded.has(canonicalGithubRepository(item.repositoryUrl).toLowerCase())
    || isWithdrawnRepository(item.repositoryUrl, policy) || authorBlocked(item))
  candidates.entries = candidates.entries.filter(item => !excluded.has(canonicalGithubRepository(item.repositoryUrl).toLowerCase())
    && !isWithdrawnRepository(item.repositoryUrl, policy) && !authorBlocked(item))
  return removed.map(item => ({ id: item.id, repositoryUrl: item.repositoryUrl,
    reason: authorBlocked(item) ? 'permanently-excluded-author-identity'
      : isWithdrawnRepository(item.repositoryUrl, policy)
        ? 'author-requested-permanent-withdrawal' : 'maintainer-policy-exclusion' }))
}

export function assertNoExcludedCandidates(candidates, policy, ownerUserIds = new Map()) {
  if (!Array.isArray(candidates?.entries)) throw new Error('candidate registry requires an entries array')
  const excluded = excludedRepositoryKeys(policy)
  for (const entry of candidates.entries) {
    const key = canonicalGithubRepository(entry.repositoryUrl).toLowerCase()
    const ownerId = ownerUserIds.get(key) ?? ownerUserIds.get(key.replace(/^https:\/\/github\.com\//, ''))
    if (excluded.has(key) || isWithdrawnRepository(entry.repositoryUrl, policy) || isBlockedAuthor(ownerId, policy)) {
      throw new Error('candidate registry contains an excluded repository')
    }
  }
  return candidates
}
