const RUN_STATUS = new Set(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'])
const RUN_CONCLUSION = new Set(['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale', 'startup_failure'])

function text(value, maximum = 240) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : null
}

function iso(value) {
  const parsed = Date.parse(value ?? '')
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function count(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function normalizeRun(run) {
  if (!run || typeof run !== 'object') return null
  const databaseId = Number(run.databaseId)
  const status = RUN_STATUS.has(run.status) ? run.status : 'unknown'
  const conclusion = RUN_CONCLUSION.has(run.conclusion) ? run.conclusion : null
  return {
    runId: Number.isSafeInteger(databaseId) && databaseId > 0 ? databaseId : null,
    status,
    conclusion,
    createdAt: iso(run.createdAt),
    updatedAt: iso(run.updatedAt),
    url: /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(run.url ?? '') ? run.url : null,
    sourceCommit: /^[0-9a-f]{40}$/i.test(run.headSha ?? '') ? run.headSha.toLowerCase() : null,
  }
}

function latestRun(runs) {
  return [...runs].sort((left, right) => (Date.parse(right?.createdAt ?? '') || 0) - (Date.parse(left?.createdAt ?? '') || 0))[0] ?? null
}

function statusOf(scanner, watchdog) {
  if (!scanner || !watchdog) return 'unknown'
  if (scanner.status !== 'completed' || watchdog.status !== 'completed') return 'running'
  return scanner.conclusion === 'success' && watchdog.conclusion === 'success' ? 'passed' : 'failed'
}

function reportRecord(item) {
  const report = item?.report
  if (!report || typeof report !== 'object') return null
  return {
    runId: Number.isSafeInteger(Number(item.runId)) ? Number(item.runId) : null,
    observedAt: iso(report.observedAt),
    addedEntries: Array.isArray(report.addedEntries) ? report.addedEntries : [],
    updatedEntries: Array.isArray(report.updatedEntries) ? report.updatedEntries : [],
    rejectedCandidates: Array.isArray(report.rejectedCandidates) ? report.rejectedCandidates.length : 0,
    deferredUpdates: Array.isArray(report.deferredUpdates) ? report.deferredUpdates.length : 0,
    transientFailures: Array.isArray(report.transientFailures) ? report.transientFailures.length : 0,
    sourceVersionChecks: {
      authority: text(report.sourceVersionChecks?.authority, 120),
      checkedEntries: count(report.sourceVersionChecks?.checkedEntries),
      currentEntries: count(report.sourceVersionChecks?.currentEntries),
      newerVersionCandidates: count(report.sourceVersionChecks?.newerVersionCandidates),
      catalogUpdates: count(report.sourceVersionChecks?.catalogUpdates),
      newerVersionsDeferred: count(report.sourceVersionChecks?.newerVersionsDeferred),
      sourceChangedWithoutVersionBump: count(report.sourceVersionChecks?.sourceChangedWithoutVersionBump),
      upstreamVersionBehind: count(report.sourceVersionChecks?.upstreamVersionBehind),
      unresolvedEntries: count(report.sourceVersionChecks?.unresolvedEntries),
    },
  }
}

function publicEntry(entry, change, run) {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    packageName: entry.packageName,
    version: entry.version,
    status: entry.status,
    repositoryUrl: entry.repositoryUrl,
    observedAt: change.observedAt,
    runId: change.runId,
    runUrl: run?.url ?? null,
  }
}

function publicUpdate(entry, update, change, run) {
  return {
    id: entry.id,
    name: entry.name,
    packageName: entry.packageName,
    fromVersion: text(update?.fromVersion, 80),
    toVersion: text(update?.toVersion ?? update?.version, 80),
    policy: ['source-verified', 'user-reviewed', 'external-only'].includes(update?.policy) ? update.policy : null,
    repositoryUrl: entry.repositoryUrl,
    observedAt: change.observedAt,
    runId: change.runId,
    runUrl: run?.url ?? null,
  }
}

export function buildAutomationStatus({ catalog, candidates, runs = {}, reports = [], generatedAt, sourceCommit }) {
  if (!catalog || !Array.isArray(catalog.entries)) throw new TypeError('catalog entries are required')
  const scannerRuns = Array.isArray(runs.catalogAutomation) ? runs.catalogAutomation : []
  const watchdogRuns = Array.isArray(runs.marketplaceWatchdog) ? runs.marketplaceWatchdog : []
  const scanner = normalizeRun(latestRun(scannerRuns))
  const watchdog = normalizeRun(latestRun(watchdogRuns))
  const runById = new Map(scannerRuns.map(normalizeRun).filter(Boolean).map(run => [run.runId, run]))
  const reportRecords = reports.map(reportRecord).filter(Boolean)
    .sort((left, right) => (Date.parse(right.observedAt ?? '') || 0) - (Date.parse(left.observedAt ?? '') || 0))
  const entryById = new Map(catalog.entries.map(entry => [entry.id, entry]))
  const recentAdditions = []
  const recentUpdates = []
  const seen = new Set()
  const seenUpdates = new Set()
  for (const report of reportRecords) {
    for (const addition of report.addedEntries) {
      const id = text(addition?.id, 96)
      const entry = id ? entryById.get(id) : null
      if (!entry || seen.has(id)) continue
      seen.add(id)
      recentAdditions.push(publicEntry(entry, report, runById.get(report.runId)))
      if (recentAdditions.length >= 24) break
    }
    if (recentAdditions.length >= 24) break
  }
  for (const report of reportRecords) {
    for (const update of report.updatedEntries) {
      const id = text(update?.id, 96)
      const entry = id ? entryById.get(id) : null
      if (!entry || seenUpdates.has(id)) continue
      seenUpdates.add(id)
      recentUpdates.push(publicUpdate(entry, update, report, runById.get(report.runId)))
      if (recentUpdates.length >= 24) break
    }
    if (recentUpdates.length >= 24) break
  }
  const latestReport = reportRecords[0] ?? null
  const latestAdded = latestReport?.addedEntries.map(item => text(item?.id, 96)).filter(Boolean) ?? []
  const latestUpdated = latestReport?.updatedEntries.map(item => text(item?.id, 96)).filter(Boolean) ?? []
  const validGeneratedAt = iso(generatedAt) ?? new Date(0).toISOString()
  return {
    schemaVersion: 1,
    generatedAt: validGeneratedAt,
    sourceCommit: /^[0-9a-f]{40}$/i.test(sourceCommit ?? '') ? sourceCommit.toLowerCase() : text(sourceCommit, 80),
    scheduleHours: 3,
    overall: { status: statusOf(scanner, watchdog) },
    scanner,
    watchdog,
    catalog: {
      entries: catalog.entries.length,
      approved: catalog.entries.filter(entry => entry.status === 'approved').length,
      blocked: catalog.entries.filter(entry => entry.status === 'blocked').length,
      candidates: Array.isArray(candidates?.entries) ? candidates.entries.length : 0,
      updatedAt: iso(catalog.registry?.updatedAt),
    },
    latestChanges: {
      observedAt: latestReport?.observedAt ?? null,
      added: latestAdded,
      updated: latestUpdated,
      rejectedCandidates: latestReport?.rejectedCandidates ?? 0,
      deferredUpdates: latestReport?.deferredUpdates ?? 0,
      transientFailures: latestReport?.transientFailures ?? 0,
      sourceVersionChecks: latestReport?.sourceVersionChecks ?? {
        authority: null,
        checkedEntries: 0,
        currentEntries: 0,
        newerVersionCandidates: 0,
        catalogUpdates: 0,
        newerVersionsDeferred: 0,
        sourceChangedWithoutVersionBump: 0,
        upstreamVersionBehind: 0,
        unresolvedEntries: 0,
      },
    },
    recentAdditions,
    recentUpdates,
    monitoredSurfaces: [
      'GitHub registry/catalog.json', 'GitHub Pages catalog', 'dsh.store catalog', 'dsh-store.cn catalog',
    ],
  }
}
