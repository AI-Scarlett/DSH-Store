import { createHash } from 'node:crypto'

const DEFAULT_SOURCE = {
  repository: 'awesome-dsh-plugin/awesome-dsh-plugin',
  branch: 'main',
  format: 'yaml-tree',
  filePattern: '^data/plugins/[a-zA-Z0-9_.-]+\\.yml$',
  maxFileBytes: 65_536,
}
const SOURCE_ID = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const BRANCH = /^[A-Za-z0-9._/-]{1,120}$/
const YAML_REPOSITORY_URL = /^url: (https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s*$/gm

function repositoryKeyUrl(value) {
  if (typeof value !== 'string') return null
  const parts = value.split('/')
  if (parts.length !== 2 || parts.some(part => part === '.' || part === '..'
    || !/^[A-Za-z0-9_.-]{1,100}$/.test(part))) return null
  return parseCanonicalRepositoryUrl(`https://github.com/${value}`)
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function parseCanonicalRepositoryUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port
      || url.username || url.password || url.search || (url.hash && !/^#[A-Za-z0-9_.-]+$/.test(url.hash))) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 2 || parts.some(part => part.includes('%'))) return null
    const owner = parts[0]
    const repository = parts[1].replace(/\.git$/i, '')
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository)) return null
    return `https://github.com/${owner}/${repository}`
  } catch {
    return null
  }
}

function markdownRepositoryUrls(source, sectionHeading) {
  const lines = source.split(/\r?\n/)
  const headingIndex = lines.findIndex(line => line.startsWith(sectionHeading))
  if (headingIndex < 0) return []
  let end = lines.findIndex((line, index) => index > headingIndex && /^##\s/.test(line))
  if (end < 0) end = lines.length
  const urls = []
  for (const line of lines.slice(headingIndex + 1, end)) {
    for (const match of line.matchAll(/\]\((https:\/\/github\.com\/[^\s)]+)\)/g)) {
      const url = parseCanonicalRepositoryUrl(match[1])
      if (url) urls.push(url)
    }
  }
  return urls
}

export function validateDiscoveryFeedSource(source) {
  if (!source || typeof source !== 'object' || !SOURCE_ID.test(source.repository ?? '')
    || !BRANCH.test(source.branch ?? '')) throw new Error('invalid discovery feed source')
  if (source.format === 'yaml-tree') {
    if (typeof source.filePattern !== 'string' || source.filePattern.length > 240) throw new Error('invalid feed tree filter')
    try { new RegExp(source.filePattern) } catch { throw new Error('invalid feed tree filter') }
  } else if (source.format === 'markdown-table') {
    if (typeof source.path !== 'string' || !/^[A-Za-z0-9._/-]{1,120}\.md$/.test(source.path)
      || typeof source.sectionHeading !== 'string' || !/^## .{1,100}$/.test(source.sectionHeading)) {
      throw new Error('invalid markdown feed bounds')
    }
  } else if (source.format === 'json-map') {
    if (typeof source.path !== 'string' || !/^[A-Za-z0-9._/-]{1,120}\.json$/.test(source.path)
      || typeof source.excludePath !== 'string' || !/^[A-Za-z0-9._/-]{1,120}\.json$/.test(source.excludePath)
      || [source.path, source.excludePath].some(value => value.startsWith('/')
        || value.split('/').some(part => part === '.' || part === '..' || part === ''))
      || typeof source.excludeKey !== 'string' || !/^[A-Za-z0-9_]{1,60}$/.test(source.excludeKey)) {
      throw new Error('invalid JSON map feed bounds')
    }
  } else throw new Error('unsupported discovery feed format')
  const maxFileBytes = source.maxFileBytes ?? 65_536
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > 1_000_000) throw new Error('invalid feed file bound')
  const excludeMaxFileBytes = source.excludeMaxFileBytes ?? maxFileBytes
  if (!Number.isSafeInteger(excludeMaxFileBytes) || excludeMaxFileBytes < 1 || excludeMaxFileBytes > 512_000) throw new Error('invalid feed exclusion file bound')
  const maxEntries = source.maxEntries ?? 20_000
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 20_000) throw new Error('invalid feed entry bound')
  const maxRecordsPerRun = source.maxRecordsPerRun ?? 8
  if (!Number.isSafeInteger(maxRecordsPerRun) || maxRecordsPerRun < 1 || maxRecordsPerRun > 64) throw new Error('invalid feed record bound')
  if (source.primary !== undefined && typeof source.primary !== 'boolean') throw new Error('invalid primary feed marker')
  return { ...source, maxFileBytes, excludeMaxFileBytes, maxEntries, maxRecordsPerRun }
}

