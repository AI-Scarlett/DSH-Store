import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { resolveProfileDirectory } from './inventory.mjs'

const INSERT_ID = /(?:^|\n)\s*-?\s*insert:\s*(?:\n[^\n]*){0,8}?\n\s*id:\s*["']?([^\s"'#]+)/g

function entryIds(text) {
  const ids = []
  for (const match of text.matchAll(INSERT_ID)) ids.push(match[1])
  return ids
}

async function optionalText(path) {
  try { return await readFile(path, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

export async function inspectColdStartContract(options = {}) {
  const profileDir = resolveProfileDirectory(options.dshHome, options.profile ?? 'web')
  const sources = []
  const profilePatch = await optionalText(join(profileDir, 'cordis.patch.yml'))
  if (profilePatch !== null) sources.push({ kind: 'profile-patch', packageName: null, ids: entryIds(profilePatch) })
  for (const plugin of options.inventory?.plugins ?? []) {
    if (!plugin.installed || typeof plugin.manifestPath !== 'string') continue
    let manifest
    try { manifest = JSON.parse(await readFile(plugin.manifestPath, 'utf8')) } catch { continue }
    const relative = manifest?.dsh?.bundle?.patch
    if (typeof relative !== 'string' || relative.trim() === '') continue
    const base = dirname(plugin.manifestPath)
    const patchPath = isAbsolute(relative) ? relative : resolve(base, relative)
    if (patchPath !== base && !patchPath.startsWith(`${base}/`)) continue
    const patch = await optionalText(patchPath)
    if (patch !== null) sources.push({ kind: 'bundle-patch', packageName: plugin.packageName, ids: entryIds(patch) })
  }
  const owners = new Map()
  for (const source of sources) for (const id of source.ids) {
    const values = owners.get(id) ?? []
    values.push({ kind: source.kind, packageName: source.packageName })
    owners.set(id, values)
  }
  const collisions = [...owners.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([id, values]) => ({ id, sources: values }))
  return {
    status: collisions.length > 0 ? 'error' : 'pass',
    message: collisions.length > 0
      ? `检测到 ${collisions.length} 个冷启动重复入口，禁止重启。`
      : `已核对 ${owners.size} 个 Bundle/Profile 入口，未发现重复 ID。`,
    collisions,
  }
}
