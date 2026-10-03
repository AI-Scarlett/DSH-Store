const RUN_STATUS = new Set(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'])
const RUN_CONCLUSION = new Set(['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale', 'startup_failure'])
const RUN_EVENT = new Set(['schedule', 'workflow_dispatch', 'push', 'workflow_run', 'repository_dispatch', 'workflow_call', 'pull_request', 'release'])

export function automationReportRunId(relativePath, separator) {
  if (typeof relativePath !== 'string' || !['/', '\\'].includes(separator)) return null
  // Use the builder's native separator: a backslash may be part of a POSIX
  // directory name and must not turn that directory into another run's ID.
  const firstSegment = relativePath.split(separator)[0]
  if (!/^\d+$/.test(firstSegment)) return null
  const runId = Number(firstSegment)
  return Number.isSafeInteger(runId) && runId > 0 ? runId : null
}

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

function optionalCount(value) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
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
    event: RUN_EVENT.has(run.event) ? run.event : null,
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
  const statisticsAvailable = report.status !== 'failed'
    && report.completed !== false
    && report.statisticsAvailable !== false
  const identity = {
    runId: Number.isSafeInteger(Number(item.runId)) ? Number(item.runId) : null,
    observedAt: iso(report.observedAt),
    statisticsAvailable,
    failure: statisticsAvailable ? null : {
      stage: text(report.failure?.stage, 120),
      message: text(report.failure?.message, 600),
    },
  }
  if (!statisticsAvailable) {
    return {
      ...identity,
      addedEntries: null, updatedEntries: null, compatibilityUnlisted: null, compatibilityRestored: null, prunedCandidates: null,
      compatibilityPolicy: null, candidateRetention: null,
      rejectedCandidates: null, deferredUpdates: null, transientFailures: null, sourceVersionChecks: null,
    }
  }
  return {
    ...identity,
    addedEntries: Array.isArray(report.addedEntries) ? report.addedEntries : null,
    updatedEntries: Array.isArray(report.updatedEntries) ? report.updatedEntries : null,
    compatibilityUnlisted: Array.isArray(report.compatibilityUnlisted) ? report.compatibilityUnlisted : null,
    compatibilityRestored: Array.isArray(report.compatibilityRestored) ? report.compatibilityRestored : null,
    prunedCandidates: Array.isArray(report.prunedCandidates) ? report.prunedCandidates : null,
    compatibilityPolicy: {
      authority: text(report.compatibilityPolicy?.authority, 120),
      latestVersion: text(report.compatibilityPolicy?.latestVersion, 80),
      latestReleases: Array.isArray(report.compatibilityPolicy?.latestReleases)
        ? report.compatibilityPolicy.latestReleases.map(value => text(value, 80)).filter(Boolean).slice(0, 12)
        : [],
      checkedApprovedEntries: count(report.compatibilityPolicy?.checkedApprovedEntries),
      managedHeldEntries: count(report.compatibilityPolicy?.managedHeldEntries),
      managedCandidatesCreated: count(report.compatibilityPolicy?.managedCandidatesCreated),
      managedCandidatesRefreshed: count(report.compatibilityPolicy?.managedCandidatesRefreshed),
      managedCandidatesRemoved: count(report.compatibilityPolicy?.managedCandidatesRemoved),
    },
    candidateRetention: {
      authority: text(report.candidateRetention?.authority, 120),
      bucket: count(report.candidateRetention?.bucket),
      bucketCount: count(report.candidateRetention?.bucketCount),
      checkedCandidates: count(report.candidateRetention?.checkedCandidates),
      retainedCompatible: count(report.candidateRetention?.retainedCompatible),
      retainedUnknown: count(report.candidateRetention?.retainedUnknown),
      prunedUnsupported: count(report.candidateRetention?.prunedUnsupported),
      durableDecisionsPreserved: count(report.candidateRetention?.durableDecisionsPreserved),
      registryRemovals: count(report.candidateRetention?.registryRemovals),
    },
    rejectedCandidates: Array.isArray(report.rejectedCandidates) ? report.rejectedCandidates.length : null,
    deferredUpdates: Array.isArray(report.deferredUpdates) ? report.deferredUpdates.length : null,
    transientFailures: Array.isArray(report.transientFailures) ? report.transientFailures.length : null,
    sourceVersionChecks: report.sourceVersionChecks && typeof report.sourceVersionChecks === 'object' ? {
      authority: text(report.sourceVersionChecks?.authority, 120),
      checkedEntries: optionalCount(report.sourceVersionChecks.checkedEntries),
      currentEntries: optionalCount(report.sourceVersionChecks.currentEntries),
      newerVersionCandidates: optionalCount(report.sourceVersionChecks.newerVersionCandidates),
      catalogUpdates: optionalCount(report.sourceVersionChecks.catalogUpdates),
      newerVersionsDeferred: optionalCount(report.sourceVersionChecks.newerVersionsDeferred),
      sourceChangedWithoutVersionBump: optionalCount(report.sourceVersionChecks.sourceChangedWithoutVersionBump),
      sameVersionCatalogUpdates: optionalCount(report.sourceVersionChecks.sameVersionCatalogUpdates),
      sameVersionUpdatesDeferred: optionalCount(report.sourceVersionChecks.sameVersionUpdatesDeferred),
      upstreamVersionBehind: optionalCount(report.sourceVersionChecks.upstreamVersionBehind),
      unresolvedEntries: optionalCount(report.sourceVersionChecks.unresolvedEntries),
    } : null,
  }
}

