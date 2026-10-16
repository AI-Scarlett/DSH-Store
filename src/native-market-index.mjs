import { canonicalGithubRepository, dshReleaseVersion } from './catalog.mjs'

// A projection of approved Catalog entries, never the broader discovery feed.
// Exact declarations avoid widening old, unknown or truncated source ranges.
export function createNativeMarketIndex(catalog) {
  const names = new Set()
  const plugins = catalog.entries.filter(entry => entry.status === 'approved').flatMap(entry => {
    if (!/^[0-9a-f]{40}$/.test(entry.commit ?? '')) throw new Error(`Native market requires a fixed Commit: ${entry.id}`)
    if (!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(entry.packageName ?? '')
      || entry.packageName.length > 214 || names.has(entry.packageName)) throw new Error(`Native market package identity is invalid or duplicated: ${entry.id}`)
    names.add(entry.packageName)
    const url = canonicalGithubRepository(entry.repositoryUrl)
    const path = entry.installPath || undefined
    if (path && path.split('/').some(part => !/^[A-Za-z0-9._@+-]+$/.test(part) || ['.', '..'].includes(part))) {
      throw new Error(`Native market package path is unsafe: ${entry.id}`)
    }
    if (entry.manifestPath !== (path ? `${path}/package.json` : 'package.json')) throw new Error(`Native market manifest path differs: ${entry.id}`)
    const published = Date.parse(entry.source?.updatedAt)
    if (!Number.isFinite(published) || published < 0 || entry.source?.provenance !== 'github-commit') {
      throw new Error(`Native market requires Git Commit publication evidence: ${entry.id}`)
    }
    const releases = [...new Set(Object.entries(entry.compatibility?.dshReleases ?? {})
      .filter(([, status]) => status === 'compatible').map(([release]) => {
        const version = dshReleaseVersion(release)
        if (!version) throw new Error(`Native market release is invalid: ${entry.id}`)
        return version
      }))].sort()
    if (!releases.length) return [] // No supported runtime is established; do not expose an install target.
    return [{
      name: entry.packageName,
      title: entry.name,
      description: entry.description,
      author: new URL(url).pathname.split('/')[1],
      homepage: url,
      repository: { url, ...(path ? { directory: path } : {}) },
      versions: [{
        version: entry.version,
        publishTimestamp: Math.floor(published / 1000),
        source: { type: 'git', url, commit: entry.commit, ...(path ? { path } : {}) },
        engines: { dsh: releases.join(' || ') },
      }],
    }]
  })
  return {
    format: 1,
    title: { en: 'DSH STORE', zh: 'DSH STORE 插件商城' },
    description: {
      en: 'Approved fixed-Commit Catalog entries. Compatibility declarations do not establish runtime or security acceptance.',
      zh: '仅包含已批准的固定 Commit 条目；兼容性声明不等于运行验收或安全审计。',
    },
    plugins,
  }
}

export function validateNativeMarketIndex(value, catalog) {
  const expected = createNativeMarketIndex(catalog)
  if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Native market differs from the approved Catalog projection')
  return value
}
