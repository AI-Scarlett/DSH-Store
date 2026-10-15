import { createHash } from 'node:crypto'
import { SCAN_POLICY_VERSION } from './source-scan-policy.mjs'

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
  const permissionsMatch = p && (!analysis.signals.files || p.files !== 'none')
    && (!analysis.signals.network || p.network !== 'none') && (!analysis.signals.commands || p.commands !== 'none')
    && (!analysis.signals.credentials || !p.credentials.includes('none'))
  // Only known file/network/command/credential capabilities and configuration
  // overrides can enter this lane. Dependencies, code generation, unresolved
  // dynamic imports, unknown paths and install hooks remain blocked.
  const reviewable = analysis.reasons.every(reason => /^runtime source contains the (?:files|network|commands|credentials) permission signal$/.test(reason)
    || reason.startsWith('Bundle configuration overrides require review:')
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