function selectWindow(items, offset, limit) {
  if (!items.length) return []
  const start = offset % items.length
  return Array.from({ length: Math.min(limit, items.length) }, (_, index) => items[(start + index) % items.length])
}

export function discoveryWindowOffset(nowMs, scheduleHours, recordsPerRun) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(scheduleHours) || scheduleHours < 1
    || scheduleHours > 24 || !Number.isSafeInteger(recordsPerRun) || recordsPerRun < 1 || recordsPerRun > 64) {
    throw new Error('invalid discovery schedule window')
  }
  return Math.floor(nowMs / (scheduleHours * 3_600_000)) * recordsPerRun
}

export async function discoverFeedCandidates(github, {
  source = DEFAULT_SOURCE,
  offset = 0,
  limit = 8,
  observedAt = new Date().toISOString(),
  stats = null,
} = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 64) {
    throw new Error('invalid discovery bounds')
  }
  const feed = validateDiscoveryFeedSource(source)
  if (limit > feed.maxRecordsPerRun) throw new Error('discovery limit exceeds the source record bound')
  const [owner, repository] = feed.repository.split('/')
  const feedUrl = `https://github.com/${owner}/${repository}`
  const head = await github.api(`repos/${feed.repository}/commits/${encodeURIComponent(feed.branch)}`)
  if (!/^[a-f0-9]{40}$/.test(head?.sha ?? '')) throw new Error('feed Commit unavailable')

  let records = []
  let exclusions = new Set()
  if (feed.format === 'yaml-tree') {
    const tree = await github.api(`repos/${feed.repository}/git/trees/${head.sha}?recursive=1`)
    if (tree?.truncated || !Array.isArray(tree?.tree) || tree.tree.length > 50_000) throw new Error('feed tree exceeds bound')
    const matcher = new RegExp(feed.filePattern)
    const files = tree.tree.filter(item => item.type === 'blob' && item.mode === '100644' && matcher.test(item.path))
      .sort((a, b) => a.path.localeCompare(b.path))
    records = selectWindow(files, offset, limit).map(file => ({ path: file.path, kind: 'yaml' }))
  } else {
    const content = await github.raw(feedUrl, head.sha, feed.path, { maxBytes: feed.maxFileBytes })
    if (Buffer.byteLength(content) > feed.maxFileBytes) throw new Error('feed document exceeds bound')
    if (feed.format === 'markdown-table') {
      records = selectWindow(markdownRepositoryUrls(content, feed.sectionHeading), offset, limit)
        .map(url => ({ url, path: feed.path, kind: 'markdown' }))
    } else {
      let approved
      try { approved = JSON.parse(content) } catch { throw new Error('invalid JSON map feed document') }
      if (!approved || typeof approved !== 'object' || Array.isArray(approved)
        || Object.getPrototypeOf(approved) !== Object.prototype) throw new Error('invalid JSON map feed object')
      const entries = Object.entries(approved)
      if (!entries.length || entries.length > feed.maxEntries) throw new Error('JSON map feed exceeds entry bound')
      const available = new Map()
      for (const [repositoryKey, lastApproved] of entries) {
        const url = repositoryKeyUrl(repositoryKey)
        if (!url || !isDateOnly(lastApproved)) {
          throw new Error('invalid JSON map feed record')
        }
        const key = url.toLowerCase()
        if (available.has(key)) throw new Error('duplicate JSON map repository key')
        available.set(key, { url, repositoryKey, lastApproved })
      }
      const exclusionsContent = await github.raw(feedUrl, head.sha, feed.excludePath, { maxBytes: feed.excludeMaxFileBytes })
      if (Buffer.byteLength(exclusionsContent) > feed.excludeMaxFileBytes) throw new Error('feed exclusions exceed bound')
      let curated
      try { curated = JSON.parse(exclusionsContent) } catch { throw new Error('invalid JSON exclusion document') }
      if (!curated || typeof curated !== 'object' || Array.isArray(curated)
        || Object.getPrototypeOf(curated) !== Object.prototype) throw new Error('invalid JSON exclusion object')
      const excludedRows = curated[feed.excludeKey]
      if (!excludedRows || typeof excludedRows !== 'object' || Array.isArray(excludedRows)
        || Object.getPrototypeOf(excludedRows) !== Object.prototype
        || Object.keys(excludedRows).length > feed.maxEntries) throw new Error('invalid JSON exclusion map')
      for (const [repositoryKey, reason] of Object.entries(excludedRows)) {
        const url = repositoryKeyUrl(repositoryKey)
        if (!url || typeof reason !== 'string' || reason.length > 1_000) throw new Error('invalid JSON exclusion record')
        exclusions.add(url.toLowerCase())
      }
      const eligible = [...available.values()]
        .filter(item => !exclusions.has(item.url.toLowerCase()))
        .sort((a, b) => {
          const left = a.repositoryKey.toLowerCase()
          const right = b.repositoryKey.toLowerCase()
          return left < right ? -1 : left > right ? 1 : 0
        })
      if (stats && typeof stats === 'object') {
        stats.totalRecords = entries.length
        stats.excludedRecords = exclusions.size
        stats.excludedMatches = entries.length - eligible.length
      }
      records = selectWindow(eligible, offset, limit).map(item => ({
        url: item.url,
        path: feed.path,
        kind: 'json-map',
        repositoryKey: item.repositoryKey,
        lastApproved: item.lastApproved,
      }))
      if (stats && typeof stats === 'object') stats.selectedRecords = records.length
    }
  }
  if (stats && typeof stats === 'object') {
    stats.commit = head.sha
    if (feed.format !== 'json-map') stats.selectedRecords = records.length
  }

  const result = []
  const seen = new Set()
  const seenCanonical = new Set()
  for (const record of records) {
    let url
    let sourceBytes
    if (record.kind === 'yaml') {
      sourceBytes = await github.raw(feedUrl, head.sha, record.path, { maxBytes: feed.maxFileBytes })
      const urls = [...sourceBytes.matchAll(YAML_REPOSITORY_URL)]
      if (urls.length !== 1) continue
      url = parseCanonicalRepositoryUrl(urls[0][1])
    } else {
      url = record.url
      sourceBytes = record.kind === 'json-map'
        ? `${record.repositoryKey}\n${record.lastApproved}`
        : record.url
    }
    if (!url || url.toLowerCase() === feedUrl.toLowerCase() || seen.has(url.toLowerCase())) continue
    seen.add(url.toLowerCase())
    const [candidateOwner, candidateRepository] = url.slice('https://github.com/'.length).split('/')
    let metadata
    try {
      metadata = await github.api(`repos/${candidateOwner}/${candidateRepository}`)
    } catch (error) {
      // Community lists age: a deleted or renamed project should not discard
      // valid neighboring rows from the same pinned source snapshot.
      if (error?.status === 404 || error?.status === 410) continue
      throw error
    }
    const canonicalUrl = parseCanonicalRepositoryUrl(metadata?.html_url)
    if (metadata?.private || metadata?.archived || metadata?.disabled
      || !canonicalUrl || canonicalUrl.toLowerCase() === feedUrl.toLowerCase()
      || seenCanonical.has(canonicalUrl.toLowerCase())
      || !Number.isSafeInteger(metadata.owner?.id)) continue
    seenCanonical.add(canonicalUrl.toLowerCase())
    const contentSha = createHash('sha256').update(sourceBytes).digest('hex')
    const evidence = `github-feed:${feed.repository}@${head.sha}:${record.path}:sha256=${contentSha}:at=${observedAt}:owner=${metadata.owner.id}`
    result.push({
      ...metadata,
      html_url: canonicalUrl,
      discoveryOnly: true,
      discoverySourceKey: `github-feed:${feed.repository}`,
      discoverySources: [evidence],
      feedEvidence: evidence,
    })
  }
  if (stats && typeof stats === 'object') stats.liveRepositories = result.length
  return result
}

