#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCandidateRegistry } from '../src/candidates.mjs'
import {
  assertLegacyCatalogCompatibility, validateCatalog, validateCatalogBridgeIndex,
  validateCatalogDetail, validateCatalogIndex,
} from '../src/catalog.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const policy = JSON.parse(await readFile(resolve(root, 'registry/automation-policy.json'), 'utf8'))

function parseArgs(argv) {
  const options = { report: null, attempts: 3 }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--report') options.report = argv[++index]
    else if (argv[index] === '--attempts') options.attempts = Number(argv[++index])
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 5) throw new Error('--attempts must be between 1 and 5')
  return options
}

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))

async function fetchText(url, maximum = 4 * 1024 * 1024) {
  let lastError
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'dsh-safe-plugin-manager-public-watchdog' },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      if (Buffer.byteLength(text) > maximum) throw new Error('response exceeds watchdog bound')
      return text
    } catch (error) {
      lastError = error
      if (attempt < options.attempts) await delay(attempt * 1_000)
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function verifyDetails(index, catalogUrl) {
  const entries = index.entries
  let next = 0
  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++]
      const text = await fetchText(new URL(entry.detailPath, catalogUrl).href, 512 * 1024)
      validateCatalogDetail(JSON.parse(text), entry, index.registry)
    }
  }
  await Promise.all(Array.from({ length: Math.min(12, entries.length) }, worker))
  return entries.length
}

async function semanticCatalog(text, catalogUrl) {
  const document = JSON.parse(text)
  let catalog
  let index = null
  let detailBaseUrl = catalogUrl
  if (document?.schemaVersion === 2) {
    catalog = validateCatalogIndex(document)
    index = { url: catalogUrl, bytes: Buffer.byteLength(text), sha256: sha256(text) }
  } else {
    const bridge = validateCatalog(document)
    if (bridge.registry.indexPath) {
      const indexUrl = new URL(bridge.registry.indexPath, catalogUrl).href
      const indexText = await fetchText(indexUrl, 2 * 1024 * 1024)
      catalog = validateCatalogBridgeIndex(document, JSON.parse(indexText), Buffer.from(indexText))
      index = { url: indexUrl, bytes: Buffer.byteLength(indexText), sha256: sha256(indexText) }
      detailBaseUrl = indexUrl
    } else {
      assertLegacyCatalogCompatibility(document)
      catalog = bridge
    }
  }
  const details = catalog.schemaVersion === 2
    ? await verifyDetails(catalog, detailBaseUrl)
    : catalog.entries.length
  return {
    entries: catalog.entries.length,
    details,
    index,
    registryUpdatedAt: catalog.registry.updatedAt,
    fingerprint: sha256(JSON.stringify(catalog.entries)),
    manager: catalog.entries.find(entry => entry.id === 'dsh-safe-plugin-manager') ?? null,
  }
}

function semanticCandidates(text) {
  const document = validateCandidateRegistry(JSON.parse(text))
  const statusCounts = Object.fromEntries(['discovered', 'reviewing', 'rejected']
    .map(status => [status, document.entries.filter(entry => entry.status === status).length]))
  return {
    entries: document.entries.length,
    registryUpdatedAt: document.registry.updatedAt,
    fingerprint: sha256(JSON.stringify(document.entries)),
    statusCounts,
  }
}

function candidateUrl(catalogUrl) {
  const url = new URL(catalogUrl)
  if (!url.pathname.endsWith('/registry/catalog.json')) throw new Error(`unsupported public Catalog URL: ${catalogUrl}`)
  url.pathname = `${url.pathname.slice(0, -'/registry/catalog.json'.length)}/registry/candidates.json`
  return url.toString()
}

async function atomicReport(path, value) {
  const target = resolve(path)
  const temporary = `${target}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 })
  await rename(temporary, target)
}

const options = parseArgs(process.argv.slice(2))
const checkedAt = new Date().toISOString()
const urls = policy.publication.publicCatalogUrls
if (!Array.isArray(urls) || urls.length < 4) throw new Error('automation policy must declare all public Catalog surfaces')
const candidateUrls = urls.map(candidateUrl)
const report = {
  schemaVersion: 2,
  checkedAt,
  status: 'passed',
  authority: null,
  candidateAuthority: null,
  surfaces: [],
  candidateSurfaces: [],
  pages: null,
  failures: [],
}

for (const url of urls) {
  try {
    const text = await fetchText(url)
    const semantic = await semanticCatalog(text, url)
    const surface = { url, status: 'passed', bytes: Buffer.byteLength(text), sha256: sha256(text), ...semantic }
    if (report.authority === null) report.authority = surface
    else if (surface.fingerprint !== report.authority.fingerprint || surface.entries !== report.authority.entries) {
      surface.status = 'failed'
      report.failures.push(`${url} Catalog does not match GitHub main authority`)
    }
    report.surfaces.push(surface)
  } catch (error) {
    report.failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    report.surfaces.push({ url, status: 'failed' })
  }
}

for (const url of candidateUrls) {
  try {
    const text = await fetchText(url, 6 * 1024 * 1024)
    const semantic = semanticCandidates(text)
    const surface = { url, status: 'passed', bytes: Buffer.byteLength(text), sha256: sha256(text), ...semantic }
    if (report.candidateAuthority === null) report.candidateAuthority = surface
    else if (surface.fingerprint !== report.candidateAuthority.fingerprint || surface.entries !== report.candidateAuthority.entries) {
      surface.status = 'failed'
      report.failures.push(`${url} Candidate Registry does not match GitHub main authority`)
    }
    report.candidateSurfaces.push(surface)
  } catch (error) {
    report.failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    report.candidateSurfaces.push({ url, status: 'failed' })
  }
}

try {
  const repository = policy.publication.repository
  const [commitText, manifestText] = await Promise.all([
    fetchText(`https://api.github.com/repos/${repository}/commits/main`),
    fetchText('https://ai-scarlett.github.io/DSH-Store/release-manifest.json'),
  ])
  const commit = JSON.parse(commitText)?.sha
  const manifest = JSON.parse(manifestText)
  const pagesMatchesMain = /^[0-9a-f]{40}$/.test(commit ?? '') && manifest?.sourceCommit === commit
  report.pages = { status: pagesMatchesMain ? 'passed' : 'failed', mainCommit: commit ?? null, sourceCommit: manifest?.sourceCommit ?? null }
  if (!pagesMatchesMain) report.failures.push('GitHub Pages release manifest does not match the current main Commit')
} catch (error) {
  report.pages = { status: 'failed' }
  report.failures.push(`Pages release identity: ${error instanceof Error ? error.message : String(error)}`)
}

if (report.failures.length > 0) report.status = 'failed'
if (options.report) await atomicReport(options.report, report)
process.stdout.write(`MARKETPLACE_PUBLIC_${report.status === 'passed' ? 'OK' : 'FAILED'} catalogs=${report.surfaces.filter(item => item.status === 'passed').length}/${urls.length} candidates=${report.candidateSurfaces.filter(item => item.status === 'passed').length}/${candidateUrls.length} failures=${report.failures.length}\n`)
if (report.status !== 'passed') process.exitCode = 1
