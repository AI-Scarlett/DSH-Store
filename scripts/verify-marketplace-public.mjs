#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCatalog } from '../src/catalog.mjs'

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

function semanticCatalog(text) {
  const document = JSON.parse(text)
  const catalog = validateCatalog(document)
  return {
    entries: catalog.entries.length,
    registryUpdatedAt: catalog.registry.updatedAt,
    fingerprint: sha256(JSON.stringify(catalog.entries)),
    manager: catalog.entries.find(entry => entry.id === 'dsh-safe-plugin-manager') ?? null,
  }
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
const report = { schemaVersion: 1, checkedAt, status: 'passed', authority: null, surfaces: [], pages: null, failures: [] }

for (const url of urls) {
  try {
    const text = await fetchText(url)
    const semantic = semanticCatalog(text)
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

try {
  const repository = policy.publication.repository
  const [commitText, manifestText] = await Promise.all([
    fetchText(`https://api.github.com/repos/${repository}/commits/main`),
    fetchText('https://ai-scarlett.github.io/dsh-safe-plugin-manager/release-manifest.json'),
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
process.stdout.write(`MARKETPLACE_PUBLIC_${report.status === 'passed' ? 'OK' : 'FAILED'} surfaces=${report.surfaces.filter(item => item.status === 'passed').length}/${urls.length} failures=${report.failures.length}\n`)
if (report.status !== 'passed') process.exitCode = 1
