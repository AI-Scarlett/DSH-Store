#!/usr/bin/env node

import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchOfficialDshReleaseWindow } from '../src/dsh-release-policy.mjs'

export async function resolveDshUpgradeMatrix(fetchWindow = fetchOfficialDshReleaseWindow) {
  const window = await fetchWindow({ releaseCount: 3 })
  if (window?.authority !== 'official-github-releases-and-npm-published-versions'
    || window?.releaseCount !== 3
    || !Array.isArray(window.releases)
    || window.releases.length !== 3
    || window.latestVersion !== window.releases[2]) {
    throw new Error('official DSH authority did not return a complete ordered latest-three window')
  }
  return {
    latestVersion: window.latestVersion,
    releases: [...window.releases],
    previousReleases: window.releases.slice(0, 2),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const matrix = await resolveDshUpgradeMatrix()
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, [
      `latest_version=${matrix.latestVersion}`,
      `releases=${JSON.stringify(matrix.releases)}`,
      `previous_releases=${JSON.stringify(matrix.previousReleases)}`,
      '',
    ].join('\n'))
  }
  process.stdout.write(`${JSON.stringify(matrix)}\n`)
}
