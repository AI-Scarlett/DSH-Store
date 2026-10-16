import { createHash } from 'node:crypto'
import { SCAN_POLICY_VERSION } from './source-scan-policy.mjs'
import { SOURCE_SCAN_BOUNDS } from './source-scan-policy.mjs'

const sha = value => /^[a-f0-9]{64}$/.test(value ?? '')
const path = value => typeof value === 'string' && /^[a-zA-Z0-9._/-]+$/.test(value) && !value.startsWith('/') && !value.split('/').includes('..')
const evidence = value => value && path(value.file) && sha(value.sha256) && Number.isSafeInteger(value.line) && value.line > 0
const rationale = value => typeof value === 'string' && value.trim().length >= 20
const protectedToolKeys = new Set(['bash', 'read', 'edit', 'write', 'ask_user_question', 'ui-settings-plugin-inventory'])
const sourceMatches = (analysis, item) => analysis.sourceEvidence?.some(e => e.file === item.file && e.sha256 === item.sha256)

// These attestations are reviewed Registry records, never author self-approval.
// Every record already binds the complete source, policy and immutable Commit.
function reviewedToolViews(candidate, analysis, record) {
  const observed = analysis.toolViewEvidence ?? []
  const reviews = record?.toolViewOwnership ?? []
  return observed.length > 0 && observed.every(item => reviews.some(review =>
    review.owner === candidate.packageName && !protectedToolKeys.has(review.key)
    && review.registration.file === item.file && review.registration.sha256 === item.sha256
    && sourceMatches(analysis, review.registration) && sourceMatches(analysis, review.tool)))
}

function reviewedSupplyChain(analysis, record) {
  const review = record?.supplyChain
  if (!review || review.complete !== true || !sourceMatches(analysis, review.installResolution)) return false
  const direct = Object.entries(analysis.runtimeDependencies ?? {})
  if (!direct.length || JSON.stringify(Object.fromEntries(direct.sort())) !== JSON.stringify(Object.fromEntries(Object.entries(review.direct).sort()))) return false
  const nodes = new Map(review.packages.map(p => [`${p.name}@${p.version}`, p]))
  if (nodes.size !== review.packages.length) return false
  const visited = new Set(), queue = direct.map(([name, version]) => `${name}@${version}`)
  while (queue.length) {
    const key = queue.pop()
    if (visited.has(key)) continue
    const node = nodes.get(key)
    if (!node) return false
    if (node.signals.protectedDsh || node.signals.nativeOrExecutableArtifacts) return false
    const p = record.permissions
    if (node.signals.files && p?.files === 'none' || node.signals.network && p?.network === 'none'
      || node.signals.commands && p?.commands === 'none' || node.signals.credentials && p?.credentials?.includes('none')) return false
    visited.add(key)
    queue.push(...node.dependencies)
  }
  return visited.size === nodes.size
}

export function admissionBinding(candidate, analysis) {
  return createHash('sha256').update(JSON.stringify({
    engine: SCAN_POLICY_VERSION, policyDigest: analysis.policyDigest ?? null, repository: candidate.repositoryUrl, commit: candidate.commit,
    manifestPath: candidate.manifestPath, installPath: candidate.installPath ?? null,
    packageName: candidate.packageName, version: candidate.version,
    entryIds: [...candidate.entryIds].sort(), configOverrides: [...(candidate.configOverrides ?? [])].sort(),
    sourceDigest: analysis.sourceDigest, reasons: [...analysis.reasons].sort(),
    signals: analysis.signals, securityFindings: analysis.securityScan?.findings ?? [],
  })).digest('hex')
}

