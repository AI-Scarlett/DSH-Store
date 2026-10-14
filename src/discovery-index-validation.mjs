import { gunzipSync } from 'node:zlib'

const MAX_DISCOVERY_BYTES = 64 * 1024 * 1024
const MAX_DISCOVERY_RECORDS = 50_000
const SOURCE_NAME = 'dsh.so public discovery index'
const SOURCE_URL = 'https://www.dsh.so/plugins-index.json'
const ATTRIBUTION = 'dsh.so — DSH Developer Hub (https://www.dsh.so)'
const ENTRY_KEYS = ['sourceIndex', 'sourceId', 'alias', 'name', 'description', 'stars', 'categories', 'kind', 'repositoryUrl', 'detailUrl']

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}

function boundedString(value, { min = 0, max }) {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function validRepository(value) {
  if (value === null) return true
  if (!boundedString(value, { min: 1, max: 300 })) return false
  try {
    const url = new URL(value)
    const parts = url.pathname.split('/').filter(Boolean)
    return url.protocol === 'https:' && url.hostname === 'github.com'
      && !url.username && !url.password && !url.search && !url.hash
      && parts.length === 2
      && parts.every(part => /^[A-Za-z0-9_.-]+$/.test(part))
      && !parts[1].toLowerCase().endsWith('.git')
      && value === `https://github.com/${parts[0]}/${parts[1]}`
  } catch {
    return false
  }
}

function validDetail(value) {
  if (!boundedString(value, { min: 1, max: 2_000 })) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'www.dsh.so'
      && url.pathname.startsWith('/artifact/') && url.pathname.endsWith('/')
      && !url.username && !url.password && !url.search && !url.hash
      && value === url.href
  } catch {
    return false
  }
}

function validateEntry(entry, index) {
  if (!exactKeys(entry, ENTRY_KEYS)) throw new Error(`discovery entry ${index} has an unexpected shape`)
  if (entry.sourceIndex !== index
    || !boundedString(entry.sourceId, { min: 1, max: 240 })
    || !boundedString(entry.alias, { max: 500 })
    || !boundedString(entry.name, { min: 1, max: 240 })
    || !boundedString(entry.description, { max: 221 })
    || !Number.isSafeInteger(entry.stars) || entry.stars < 0
    || !Array.isArray(entry.categories) || entry.categories.length < 1 || entry.categories.length > 64
    || entry.categories.some(category => !boundedString(category, { min: 1, max: 48 })
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category))
    || new Set(entry.categories).size !== entry.categories.length
    || !boundedString(entry.kind, { min: 1, max: 80 })
    || !validRepository(entry.repositoryUrl)
    || !validDetail(entry.detailUrl)) {
    throw new Error(`discovery entry ${index} failed bounded field validation`)
  }
}

export function validateDiscoveryIndexSnapshot(rawBytes, compressedBytes) {
  if (!Buffer.isBuffer(rawBytes) || !Buffer.isBuffer(compressedBytes)
    || rawBytes.length === 0 || rawBytes.length > MAX_DISCOVERY_BYTES
    || compressedBytes.length === 0 || compressedBytes.length > MAX_DISCOVERY_BYTES) {
    throw new Error('discovery index files must be non-empty Buffers within the 64 MiB bound')
  }

  let decompressed
  try {
    decompressed = gunzipSync(compressedBytes, { maxOutputLength: MAX_DISCOVERY_BYTES })
  } catch {
    throw new Error('discovery index gzip is malformed or exceeds the 64 MiB bound')
  }
  if (!decompressed.equals(rawBytes)) throw new Error('discovery index gzip does not exactly match the JSON snapshot')

  let snapshot
  try {
    snapshot = JSON.parse(rawBytes.toString('utf8'))
  } catch {
    throw new Error('discovery index JSON is malformed')
  }
  if (!exactKeys(snapshot, ['schemaVersion', 'source', 'entries']) || snapshot.schemaVersion !== 1
    || !exactKeys(snapshot.source, ['name', 'url', 'generatedAt', 'recordCount', 'license'])
    || snapshot.source.name !== SOURCE_NAME || snapshot.source.url !== SOURCE_URL
    || typeof snapshot.source.generatedAt !== 'string'
    || !Number.isFinite(Date.parse(snapshot.source.generatedAt))
    || new Date(snapshot.source.generatedAt).toISOString() !== snapshot.source.generatedAt
    || !exactKeys(snapshot.source.license, ['spdx', 'attribution'])
    || snapshot.source.license.spdx !== 'CC-BY-4.0'
    || snapshot.source.license.attribution !== ATTRIBUTION
    || !Array.isArray(snapshot.entries) || snapshot.entries.length === 0
    || snapshot.entries.length > MAX_DISCOVERY_RECORDS
    || snapshot.source.recordCount !== snapshot.entries.length) {
    throw new Error('discovery index metadata, schema, record count or 50,000-record bound is invalid')
  }
  snapshot.entries.forEach(validateEntry)
  return { recordCount: snapshot.entries.length, rawBytes: rawBytes.length, gzipBytes: compressedBytes.length }
}
