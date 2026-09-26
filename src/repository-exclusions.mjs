import { canonicalGithubRepository } from './catalog.mjs'
export function excludedRepositoryKeys(policy) {
  const values = policy.search.excludedRepositories ?? []
  if (!Array.isArray(values)) throw new Error('excludedRepositories must be an array')
  return new Set(values.map(item => {
    if (!item.reason || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:#issuecomment-\d+)?$/.test(item.evidenceUrl ?? '')) throw new Error('repository exclusion requires a reason and issue evidence')
    return canonicalGithubRepository(item.repositoryUrl).toLowerCase()
  }))
}
export function pruneExcludedCandidates(candidates, policy) {
  const excluded = excludedRepositoryKeys(policy)
  const removed = candidates.entries.filter(item => excluded.has(canonicalGithubRepository(item.repositoryUrl).toLowerCase()))
  candidates.entries = candidates.entries.filter(item => !excluded.has(canonicalGithubRepository(item.repositoryUrl).toLowerCase()))
  return removed.map(item => ({ id: item.id, repositoryUrl: item.repositoryUrl, reason: 'maintainer-policy-exclusion' }))
}
