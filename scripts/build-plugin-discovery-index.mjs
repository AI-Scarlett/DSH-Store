import { access, lstat, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_URL = 'https://www.dsh.so/plugins-index.json'
const ATTRIBUTION = 'dsh.so — DSH Developer Hub (https://www.dsh.so)'
const MAX_INPUT_BYTES = 64 * 1024 * 1024
const MAX_RECORDS = 50_000
const DESCRIPTION_LIMIT = 220

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function boundedText(value, fallback = '', limit = 2_000) {
  if (typeof value !== 'string') return fallback
  return value.trim().slice(0, limit)
}

function safeGithubUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com'
      || url.username || url.password || url.search || url.hash) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0])) return null
    const repository = parts[1].replace(/\.git$/i, '')
    return /^[A-Za-z0-9_.-]+$/.test(repository)
      ? `https://github.com/${parts[0]}/${repository}` : null
  } catch {
    return null
  }
}

function repositoryFromInstall(value) {
  if (typeof value !== 'string') return null
  const match = /^dsh plugin --profile [A-Za-z0-9_-]+ add github:([^\s#]+)(?:#[^\s]*)?$/.exec(value.trim())
  if (!match) return null
  return safeGithubUrl(`https://github.com/${match[1]}`)
}

function safeArtifactUrl(value, id) {
  if (typeof value === 'string') {
    try {
      const url = new URL(value)
      if (url.protocol === 'https:' && url.hostname.toLowerCase() === 'www.dsh.so'
        && url.pathname.startsWith('/artifact/') && !url.username && !url.password) return url.href
    } catch {}
  }
  return `https://www.dsh.so/artifact/${encodeURIComponent(id)}/`
}

function normalizeCategory(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return normalized || null
}

export function projectDiscoveryIndex(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !Array.isArray(payload.plugins) || payload.plugins.length > MAX_RECORDS
    || !Number.isInteger(payload.count) || payload.count !== payload.plugins.length
    || typeof payload.generatedAt !== 'string' || !Number.isFinite(Date.parse(payload.generatedAt))) {
    throw new Error('Source index is malformed or its declared count does not match the full records array')
  }

  const entries = payload.plugins.map((record, sourceIndex) => {
    const row = record && typeof record === 'object' && !Array.isArray(record) ? record : {}
    const sourceId = boundedText(row.id, `missing-id-${sourceIndex + 1}`, 240)
    const name = boundedText(row.name, boundedText(row.alias, sourceId, 240), 240)
    const categories = [...new Set([
      ...(Array.isArray(row.topics) ? row.topics : []),
      ...(Array.isArray(row.capability?.samples) ? row.capability.samples : []),
    ].map(normalizeCategory).filter(Boolean))]
    if (!categories.length) categories.push('uncategorized')

    const repositoryUrl = safeGithubUrl(row.source) || repositoryFromInstall(row.install)
    const rawDescription = boundedText(row.description, '', 50_000)
    const description = rawDescription.length > DESCRIPTION_LIMIT
      ? `${rawDescription.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
      : rawDescription

    return {
      sourceIndex,
      sourceId,
      alias: boundedText(row.alias, '', 500),
      name,
      description,
      stars: Number.isSafeInteger(row.stars) && row.stars >= 0 ? row.stars : 0,
      categories,
      kind: boundedText(row.kind, 'dsh-plugin', 80),
      repositoryUrl,
      detailUrl: safeArtifactUrl(row.url, sourceId),
    }
  })

  return {
    schemaVersion: 1,
    source: {
      name: 'dsh.so public discovery index',
      url: SOURCE_URL,
      generatedAt: new Date(payload.generatedAt).toISOString(),
      recordCount: payload.count,
      license: {
        spdx: 'CC-BY-4.0',
        attribution: ATTRIBUTION,
      },
    },
    entries,
  }
}

export async function buildDiscoveryIndex({ inputPath, outputPath, replace = false }) {
  if (!inputPath || !outputPath) throw new Error('Usage: node scripts/build-plugin-discovery-index.mjs --input <plugins-index.json> [--output registry/discovery-index.json] [--replace]')
  const input = resolve(inputPath)
  const output = resolve(projectRoot, outputPath)
  const gzipOutput = `${output}.gz`
  const outputRelative = relative(projectRoot, output)
  if (!outputRelative || outputRelative.startsWith('..')) throw new Error('Output must stay within the repository root')
  const inputStat = await lstat(input)
  if (!inputStat.isFile() || inputStat.isSymbolicLink() || inputStat.size > MAX_INPUT_BYTES) {
    throw new Error('Input must be a regular, non-symlink JSON file within the 64 MiB bound')
  }
  const bytes = await readFile(input)
  const payload = JSON.parse(bytes.toString('utf8'))
  const snapshot = projectDiscoveryIndex(payload)
  const serialized = `${JSON.stringify(snapshot)}\n`
  const compressed = gzipSync(serialized, { level: 9, mtime: 0 })

  for (const target of [output, gzipOutput]) {
    try {
      await access(target)
      if (!replace) throw new Error(`Output already exists; pass --replace after reviewing its current hash: ${target}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  const writes = [
    { target: output, content: serialized },
    { target: gzipOutput, content: compressed },
  ].map(({ target, content }) => ({ target, temporary: `${target}.${process.pid}.tmp`, content }))
  try {
    for (const item of writes) await writeFile(item.temporary, item.content, { flag: 'wx' })
    for (const item of writes) await rename(item.temporary, item.target)
  } catch (error) {
    await Promise.all(writes.map(item => rm(item.temporary, { force: true })))
    throw error
  }
  return {
    output,
    sourceCount: snapshot.source.recordCount,
    bytes: Buffer.byteLength(serialized),
    gzipBytes: compressed.byteLength,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputPath = option('--input')
  const outputPath = option('--output') || 'registry/discovery-index.json'
  try {
    const result = await buildDiscoveryIndex({ inputPath, outputPath, replace: process.argv.includes('--replace') })
    process.stdout.write(`DISCOVERY_INDEX_OK count=${result.sourceCount} bytes=${result.bytes} gzipBytes=${result.gzipBytes} output=${result.output}\n`)
  } catch (error) {
    process.stderr.write(`DISCOVERY_INDEX_FAILED ${error.message}\n`)
    process.exitCode = 1
  }
}
