import { canonicalGithubRepository } from './catalog.mjs'

// A projection of approved Catalog entries, never the broader discovery feed.
// Store compatibility evidence is advisory; DSH owns the final install check.
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
    const compatibilityNeedsReview = entry.compatibility?.latestWindow?.state !== 'current'
    return [{
      name: entry.packageName,
      title: entry.name,
      description: entry.description,
      author: new URL(url).pathname.split('/')[1],
      homepage: url,
      repository: { url, ...(path ? { directory: path } : {}) },
      metadata: {
        labels: [
          'dsh-install-check',
          ...(compatibilityNeedsReview ? ['store-compatibility-review'] : []),
        ],
      },
      versions: [{
        version: entry.version,
        publishTimestamp: Math.floor(published / 1000),
        source: { type: 'git', url, commit: entry.commit, ...(path ? { path } : {}) },
      }],
    }]
  })
  return {
    format: 1,
    title: { en: 'DSH STORE', zh: 'DSH STORE 插件商城' },
    description: {
      en: 'The Store reviews pinned sources and provides compatibility advice. DSH performs its own compatibility checks, asks for installation confirmation, and reports the final result.',
      zh: 'Store 审核固定来源并提供兼容性建议；最终由 DSH 检查插件要求、展示安装确认并返回安装结果。',
    },
    metadata: {
      labels: {
        'dsh-install-check': {
          title: { en: 'DSH install check', zh: '由 DSH 最终检查' },
        },
        'store-compatibility-review': {
          title: { en: 'Store compatibility review needed', zh: '商城兼容性待复核' },
        },
      },
    },
    plugins,
  }
}

export function validateNativeMarketIndex(value, catalog) {
  const expected = createNativeMarketIndex(catalog)
  if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('Native market differs from the approved Catalog projection')
  return value
}
