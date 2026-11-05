import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateRankingSnapshot } from '../../marketplace/rankings/model.js'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const observedAt = '2026-11-05T05:00:00.000Z'

function entry(id, repositoryUrl, stars, { reviewStatus = 'approved', source = 'catalog' } = {}) {
  const listed = source === 'catalog' && reviewStatus === 'approved'
  return {
    id,
    nameZh: id,
    nameEn: id,
    version: listed ? '1.0.0' : '',
    repositoryUrl,
    description: `Fixture ${id}`,
    categories: ['tools'],
    listingStatus: listed ? 'listed' : 'not-listed',
    listingReason: listed ? null : 'Fixture entry is not listed.',
    source,
    reviewStatus,
    stars,
    weeklyStars: stars,
    weeklySnapshotMember: true,
    weeklyCategories: ['tools'],
  }
}

export function createRankingReleaseSnapshot(sourceCommit = 'a'.repeat(40)) {
  const entries = [
    entry('store', 'https://github.com/AI-Scarlett/DSH-Store', 2000),
    entry('build-dsh-plugin', 'https://github.com/AI-Scarlett/build-dsh-plugin', 1900),
    ...Array.from({ length: 14 }, (_, index) => {
      const id = `plugin-${String(index + 1).padStart(2, '0')}`
      return entry(id, `https://github.com/example/${id}`, 1000 - index)
    }),
    entry('blocked-plugin', 'https://github.com/example/blocked-plugin', 50000, { reviewStatus: 'blocked' }),
    entry('rejected-plugin', 'https://github.com/example/rejected-plugin', 49000, { reviewStatus: 'rejected', source: 'candidate' }),
  ]
  return validateRankingSnapshot({
    schemaVersion: 4,
    sourceCommit,
    catalogUpdatedAt: observedAt,
    candidatesUpdatedAt: observedAt,
    starsObservedAt: observedAt,
    weeklyStarsObservedAt: observedAt,
    categories: [{ id: 'tools', zh: '工具', en: 'Tools' }],
    entries,
  })
}

export async function writeRankingReleaseFixture(directory, { sourceCommit = 'a'.repeat(40) } = {}) {
  const rankingsDirectory = join(directory, 'marketplace', 'rankings')
  await mkdir(rankingsDirectory, { recursive: true, mode: 0o700 })
  const snapshot = createRankingReleaseSnapshot(sourceCommit)
  const rankingBytes = Buffer.from(`${JSON.stringify(snapshot)}\n`)
  const rankingDigest = hash(rankingBytes)
  const htmlBytes = Buffer.from(`<!doctype html><meta name="dsh-rankings-sha256" content="${rankingDigest}"><!-- DSH_SERVER_ARTICLES_NAV -->`)
  const rankingPath = 'marketplace/rankings/data.json'
  const htmlPath = 'marketplace/rankings/index.html'
  await writeFile(join(directory, rankingPath), rankingBytes, { mode: 0o600 })
  await writeFile(join(directory, htmlPath), htmlBytes, { mode: 0o600 })
  const manifest = {
    schemaVersion: 1,
    generatedAt: observedAt,
    sourceCommit,
    files: {
      [rankingPath]: { sha256: rankingDigest, size: rankingBytes.length },
      [htmlPath]: { sha256: hash(htmlBytes), size: htmlBytes.length },
    },
  }
  await writeFile(join(directory, 'release-manifest.json'), `${JSON.stringify(manifest)}\n`, { mode: 0o600 })
  return { snapshot, manifest, rankingBytes, htmlBytes }
}
