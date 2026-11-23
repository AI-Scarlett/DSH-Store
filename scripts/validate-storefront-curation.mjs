#!/usr/bin/env node
/**
 * Validate the committed storefront curation file.
 *
 * This script is intentionally offline and deterministic: it validates the
 * schema, bounds and board/extra wiring only. Catalog eligibility and star
 * availability are re-checked by the static build, which drops stale ids and
 * falls back to an automatic board when a manual board becomes empty.
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeStorefrontCuration, RANKING_TYPES } from '../marketplace/rankings/model.js'

export const MAX_STOREFRONT_CURATION_BYTES = 256 * 1024

export function parseStorefrontCurationBytes(bytes) {
  if (!bytes || bytes.byteLength === 0) throw new Error('registry/storefront-curation.json is empty')
  if (bytes.byteLength > MAX_STOREFRONT_CURATION_BYTES) throw new Error('registry/storefront-curation.json exceeds 256 KiB')
  let value
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('registry/storefront-curation.json is not valid JSON') }
  const curation = normalizeStorefrontCuration(value)
  if (curation.revision > 0 && !curation.updatedAt) throw new Error('Curation revision requires updatedAt')
  return curation
}

export async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const path = resolve(root, 'registry/storefront-curation.json')
  const curation = parseStorefrontCurationBytes(await readFile(path))
  const boards = RANKING_TYPES.map(type => `${type}=${curation.boards[type].mode}${curation.boards[type].ids.length ? `/${curation.boards[type].ids.length}` : ''}`).join(',')
  console.log(`STOREFRONT_CURATION_OK revision=${curation.revision} featured=${curation.home.featured.length} extras=${curation.extras.length} ${boards}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