// Round-robin independently sourced candidates so one busy feed or GitHub search
// cannot consume the entire deterministic fixed-source scan budget.
export function orderDiscoveryCandidates(repositories, primarySourceKeys = []) {
  const primarySources = new Set(primarySourceKeys)
  const groups = new Map()
  const primaryGroups = new Map()
  for (const item of repositories) {
    const itemSources = Array.isArray(item.discoverySourceKeys) && item.discoverySourceKeys.length
      ? item.discoverySourceKeys
      : [item.discoverySourceKey ?? (item.discoveryOnly ? 'github-feed:legacy' : 'github-search')]
    const primary = itemSources.find(source => primarySources.has(source))
    const source = primary ? `0-primary:${primary}` : (item.discoverySourceKey ?? itemSources[0])
    const target = primary ? primaryGroups : groups
    if (!target.has(source)) target.set(source, [])
    target.get(source).push(item)
  }
  for (const items of [...primaryGroups.values(), ...groups.values()]) {
    items.sort((a, b) => Date.parse(b.updated_at ?? 0) - Date.parse(a.updated_at ?? 0))
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, items]) => items)
  const result = [...primaryGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, items]) => items)
  for (let index = 0; orderedGroups.some(group => index < group.length); index += 1) {
    for (const group of orderedGroups) if (group[index]) result.push(group[index])
  }
  return result
}