function publicScanRun(run, report) {
  const statisticsAvailable = report?.statisticsAvailable === true
  const arrayCount = value => Array.isArray(value) ? value.length : null
  return {
    runId: run.runId,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    url: run.url,
    sourceCommit: run.sourceCommit,
    reportAvailable: Boolean(report),
    statisticsAvailable,
    observedAt: report?.observedAt ?? null,
    added: statisticsAvailable ? arrayCount(report.addedEntries) : null,
    updated: statisticsAvailable ? arrayCount(report.updatedEntries) : null,
    compatibilityUnlisted: statisticsAvailable ? arrayCount(report.compatibilityUnlisted) : null,
    compatibilityRestored: statisticsAvailable ? arrayCount(report.compatibilityRestored) : null,
    prunedCandidates: statisticsAvailable ? arrayCount(report.prunedCandidates) : null,
    rejectedCandidates: statisticsAvailable ? report.rejectedCandidates : null,
    deferredUpdates: statisticsAvailable ? report.deferredUpdates : null,
    transientFailures: statisticsAvailable ? report.transientFailures : null,
    sourceVersionChecks: statisticsAvailable ? report.sourceVersionChecks : null,
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
    changeKind: ['version-update', 'same-version-source-update'].includes(update?.changeKind) ? update.changeKind : 'version-update',
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
  const reportByRunId = new Map()
  for (const report of reportRecords) {
    if (Number.isSafeInteger(report.runId) && report.runId > 0 && !reportByRunId.has(report.runId)) {
      reportByRunId.set(report.runId, report)
    }
  }
  const completedReportRecords = reportRecords.filter(report => report.statisticsAvailable)
  const entryById = new Map(catalog.entries.map(entry => [entry.id, entry]))
  const recentAdditions = []
  const recentUpdates = []
  const seen = new Set()
  const seenUpdates = new Set()
  for (const report of completedReportRecords) {
    for (const addition of report.addedEntries ?? []) {
      const id = text(addition?.id, 96)
      const entry = id ? entryById.get(id) : null
      if (!entry || seen.has(id)) continue
      seen.add(id)
      recentAdditions.push(publicEntry(entry, report, runById.get(report.runId)))
      if (recentAdditions.length >= 24) break
    }
    if (recentAdditions.length >= 24) break
  }
  for (const report of completedReportRecords) {
    for (const update of report.updatedEntries ?? []) {
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
  const latestStatisticsAvailable = latestReport?.statisticsAvailable === true
  const latestAdded = latestStatisticsAvailable && Array.isArray(latestReport.addedEntries)
    ? latestReport.addedEntries.map(item => text(item?.id, 96)).filter(Boolean)
    : null
  const latestUpdated = latestStatisticsAvailable && Array.isArray(latestReport.updatedEntries)
    ? latestReport.updatedEntries.map(item => text(item?.id, 96)).filter(Boolean)
    : null
  const validGeneratedAt = iso(generatedAt) ?? new Date(0).toISOString()
  return {
    schemaVersion: 1,
    generatedAt: validGeneratedAt,
    sourceCommit: /^[0-9a-f]{40}$/i.test(sourceCommit ?? '') ? sourceCommit.toLowerCase() : text(sourceCommit, 80),
    scheduleHours: 8,
    overall: { status: statusOf(scanner, watchdog) },
    scanner,
    watchdog,
    recentScanRuns: [...scannerRuns]
      .map(normalizeRun)
      .filter(run => run && Number.isSafeInteger(run.runId) && run.runId > 0)
      .sort((left, right) => (Date.parse(right.createdAt ?? '') || 0) - (Date.parse(left.createdAt ?? '') || 0))
      .slice(0, 8)
      .map(run => publicScanRun(run, reportByRunId.get(run.runId) ?? null)),
    catalog: {
      entries: catalog.entries.length,
      approved: catalog.entries.filter(entry => entry.status === 'approved').length,
      blocked: catalog.entries.filter(entry => entry.status === 'blocked').length,
      unlisted: catalog.entries.filter(entry => entry.status === 'unlisted').length,
      candidates: Array.isArray(candidates?.entries) ? candidates.entries.length : 0,
      updatedAt: iso(catalog.registry?.updatedAt),
    },
    latestChanges: {
      observedAt: latestReport?.observedAt ?? null,
      statisticsAvailable: latestStatisticsAvailable,
      failure: latestReport?.failure ?? null,
      added: latestAdded,
      updated: latestUpdated,
      compatibilityUnlisted: latestStatisticsAvailable && Array.isArray(latestReport.compatibilityUnlisted)
        ? latestReport.compatibilityUnlisted.map(item => text(item?.id, 96)).filter(Boolean)
        : null,
      compatibilityRestored: latestStatisticsAvailable && Array.isArray(latestReport.compatibilityRestored)
        ? latestReport.compatibilityRestored.map(item => text(item?.id, 96)).filter(Boolean)
        : null,
      prunedCandidates: latestStatisticsAvailable && Array.isArray(latestReport.prunedCandidates)
        ? latestReport.prunedCandidates.map(item => text(item?.id, 96)).filter(Boolean)
        : null,
      compatibilityPolicy: latestStatisticsAvailable ? latestReport.compatibilityPolicy : null,
      candidateRetention: latestStatisticsAvailable ? latestReport.candidateRetention : null,
      rejectedCandidates: latestStatisticsAvailable ? latestReport.rejectedCandidates : null,
      deferredUpdates: latestStatisticsAvailable ? latestReport.deferredUpdates : null,
      transientFailures: latestStatisticsAvailable ? latestReport.transientFailures : null,
      sourceVersionChecks: latestStatisticsAvailable ? latestReport.sourceVersionChecks : null,
    },
    recentAdditions,
    recentUpdates,
    monitoredSurfaces: [
      'GitHub registry/catalog.json', 'GitHub Pages catalog', 'dsh.store catalog', 'dsh-store.cn catalog',
    ],
  }
}
