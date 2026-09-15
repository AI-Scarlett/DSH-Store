import { createHash } from 'node:crypto'
const REPOSITORY = 'awesome-dsh-plugin/awesome-dsh-plugin'
export async function discoverFeedCandidates(github, { offset = 0, limit = 8, observedAt = new Date().toISOString() } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 8) throw new Error('invalid discovery bounds')
  const head = await github.api(`repos/${REPOSITORY}/commits/main`)
  if (!/^[a-f0-9]{40}$/.test(head.sha)) throw new Error('feed Commit unavailable')
  const tree = await github.api(`repos/${REPOSITORY}/git/trees/${head.sha}?recursive=1`)
  if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 50000) throw new Error('feed tree exceeds bound')
  const files = tree.tree.filter(item => item.type === 'blob' && item.mode === '100644' && /^data\/plugins\/[a-zA-Z0-9_.-]+\.yml$/.test(item.path)).sort((a,b) => a.path.localeCompare(b.path))
  const result = []; const seen = new Set()
  for (let i = 0; i < Math.min(limit, files.length); i++) {
    const file = files[(offset + i) % files.length]
    const source = await github.raw(`https://github.com/${REPOSITORY}`, head.sha, file.path, { maxBytes: 65536 })
    // Read only the literal URL scalar. Never evaluate YAML tags, instructions,
    // npm aliases, tarballs or executable install commands supplied by a feed.
    const urls = [...source.matchAll(/^url: (https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s*$/gm)]
    if (urls.length !== 1) continue
    const url = urls[0][1].replace(/\.git$/, '')
    if (seen.has(url.toLowerCase())) continue
    seen.add(url.toLowerCase())
    const metadata = await github.api(`repos/${url.slice('https://github.com/'.length)}`)
    if (metadata.private || metadata.archived || metadata.disabled || metadata.html_url?.toLowerCase() !== url.toLowerCase() || !Number.isSafeInteger(metadata.owner?.id)) continue
    const hash = createHash('sha256').update(source).digest('hex')
    result.push({ ...metadata, discoveryOnly: true,
      feedEvidence: `github-feed:${REPOSITORY}@${head.sha}:${file.path}:sha256=${hash}:at=${observedAt}:owner=${metadata.owner.id}` })
  }
  return result
}

// Alternate sources so a busy GitHub search cannot starve the bounded feed.
export function orderDiscoveryCandidates(repositories) {
  const recent = [...repositories].sort((a, b) => Date.parse(b.updated_at ?? 0) - Date.parse(a.updated_at ?? 0))
  const feed = recent.filter(item => item.discoveryOnly)
  const search = recent.filter(item => !item.discoveryOnly)
  const result = []
  for (let i = 0; i < Math.max(feed.length, search.length); i++) {
    if (feed[i]) result.push(feed[i])
    if (search[i]) result.push(search[i])
  }
  return result
}
