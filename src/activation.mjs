import { readProfileInventory } from './inventory.mjs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readManagedDisabledIds } from './managed-patch.mjs'
export function classifyActivation({ plugin, entryIds, disabledIds = [], rows = null, baseline = null, bootId }) {
  const evidence = { bootId, version: plugin.version, status: 'unknown' }
  if (!plugin.installed) return { ...evidence, status: 'missing' }
  if (entryIds?.length && entryIds.every(id => disabledIds.includes(id))) return { ...evidence, status: 'disabled' }
  if (baseline && (baseline.version !== plugin.version || baseline.declaredSpecifier !== plugin.declaredSpecifier)) return { ...evidence, status: 'restart' }
  if (!baseline) return { ...evidence, status: 'restart' }
  if (!plugin.declaredAsBundle) return { ...evidence, status: 'inert' }
  if (!entryIds?.length || !Array.isArray(rows)) return evidence
  const matches = entryIds.map(id => rows.filter(row => row.id === id || row.id.endsWith(`:${id}`)))
  if (matches.some(items => items.length > 1)) return evidence
  if (matches.some(items => items.length === 0)) return { ...evidence, status: 'inert' }
  if (matches.some(items => items[0].state === 3)) return { ...evidence, status: 'broken' }
  if (matches.every(items => items[0].state === 2) && plugin.version) return { ...evidence, status: 'live' }
  return evidence
}
export function createActivationService({ dshHome, profile, bootId, readRows }) {
  const baseline = readProfileInventory({ dshHome, profile }).catch(() => null)
  return { async inspect(catalog) {
    const initial = await baseline
    const inventory = await readProfileInventory({ dshHome, profile })
    let disabledIds = []
    try { disabledIds = readManagedDisabledIds(await readFile(join(dshHome, 'profiles', profile, 'cordis.patch.yml'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const rows = readRows()
    return inventory.plugins.map(plugin => ({ packageName: plugin.packageName, ...classifyActivation({ plugin,
      entryIds: catalog.entries.find(entry => entry.packageName === plugin.packageName)?.entryIds,
      disabledIds, rows, baseline: initial?.plugins.find(entry => entry.packageName === plugin.packageName), bootId,
    }) }))
  } }
}
