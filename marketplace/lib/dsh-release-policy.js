export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'
export const DSH_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
export const DSH_RELEASES_URL = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100'
export const DSH_RELEASE_WINDOW_AUTHORITY = 'official-github-releases-and-npm-published-versions'

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const SUPPORTED_PRERELEASE_LANES = new Set(['alpha', 'beta', 'rc'])
const COMPATIBILITY_CHANNELS = Object.freeze([
  Object.freeze({ tag: 'latest', kind: 'stable' }),
  // Release candidates are published on npm's next channel; the channel name
  // and the version suffix are independent.
  Object.freeze({ tag: 'next', kind: 'preview' }),
  Object.freeze({ tag: 'alpha', kind: 'preview' }),
  Object.freeze({ tag: 'beta', kind: 'preview' }),
  Object.freeze({ tag: 'rc', kind: 'preview' }),
])
const DEFAULT_RELEASE_COUNT = 3
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAX_BYTES = 1024 * 1024

function parseVersion(value) {
  const match = VERSION.exec(value ?? '')
  return match ? {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  } : null
}

function versionSeries(value) {
  const parsed = parseVersion(value)
  return parsed ? parsed.numbers.slice(0, 2).join('.') : null
}

export function compareDshVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  for (let index = 0; index < a.numbers.length; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function packageMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('official DSH package metadata must be an object')
  if (metadata.name !== DSH_PACKAGE_NAME) throw new Error('official DSH package metadata has an unexpected package name')
  if (!metadata['dist-tags'] || typeof metadata['dist-tags'] !== 'object' || Array.isArray(metadata['dist-tags'])) {
    throw new Error('official DSH package metadata does not declare dist-tags')
  }
  if (!metadata.versions || typeof metadata.versions !== 'object' || Array.isArray(metadata.versions)) {
    throw new Error('official DSH package metadata does not declare published versions')
  }
  return metadata
}

function channelRecords(metadata, channels) {
  return channels.flatMap(channel => {
    const version = metadata['dist-tags'][channel.tag]
    if (version === undefined) return []
    const record = metadata.versions[version]
    if (!parseVersion(version) || !record || typeof record !== 'object' || Array.isArray(record) || typeof record.deprecated === 'string') {
      throw new Error(`official DSH ${channel.tag} dist-tag is unavailable or deprecated`)
    }
    return [{ ...channel, kind: parseVersion(version).prerelease.length ? 'preview' : 'stable', version }]
  })
}

export function officialDshChannels(metadata, githubReleases = []) {
  const value = packageMetadata(metadata)
  const channels = channelRecords(value, COMPATIBILITY_CHANNELS)
  const stable = channels.find(channel => channel.tag === 'latest')
  if (!stable) throw new Error('official DSH package metadata does not declare a trusted latest dist-tag')
  // Dist-tags are hints, not a stable naming contract. Use published version
  // records as the authority and choose the highest non-deprecated supported
  // release in the current DSH major.minor line. This prevents a future
  // next-only 0.2.x release from displacing the active 0.1.x line.
  const referenceVersion = channels
    .filter(channel => channel.tag !== 'next')
    .map(channel => channel.version)
    .filter(version => supportedPublishedVersion(version, value.versions[version]))
    .reduce((current, version) => (
      (compareDshVersions(version, current) ?? -1) > 0 ? version : current
    ), stable.version)
  const releaseSeries = versionSeries(referenceVersion)
  const candidates = Object.entries(value.versions)
    .filter(([version, record]) => supportedPublishedVersion(version, record))
    .filter(([version]) => versionSeries(version) === releaseSeries)
    .map(([version]) => version)
  const npmVersion = candidates.reduce((current, version) => (
    (compareDshVersions(version, current) ?? -1) > 0 ? version : current
  ), stable.version)
  const releases = officialGithubDshReleases(githubReleases)
    .filter(release => versionSeries(release.version) === releaseSeries)
    .filter(release => typeof value.versions[release.version]?.deprecated !== 'string')
  const newestRelease = releases[0]
  const latestVersion = newestRelease && compareDshVersions(newestRelease.version, npmVersion) > 0
    ? newestRelease.version : npmVersion
  const taggedTarget = channels.find(channel => channel.version === latestVersion)
  const target = taggedTarget ?? {
    tag: 'version',
    kind: parseVersion(latestVersion)?.prerelease.length ? 'preview' : 'stable',
    version: latestVersion,
  }
  const npmAvailable = supportedPublishedVersion(latestVersion, value.versions[latestVersion])
  return {
    stable, channels, npmVersion,
    target: {
      ...target,
      kind: parseVersion(latestVersion)?.prerelease.length ? 'preview' : 'stable',
      source: npmAvailable ? 'npm' : 'github-release',
      npmAvailable,
      releaseUrl: releases.find(release => release.version === latestVersion)?.url ?? null,
    },
    githubReleases: releases,
  }
}

