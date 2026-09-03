export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'
export const DSH_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
export const DSH_RELEASE_WINDOW_AUTHORITY = 'official-npm-registry-active-supported-channels-through-highest'

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
    return [{ ...channel, version }]
  })
}

export function officialDshChannels(metadata) {
  const value = packageMetadata(metadata)
  const channels = channelRecords(value, COMPATIBILITY_CHANNELS)
  const stable = channels.find(channel => channel.tag === 'latest')
  if (!stable) throw new Error('official DSH package metadata does not declare a trusted latest dist-tag')
  // Dist-tags are hints, not a stable naming contract. Use published version
  // records as the authority and choose the highest non-deprecated supported
  // DSH release.
  const candidates = Object.entries(value.versions)
    .filter(([version, record]) => supportedPublishedVersion(version, record))
    .map(([version]) => version)
  const latestVersion = candidates.reduce((current, version) => (
    (compareDshVersions(version, current) ?? -1) > 0 ? version : current
  ), stable.version)
  const taggedTarget = channels.find(channel => channel.version === latestVersion)
  const target = taggedTarget ?? {
    tag: 'version',
    kind: parseVersion(latestVersion)?.prerelease.length ? 'preview' : 'stable',
    version: latestVersion,
  }
  return { stable, target, channels }
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
  if ((compareDshVersions(version, latestVersion) ?? 1) > 0) return false
  if (parsed.prerelease.length === 0) return true
  return SUPPORTED_PRERELEASE_LANES.has(parsed.prerelease[0])
}

export function officialDshReleaseWindow(metadata, requestedCount = DEFAULT_RELEASE_COUNT) {
  const value = packageMetadata(metadata)
  const { stable, target, channels } = officialDshChannels(value)
  const count = releaseCount(requestedCount)
  const versions = Object.entries(value.versions)
    .filter(([version, record]) => supportedPublishedVersion(version, record, target.version))
    .map(([version]) => version)
    .sort((left, right) => compareDshVersions(left, right) ?? left.localeCompare(right, 'en'))
  if (!versions.includes(target.version)) throw new Error('official DSH target release is unavailable')
  if (versions.length < count) throw new Error(`official DSH registry exposes fewer than ${count} supported active releases`)
  return {
    packageName: DSH_PACKAGE_NAME,
    registryUrl: DSH_REGISTRY_URL,
    authority: DSH_RELEASE_WINDOW_AUTHORITY,
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
  const request = options.fetch ?? globalThis.fetch
  if (typeof request !== 'function') throw new Error('official DSH registry fetch is unavailable')
  const registryUrl = options.registryUrl ?? DSH_REGISTRY_URL
  if (registryUrl !== DSH_REGISTRY_URL) throw new Error('official DSH registry URL does not match the policy authority')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await request(registryUrl, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-safe-plugin-manager-catalog-automation' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`official DSH registry returned HTTP ${response.status}`)
    const text = await response.text()
    if (Buffer.byteLength(text) > (options.maxBytes ?? DEFAULT_MAX_BYTES)) throw new Error('official DSH registry response exceeded the automation bound')
    let metadata
    try { metadata = JSON.parse(text) } catch { throw new Error('official DSH registry returned invalid JSON') }
    return officialDshReleaseWindow(metadata, options.releaseCount)
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('official DSH registry request timed out')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