export function validateAdmissionReviews(document) {
  if (document?.schemaVersion !== 1 || document.policyVersion !== SCAN_POLICY_VERSION || !Array.isArray(document.reviews)) throw new Error('invalid admission review registry')
  const seen = new Set()
  for (const record of document.reviews) {
    if (!/^[a-f0-9]{40}$/.test(record.commit ?? '') || !/^[a-f0-9]{64}$/.test(record.binding ?? '')
      || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.repositoryUrl ?? '') || !['approved', 'rejected'].includes(record.verdict)
      || typeof record.reviewer !== 'string' || !record.reviewer.trim()
      || !Number.isFinite(Date.parse(record.reviewedAt)) || typeof record.rationale !== 'string' || record.rationale.length < 20
      || !Array.isArray(record.evidenceUrls) || !record.evidenceUrls.length
      || record.evidenceUrls.some(url => !/^https:\/\/github\.com\//.test(url))
      || !record.evidenceUrls.some(url => url === `${record.repositoryUrl}/commit/${record.commit}` || url.startsWith(`${record.repositoryUrl}/blob/${record.commit}/`))) throw new Error('incomplete fixed-source admission review')
    if (seen.has(record.binding)) throw new Error('duplicate admission review binding')
    seen.add(record.binding)
    if (record.verdict === 'approved') {
      const p = record.permissions
      if (!p || !['low', 'medium', 'high'].includes(p.level) || !['none', 'read-only', 'write'].includes(p.files)
        || !['none', 'specified-services', 'any'].includes(p.network) || !['none', 'restricted', 'shell'].includes(p.commands)
        || !Array.isArray(p.credentials) || !p.credentials.length || p.credentials.some(v => !['none', 'api-key', 'oauth', 'keychain'].includes(v)) || (p.credentials.includes('none') && p.credentials.length !== 1)) throw new Error('reviewed permissions must be complete')
    }
    if (record.dispositions !== undefined && (!Array.isArray(record.dispositions) || record.dispositions.some(d =>
      !['synthetic-fixture', 'false-positive'].includes(d.kind) || !/^[a-f0-9]{64}$/.test(d.sha256 ?? '')
      || typeof d.file !== 'string' || !d.file || d.file.includes('..') || d.file.startsWith('/')
      || typeof d.rule !== 'string' || !Number.isSafeInteger(d.line) || d.line < 1
      || typeof d.rationale !== 'string' || d.rationale.length < 20))) throw new Error('invalid exact finding disposition')
    if (record.toolViewOwnership !== undefined && (!Array.isArray(record.toolViewOwnership) || record.toolViewOwnership.some(r =>
      typeof r.key !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(r.key) || protectedToolKeys.has(r.key)
      || typeof r.owner !== 'string' || !r.owner || !evidence(r.registration) || !evidence(r.tool) || !rationale(r.rationale)))) throw new Error('invalid Tool-view ownership review')
    if (record.capabilityDispositions !== undefined && (!Array.isArray(record.capabilityDispositions) || record.capabilityDispositions.some(r =>
      r.kind !== 'false-positive' || !['files', 'network', 'commands', 'credentials'].includes(r.signal)
      || !evidence(r) || !rationale(r.rationale)))) throw new Error('invalid capability disposition')
    if (record.supplyChain !== undefined) {
      const s = record.supplyChain
      if (!s || s.complete !== true || !evidence(s.installResolution) || !rationale(s.installResolution.rationale)
        || !s.direct || typeof s.direct !== 'object' || Array.isArray(s.direct)
        || Object.values(s.direct).some(v => typeof v !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(v))
        || !Array.isArray(s.packages) || s.packages.length < 1 || s.packages.length > 512
        || s.packages.some(p => typeof p.name !== 'string' || !p.name || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(p.version ?? '')
          || !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(p.repositoryUrl ?? '') || !/^[a-f0-9]{40}$/.test(p.commit ?? '')
          || !sha(p.sourceDigest) || !rationale(p.rationale) || typeof p.license !== 'string' || !p.license || ['UNKNOWN', 'NOASSERTION', 'UNLICENSED'].includes(p.license)
          || p.installScriptsReviewed !== 'none' || !Array.isArray(p.dependencies) || p.dependencies.some(d => typeof d !== 'string')
          || p.coverage !== 'complete' || p.securityVerdict !== 'pass' || p.moduleLoading !== 'static'
          || !p.signals || ['files', 'network', 'commands', 'credentials', 'protectedDsh', 'nativeOrExecutableArtifacts'].some(k => typeof p.signals[k] !== 'boolean')
          || !Array.isArray(p.files) || !p.files.length || p.files.length > SOURCE_SCAN_BOUNDS.maxRuntimeFiles
          || new Set(p.files.map(f => f.file)).size !== p.files.length
          || p.files.reduce((n, f) => n + f.bytes, 0) > SOURCE_SCAN_BOUNDS.maxTotalRuntimeBytes
          || p.files.some(f => !path(f.file) || !sha(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > SOURCE_SCAN_BOUNDS.maxFileBytes)
          || createHash('sha256').update(JSON.stringify(p.files)).digest('hex') !== p.sourceDigest)
      ) throw new Error('incomplete runtime supply-chain review')
    }
  }
  return document
}

export function admissionDecision(candidate, analysis, registry = { schemaVersion: 1, policyVersion: SCAN_POLICY_VERSION, reviews: [] }) {
  validateAdmissionReviews(registry)
  const binding = admissionBinding(candidate, analysis)
  const record = registry.reviews.find(r => r.binding === binding && r.commit === candidate.commit && r.repositoryUrl === candidate.repositoryUrl)
  const critical = (analysis.securityScan?.findings ?? []).filter(f => f.severity === 'critical')
  const unresolvedCritical = critical.filter(f => !(record?.dispositions ?? []).some(d =>
    d.file === f.file && d.rule === f.rule && d.line === f.line
    && analysis.sourceEvidence?.some(e => e.file === f.file && e.sha256 === d.sha256)))
  const hard = analysis.signals?.protectedDsh === true || unresolvedCritical.length > 0 || analysis.securityScan?.findingsTruncated === true
  const p = record?.permissions
  const falsePositive = signal => {
    const observed = (analysis.capabilityEvidence ?? []).filter(e => e.signal === signal)
    return observed.length > 0 && observed.every(e => (record?.capabilityDispositions ?? []).some(d =>
      d.signal === signal && d.file === e.file && d.line === e.line && sourceMatches(analysis, d)))
  }
  const permissionsMatch = p && (!analysis.signals.files || p.files !== 'none' || falsePositive('files'))
    && (!analysis.signals.network || p.network !== 'none' || falsePositive('network')) && (!analysis.signals.commands || p.commands !== 'none' || falsePositive('commands'))
    && (!analysis.signals.credentials || !p.credentials.includes('none') || falsePositive('credentials'))
  // Only known file/network/command/credential capabilities and configuration
  // overrides can enter this lane. Dependencies, code generation, unresolved
  // dynamic imports, unknown paths and install hooks remain blocked.
  const reviewable = analysis.reasons.every(reason => /^runtime source contains the (?:files|network|commands|credentials) permission signal$/.test(reason)
    || reason.startsWith('Bundle configuration overrides require review:')
    || (reason === 'Tool-view extension requires key ownership review; registration alone is not a protected component mutation' && reviewedToolViews(candidate, analysis, record))
    || (reason === 'runtime or optional dependencies require a separate supply-chain review' && reviewedSupplyChain(analysis, record))
    || (reason === 'fixed-source security findings require quarantine' && unresolvedCritical.length === 0)
    || (reason === 'fixed-source security warnings require review' && (analysis.securityScan?.findings ?? []).filter(f => f.severity === 'warning').every(f => ['child-process', 'shell-mode'].includes(f.rule))))
  const state = hard || record?.verdict === 'rejected' ? 'rejected'
    : !analysis.scanComplete ? 'incomplete'
      : analysis.approved ? 'source-verified'
        : record?.verdict === 'approved' && reviewable && permissionsMatch && analysis.contractVerified === true ? 'reviewed' : 'review-required'
  return {
    engine: SCAN_POLICY_VERSION, policyDigest: analysis.policyDigest ?? null, binding, state,
    sourceContract: analysis.contractVerified === true ? 'verified' : 'unverified',
    coverage: analysis.scanComplete ? 'complete' : 'incomplete',
    capabilities: hard ? 'prohibited' : analysis.approved ? 'low-risk-static' : state === 'reviewed' ? 'reviewed' : 'review-required',
    compatibility: 'per-version-declaration',
    ...(state === 'reviewed' ? { reviewer: record.reviewer, reviewedAt: record.reviewedAt, permissions: record.permissions } : {}),
  }
}
