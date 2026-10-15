#!/usr/bin/env node
// Full Catalog census only. Historical reason reclassification cannot approve
// a package: live source, license, Patch, review and host gates remain required.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { loadCatalogFromFiles } from '../src/catalog.mjs'
import { SOURCE_SCAN_BOUNDS, SCAN_POLICY_VERSION } from '../src/source-scan-policy.mjs'
export function reassessCatalog(catalog) {
  const records = catalog.entries.map(entry => {
    const reason = String(entry.statusReason ?? '')
    const lanes = []
    if (/byte bound|file bytes|source exceeds|maximum.*bytes|runtime source exceeds|scan.*bound/i.test(reason)) lanes.push('store-scanner-budget')
    if (/entry.*collision|already owned|duplicate.*id/i.test(reason)) lanes.push('patch-operation-ownership')
    if (/permission signal|permissions|Tool-view/i.test(reason)) lanes.push('fixed-source-capability-review')
    if (/license|package name|manifest.*match/i.test(reason)) lanes.push('identity-migration-review')
    if (/DSH_LATEST_THREE_COMPATIBILITY_HOLD:/.test(reason)) lanes.push('host-version-compatibility')
    if (!lanes.length) lanes.push('fixed-source-recheck')
    return { id: entry.id, repositoryUrl: entry.repositoryUrl, commit: entry.commit, status: entry.status,
      admissionState: entry.admission?.state ?? 'unverified', lanes, installabilityChanged: false,
      knownCompatibleVersions: Object.entries(entry.compatibility.dshReleases).filter(([, v]) => v === 'compatible').map(([k]) => k) }
  })
  const counts = {}
  for (const r of records) for (const lane of r.lanes) counts[lane] = (counts[lane] ?? 0) + 1
  return { schemaVersion: 1, engine: SCAN_POLICY_VERSION, mode: 'metadata-only-read-only-census',
    evidenceLevel: 'catalog-metadata', runtimeAcceptance: 'unverified', sourceReview: 'not-performed',
    policyBounds: SOURCE_SCAN_BOUNDS, entryCount: records.length, counts, records }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = await loadCatalogFromFiles()
  const report = reassessCatalog(catalog)
  report.inputs = Object.fromEntries(await Promise.all(['registry/catalog.json', 'registry/catalog-index.json', 'registry/automation-policy.json'].map(async path =>
    [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
  const output = process.argv[2]
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(`ADMISSION_CENSUS_OK entries=${report.entryCount} mode=${report.mode} changed=0`)
  console.log(JSON.stringify(report.counts))
}