// Only published DSH releases in the official repository may advance the
// compatibility window. A Release is not proof that its npm package exists.
export function officialGithubDshReleases(payload) {
  if (!Array.isArray(payload) || payload.length > 100) throw new Error('official DSH releases response is invalid or exceeds the bound')
  const versions = new Set()
  const releases = []
  for (const release of payload) {
    if (!release || typeof release !== 'object' || release.draft !== false) continue
    const version = /^dsh-v(.+)$/.exec(release.tag_name ?? '')?.[1]
    if (!version || !supportedPublishedVersion(version, {})) continue
    const url = `https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v${version}`
    if (release.html_url !== url || !Number.isFinite(Date.parse(release.published_at))) {
      throw new Error('official DSH release identity or publication date is invalid')
    }
    if (versions.has(version)) throw new Error('official DSH releases contain a duplicate version')
    versions.add(version)
    releases.push({ version, url, publishedAt: release.published_at })
  }
  return releases.sort((a, b) => compareDshVersions(b.version, a.version))
}

function releaseCount(value) {
  if (value === undefined) return DEFAULT_RELEASE_COUNT
  if (!Number.isInteger(value) || value < 1 || value > 12) throw new Error('official DSH release window count is invalid')
  return value
}

function supportedPublishedVersion(version, record, latestVersion = null) {
  const parsed = parseVersion(version)
  if (!parsed || !record || typeof record !== 'object' || Array.isArray(record)) return false
  if (typeof record.deprecated === 'string') return false
  if (latestVersion !== null && (compareDshVersions(version, latestVersion) ?? 1) > 0) return false
  if (parsed.prerelease.length === 0) return true
  return SUPPORTED_PRERELEASE_LANES.has(parsed.prerelease[0])
}

export function officialDshReleaseWindow(metadata, requestedCount = DEFAULT_RELEASE_COUNT, githubReleases = []) {
  const value = packageMetadata(metadata)
  const { stable, target, channels, githubReleases: releases, npmVersion } = officialDshChannels(value, githubReleases)
  const count = releaseCount(requestedCount)
  const versions = [...new Set([...Object.entries(value.versions)
    .filter(([version, record]) => supportedPublishedVersion(version, record, target.version))
    .map(([version]) => version), ...releases.map(release => release.version)])]
    .filter(version => (compareDshVersions(version, target.version) ?? 1) <= 0)
    .sort((left, right) => compareDshVersions(left, right) ?? left.localeCompare(right, 'en'))
  if (!versions.includes(target.version)) throw new Error('official DSH target release is unavailable')
  if (versions.length < count) throw new Error(`official DSH registry exposes fewer than ${count} supported active releases`)
  return {
    packageName: DSH_PACKAGE_NAME,
    registryUrl: DSH_REGISTRY_URL,
    authority: DSH_RELEASE_WINDOW_AUTHORITY,
    releasesUrl: DSH_RELEASES_URL,
    npmVersion,
    npmAvailable: target.npmAvailable,
    stableVersion: stable.version,
    latestVersion: target.version,
    releaseTag: target.tag,
    releaseChannel: target.kind,
    releases: versions.slice(-count),
    releaseCount: count,
    channels,
  }
}

export async function fetchOfficialDshReleaseWindow(options = {}) {
  const { metadata, githubReleases } = await fetchOfficialDshMetadata(options)
  return officialDshReleaseWindow(metadata, options.releaseCount, githubReleases)
}

export async function fetchOfficialDshMetadata(options = {}) {
  const request = options.fetch ?? globalThis.fetch
  if (typeof request !== 'function') throw new Error('official DSH registry fetch is unavailable')
  const registryUrl = options.registryUrl ?? DSH_REGISTRY_URL
  if (registryUrl !== DSH_REGISTRY_URL) throw new Error('official DSH registry URL does not match the policy authority')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const metadata = await readOfficialJson(request, registryUrl, 'registry', controller.signal, options)
    packageMetadata(metadata)
    const githubReleases = await readOfficialJson(request, DSH_RELEASES_URL, 'releases', controller.signal, options)
    officialGithubDshReleases(githubReleases)
    return { metadata, githubReleases }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('official DSH registry request timed out')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function readOfficialJson(request, url, label, signal, options) {
  const headers = { accept: label === 'registry' ? 'application/vnd.npm.install-v1+json' : 'application/vnd.github+json', 'user-agent': 'dsh-safe-plugin-manager' }
  if (label === 'releases' && options.githubToken) headers.authorization = `Bearer ${options.githubToken}`
  const response = await request(url, { headers, signal, redirect: 'error' })
  if (!response.ok) throw new Error(`official DSH ${label} returned HTTP ${response.status}`)
  const maximum = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (Number(response.headers?.get?.('content-length')) > maximum) throw new Error(`official DSH ${label} response exceeded the automation bound`)
  let text
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let bytes = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maximum) throw new Error(`official DSH ${label} response exceeded the automation bound`)
        chunks.push(value)
      }
      const joined = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
      text = new TextDecoder().decode(joined)
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } else {
    text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maximum) throw new Error(`official DSH ${label} response exceeded the automation bound`)
  }
  try { return JSON.parse(text) } catch { throw new Error(`official DSH ${label} returned invalid JSON`) }
}
