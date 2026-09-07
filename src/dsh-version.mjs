import { readFile, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { compareVersions } from './catalog.mjs'
import { fetchOfficialDshMetadata, officialDshChannels } from './dsh-release-policy.mjs'

const PACKAGE_NAME = '@deepseek-ai/dsh'
const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
const RELEASE_URL = 'https://github.com/deepseek-ai/deepseek-harness/releases'
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function versionError(code, message) {
  return Object.assign(new Error(message), { code })
}

async function findCliManifest(cliPath) {
  let resolvedCliPath
  try {
    resolvedCliPath = await realpath(resolve(cliPath))
  } catch {
    throw versionError('DSH_VERSION_UNAVAILABLE', '无法解析当前 DSH CLI 路径。')
  }
  let directory = dirname(resolvedCliPath)
  for (let depth = 0; depth < 7; depth += 1) {
    try {
      const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
      if (manifest?.name === PACKAGE_NAME && VERSION.test(manifest?.version ?? '')) {
        const normalized = directory.replaceAll('\\', '/')
        return {
          version: manifest.version,
          installationKind: /\/apps\/cli(?:\/|$)/.test(normalized) ? 'source-checkout'
            : normalized.includes('/.pnpm/') ? 'pnpm-global' : 'package',
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw versionError('DSH_VERSION_UNAVAILABLE', '无法从当前 DSH CLI 定位 @deepseek-ai/dsh 版本。')
}

async function latestVersion(request, timeoutMs) {
  try {
    const { metadata, githubReleases } = await fetchOfficialDshMetadata({ fetch: request, timeoutMs })
    return officialDshChannels(metadata, githubReleases)
  } catch (error) {
    throw versionError('DSH_VERSION_REGISTRY_INVALID', `官方版本检测未完成：${error.message}`)
  }
}

export function createDshVersionService(options = {}) {
  const cliPath = options.cliPath
  const request = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 8_000
  const cacheTtlMs = options.cacheTtlMs ?? 10 * 60_000
  const now = options.now ?? Date.now
  let cache = null

  async function inspect({ force = false } = {}) {
    if (!force && cache && now() - cache.checkedAt < cacheTtlMs) return { ...cache.value, cacheStatus: 'hit' }
    const current = await findCliManifest(cliPath)
    const official = await latestVersion(request, timeoutMs)
    const latest = official.target
    const comparison = compareVersions(current.version, latest.version)
    const updateAvailable = comparison !== null && comparison < 0
    const command = latest.npmAvailable ? ['npm', 'install', '--global', `${PACKAGE_NAME}@${latest.version}`] : []
    const preview = latest.kind === 'preview'
    const value = {
      schemaVersion: 1, packageName: PACKAGE_NAME,
      currentVersion: current.version, latestVersion: latest.version, stableVersion: official.stable.version,
      latestSource: latest.source === 'github-release' ? 'github-official:release' : `npm-official:${latest.tag}`, releaseChannel: latest.kind, releaseTag: latest.tag,
      npmVersion: official.npmVersion, npmAvailable: latest.npmAvailable,
      channels: official.channels, registryUrl: REGISTRY_URL, cacheTtlMs,
      installationKind: current.installationKind,
      status: updateAvailable ? 'update-available' : comparison === 0 ? 'current' : 'ahead',
      updateAvailable, checkedAt: new Date(now()).toISOString(), releaseUrl: latest.releaseUrl ?? RELEASE_URL,
      upgrade: {
        executable: false, command, commandText: command.join(' '),
        reason: !latest.npmAvailable
          ? `官方 GitHub 已发布 ${latest.version}，npm 当前可用版本仍为 ${official.npmVersion}。请查看官方 Release；该版本尚无可复制的 npm 升级命令。`
          : current.installationKind === 'source-checkout'
          ? '当前 Host 来自 DSH 源码工作区；商城不会修改 DSH 源码。可查看官方 Release，或复制 npm 固定版本安装命令作为独立安装。'
          : preview
            ? `官方 npm 已提供预发布版本 ${latest.version}。商城只提供固定版本命令，不静默执行全局包管理器。`
          : '官方 DSH CLI 暂无自升级子命令；商城只提供固定版本命令，不静默执行全局包管理器。',
      },
    }
    cache = { checkedAt: now(), value }
    return { ...value, cacheStatus: 'fresh' }
  }

  function peek() {
    return cache ? { ...cache.value, cacheStatus: 'peek' } : null
  }

  return { inspect, peek }
}
