import { scanSubmissionSources } from './submission-security-scan.mjs'
import { createHash } from 'node:crypto'
import { sourceBudgetFindings, SCAN_POLICY_VERSION } from './source-scan-policy.mjs'
import { isGeneratedSelfManagerRegistryData, permissionSignals, dshInterfaceSignals, localModuleEvidence } from './automation-source-policy.mjs'
import { packageSourceSurface, SCANNABLE_SOURCE, NATIVE_ARTIFACT, unsupportedPackageEntry, missingLocalModuleReasons } from './package-source-surface.mjs'

// Pure read-only review: the caller supplies bounded fixed-Commit text reads.
// This module never installs, imports or executes the inspected package.
export async function reviewFixedSource(candidate, manifest, tree, policy, readSource, options = {}) {
  const surface = packageSourceSurface(manifest, tree, candidate.installPath)
  const reasons = [...surface.reasons]
  const signals = { files: false, network: false, commands: false, credentials: false, protectedDsh: false, nativeOrExecutableArtifacts: false }
  const reviewSignals = { toolViewExtension: false, dynamicModuleLoading: false }
  if (surface.packageEntries > policy.sourceBounds.maxTreeEntries) reasons.push('distributable package tree exceeds the automatic review bound')
  if (!policy.automaticApproval.allowSymlinks && surface.entries.some(item => item.mode === '120000')) reasons.push('package contains symbolic links')
  if (!policy.automaticApproval.allowSubmodules && surface.entries.some(item => item.mode === '160000' || item.type === 'commit')) reasons.push('package contains Git submodules')
  const unsupported = surface.entries.filter(item => unsupportedPackageEntry(item)
    && !isGeneratedSelfManagerRegistryData(candidate, item.relativePath))
  if (unsupported.length) reasons.push(`package contains unsupported artifacts requiring review: ${unsupported.slice(0, 5).map(item => item.relativePath).join(', ')}`)
  signals.nativeOrExecutableArtifacts = surface.entries.some(item => item.mode === '100755' || NATIVE_ARTIFACT.test(item.relativePath))
  const runtimeFiles = surface.entries.filter(item => {
    const relativePath = item.relativePath
    // These exact canonical-manager JSON paths are schema-validated by the
    // repository gate before automation scans a fixed source Commit.
    if (isGeneratedSelfManagerRegistryData(candidate, relativePath)) return false
    return item.type === 'blob' && item.mode !== '120000' && SCANNABLE_SOURCE.test(relativePath)
  })
  const { findings: budgetFindings, total: totalBytes } = sourceBudgetFindings(runtimeFiles, policy.sourceBounds)
  for (const finding of budgetFindings) reasons.push(`scanner budget ${finding.rule}: ${finding.file ?? 'package'} actual=${finding.actual ?? 'unknown'} maximum=${finding.limit}; store scanner review required`)
  const sourceEvidence = [], capabilityEvidence = [], securitySources = []
  let filesScanned = 0
  const canScan = budgetFindings.length === 0 && tree?.truncated === false
    && surface.packageEntries <= policy.sourceBounds.maxTreeEntries
  // Preserve observed evidence even when another file is too large. Selection
  // is deterministic and all reads remain bounded; partial never means safe.
  let selectedBytes = 0
  const selected = runtimeFiles.filter(item => {
    if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > policy.sourceBounds.maxFileBytes
      || selectedBytes + item.size > policy.sourceBounds.maxTotalRuntimeBytes) return false
    selectedBytes += item.size
    return true
  }).slice(0, policy.sourceBounds.maxRuntimeFiles)
  {
    for (let index = 0; index < selected.length; index += 8) {
      const batch = selected.slice(index, index + 8)
      const sources = await Promise.all(batch.map(item => readSource(item.path, policy.sourceBounds.maxFileBytes)))
      for (let offset = 0; offset < sources.length; offset++) {
        const source = sources[offset]
        const item = batch[offset]
        if (typeof source !== 'string' || Buffer.byteLength(source) !== item.size) {
          reasons.push(`fixed source byte size does not match tree: ${item.relativePath}`)
          continue
        }
        const sha256 = createHash('sha256').update(source).digest('hex')
        if (item.sha && /^[a-f0-9]{40}$/.test(item.sha)) {
          const gitBlob = createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex')
          if (gitBlob !== item.sha) { reasons.push(`fixed source blob hash does not match tree: ${item.relativePath}`); continue }
        }
        filesScanned++
        sourceEvidence.push({ file: item.relativePath, bytes: item.size, blob: item.sha ?? null, sha256 })
        options.onSource?.({ path: item.relativePath, source })
        securitySources.push({ path: item.relativePath, source })
        const current = permissionSignals(source, item.relativePath)
        for (const key of Object.keys(current)) {
          signals[key] ||= current[key]
          if (current[key]) {
            const lines = source.split(/\r?\n/)
            const found = lines.findIndex(line => permissionSignals(line, item.relativePath)[key])
            capabilityEvidence.push({ rule: `capability-${key}`, file: item.relativePath, signal: key,
              responsibility: 'reviewer', line: found < 0 ? null : found + 1, location: found < 0 ? 'file' : 'line' })
          }
        }
        reviewSignals.toolViewExtension ||= dshInterfaceSignals(source, item.relativePath).toolViewExtension
        const modules = localModuleEvidence(source, item.relativePath)
        reviewSignals.dynamicModuleLoading ||= modules.dynamic
        reasons.push(...missingLocalModuleReasons(modules.references, item.relativePath, surface.entries))
      }
    }
  }
  const scanComplete = canScan && filesScanned === runtimeFiles.length && surface.complete && unsupported.length === 0
  if (!scanComplete) reasons.push('fixed-source scan is incomplete; unobserved capability signals are unknown')
  const securityScan = scanSubmissionSources(securitySources, { packaged: true, eligibleFiles: runtimeFiles.length, capped: !scanComplete })
  if (securityScan.verdict === 'fail') reasons.push('fixed-source security findings require quarantine')
  if (securityScan.findings.some(f => f.severity === 'warning')) reasons.push('fixed-source security warnings require review')
  if (securityScan.findingsTruncated) reasons.push('security finding coverage is truncated')
  for (const [signal, allowed] of Object.entries(policy.automaticApproval.permissionSignals)) {
    if (!allowed && signals[signal]) reasons.push(`runtime source contains the ${signal} permission signal`)
  }
  if (reviewSignals.toolViewExtension) reasons.push('Tool-view extension requires key ownership review; registration alone is not a protected component mutation')
  if (reviewSignals.dynamicModuleLoading) reasons.push('dynamic module loading or code evaluation requires separate review')
  return {
    reasons: [...new Set(reasons)],
    signals: Object.fromEntries(Object.entries(signals).map(([key, value]) => [key, value || (scanComplete ? false : null)])),
    securityScan,
    engine: SCAN_POLICY_VERSION,
    sourceDigest: createHash('sha256').update(JSON.stringify(sourceEvidence)).digest('hex'),
    sourceEvidence, capabilityEvidence, budgetFindings,
    reviewSignals, scanComplete, filesScanned, unsupportedFiles: unsupported.length,
    scope: { kind: surface.kind, repositoryEntries: surface.repositoryEntries, packageEntries: surface.packageEntries, files: surface.entries.length },
    runtimeFiles: runtimeFiles.length, runtimeBytes: totalBytes,
  }
}
