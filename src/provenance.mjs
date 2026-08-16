import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function readMarketplaceProvenance(dshHome, profile) {
  const managed = new Set()
  let text
  try {
    text = await readFile(join(dshHome, 'dsh-safe-plugin-manager', 'history.jsonl'), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return managed
    throw error
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event?.status !== 'applied' || event?.profile !== profile || typeof event?.packageName !== 'string') continue
    if (event.action === 'install' || event.action === 'update') managed.add(event.packageName)
    if (event.action === 'uninstall') managed.delete(event.packageName)
  }
  return managed
}
