import { isGeneratedSelfManagerCatalogDetail, permissionSignals, dshInterfaceSignals, localModuleEvidence } from './automation-source-policy.mjs'
import { packageSourceSurface, SCANNABLE_SOURCE, NATIVE_ARTIFACT, unsupportedPackageEntry, missingLocalModuleReasons } from './package-source-surface.mjs'

// Pure read-only review: the caller supplies bounded fixed-Commit text reads.
// This module never installs, imports or executes the inspected package.
export async function reviewFixedSource(candidate, manifest, tree, policy, readSource) {
  const surface = packageSourceSurface(manifest, tree, candidate.installPath)
  const reasons = [...surface.reasons]
  const signals = { files: false, network: false, commands: false, credentials: false, protectedDsh: false, nativeOrExecutableArtifacts: false }
  const reviewSignals = { toolViewExtension: false, dynamicModuleLoading: false }
  if (surface.packageEntries > policy.sourceBounds.maxTreeEntries) reasons.push('distributable package tree exceeds the automatic review bound')
  if (!policy.automaticApproval.allowSymlinks && surface.entries.some(item => item.mode === '120000')) reasons.push('package contains symbolic links')
  if (!policy.automaticApproval.allowSubmodules && surface.entries.some(item => item.mode === '160000' || item.type === 'commit')) reasons.push('package contains Git submodules')
  const unsupported = surface.entries.filter(unsupportedPackageEntry)
  if (unsupported.length) reasons.push(`package contains unsupported artifacts requiring review: ${unsupported.slice(0, 5).map(item => item.relativePath).join(', ')}`)
  signals.nativeOrExecutableArtifacts = surface.entries.some(item => item.mode === '100755' || NATIVE_ARTIFACT.test(item.relativePath))
  const runtimeFiles = surface.entries.filter(item => {
    const relativePath = item.relativePath
    // Retain the existing canonical-manager-only schema-validated data exception.
    if (isGeneratedSelfManagerCatalogDetail(candidate, relativePath)) return false
    return item.type === 'blob' && item.mode !== '120000' && SCANNABLE_SOURCE.test(relativePath)
  })
  const runtimeSizes = runtimeFiles.map(item => Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : policy.sourceBounds.maxFileBytes + 1)
  const totalBytes = runtimeSizes.reduce((sum, size) => sum + size, 0)
  const filesWithinBounds = runtimeFiles.length > 0 && runtimeFiles.length <= policy.sourceBounds.maxRuntimeFiles
  const bytesWithinBounds = runtimeSizes.every(size => size <= policy.sourceBounds.maxFileBytes)
    && totalBytes <= policy.sourceBounds.maxTotalRuntimeBytes
  if (!filesWithinBounds) reasons.push(`runtime source file count is outside the automatic review bound: ${runtimeFiles.length} files (maximum ${policy.sourceBounds.maxRuntimeFiles})`)
  if (!bytesWithinBounds) reasons.push(`runtime source exceeds the automatic review byte bound: ${totalBytes} total bytes (maximum ${policy.sourceBounds.maxTotalRuntimeBytes}); largest file ${Math.max(0, ...runtimeSizes)} bytes (maximum ${policy.sourceBounds.maxFileBytes})`)
  let filesScanned = 0
  const canScan = filesWithinBounds && bytesWithinBounds && tree?.truncated === false
    && surface.packageEntries <= policy.sourceBounds.maxTreeEntries
  if (canScan) {
    for (let index = 0; index < runtimeFiles.length; index += 8) {
      const batch = runtimeFiles.slice(index, index + 8)
      const sources = await Promise.all(batch.map(item => readSource(item.path, policy.sourceBounds.maxFileBytes)))
      for (let offset = 0; offset < sources.length; offset++) {
        const source = sources[offset]
        const item = batch[offset]
        if (typeof source !== 'string' || Buffer.byteLength(source) !== item.size) {
          reasons.push(`fixed source byte size does not match tree: ${item.relativePath}`)
          continue
        }
        filesScanned++
        const current = permissionSignals(source, item.relativePath)
        for (const key of Object.keys(current)) signals[key] ||= current[key]
        reviewSignals.toolViewExtension ||= dshInterfaceSignals(source, item.relativePath).toolViewExtension
        const modules = localModuleEvidence(source, item.relativePath)
        reviewSignals.dynamicModuleLoading ||= modules.dynamic
        reasons.push(...missingLocalModuleReasons(modules.references, item.relativePath, surface.entries))
      }
    }
  }
  const scanComplete = canScan && filesScanned === runtimeFiles.length && surface.complete && unsupported.length === 0
  if (!scanComplete) reasons.push('fixed-source scan is incomplete; unobserved capability signals are unknown')
  for (const [signal, allowed] of Object.entries(policy.automaticApproval.permissionSignals)) {
    if (!allowed && signals[signal]) reasons.push(`runtime source contains the ${signal} permission signal`)
  }
  if (reviewSignals.toolViewExtension) reasons.push('tool.call.toolview extension requires key ownership review; registration alone is not a protected component mutation')
  if (reviewSignals.dynamicModuleLoading) reasons.push('dynamic module loading or code evaluation requires separate review')
  return {
    reasons: [...new Set(reasons)],
    signals: Object.fromEntries(Object.entries(signals).map(([key, value]) => [key, value || (scanComplete ? false : null)])),
    reviewSignals, scanComplete, filesScanned,
    scope: { kind: surface.kind, repositoryEntries: surface.repositoryEntries, packageEntries: surface.packageEntries, files: surface.entries.length },
    runtimeFiles: runtimeFiles.length, runtimeBytes: totalBytes,
  }
}
