import { scanSubmissionSources } from './submission-security-scan.mjs'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { sourceBudgetFindings, SCAN_POLICY_VERSION } from './source-scan-policy.mjs'
import { isGeneratedSelfManagerRegistryData, permissionSignals, dshInterfaceSignals, localModuleEvidence } from './automation-source-policy.mjs'
import { packageSourceSurface, SCANNABLE_SOURCE, NATIVE_ARTIFACT, unsupportedPackageEntry, missingLocalModuleReasons } from './package-source-surface.mjs'

function collectManifestTargets(value, targets = []) {
  if (typeof value === 'string') targets.push(value)
  else if (Array.isArray(value)) value.forEach(item => collectManifestTargets(item, targets))
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectManifestTargets(item, targets))
  return targets
}

function runtimeSourceClosure(manifest, sourcePaths, modulesByPath, runtimeContext = 'package') {
  const targets = runtimeContext === 'bin'
    ? collectManifestTargets(manifest.bin)
    : runtimeContext === 'node-library'
      ? collectManifestTargets([
        manifest.main, manifest.module, manifest.exports,
        manifest.dsh?.client?.entry, manifest.dsh?.bundle?.entry,
      ])
      : collectManifestTargets([
    // A package CLI is not loaded by DSH's main import, but it is an executable
    // package entry point and belongs in dynamic-loading review.
    manifest.main, manifest.module, manifest.exports,
    manifest.bin, manifest.dsh?.client?.entry, manifest.dsh?.bundle?.entry,
      ])
  const roots = new Set()
  for (const raw of targets) {
    const target = raw.startsWith('./') ? raw.slice(2) : raw
    if (!target || target.startsWith('/') || target.split('/').some(part => part === '..' || part === '.')) continue
    const wildcardCount = [...target].filter(char => char === '*').length
    if (wildcardCount === 0) {
      if (sourcePaths.has(target)) roots.add(target)
    } else if (wildcardCount === 1) {
      const [prefix, suffix] = target.split('*')
      for (const path of sourcePaths) if (path.startsWith(prefix) && path.endsWith(suffix)) roots.add(path)
    } else {
      // Unknown target patterns broaden review to the whole packaged source set.
      for (const path of sourcePaths) roots.add(path)
    }
  }
  if (runtimeContext === 'bin' && targets.length === 0) return new Set()
  if (targets.length === 0 && sourcePaths.has('index.js')) roots.add('index.js')
  // If the manifest does not expose a source entry we cannot safely narrow
  // runtime attribution, so retain the prior conservative all-source behavior.
  if (roots.size === 0) for (const path of sourcePaths) roots.add(path)

  const reachable = new Set()
  const pending = [...roots]
  while (pending.length) {
    const from = pending.pop()
    if (reachable.has(from)) continue
    reachable.add(from)
    const modules = modulesByPath.get(from)
    for (const reference of modules?.references ?? []) {
      if (!reference.startsWith('.')) continue
      const refPath = reference.split(/[?#]/, 1)[0]
      if (!refPath || refPath.endsWith('/')) continue
      const target = posix.normalize(posix.join(posix.dirname(from), refPath))
      if (target === '..' || target.startsWith('../') || target.startsWith('/')) continue
      const alternatives = [target, ...['.js', '.mjs', '.cjs', '.json', '/index.js', '/index.mjs', '/index.cjs'].map(ext => target + ext)]
      if (/\.(?:ts|tsx|mts|cts)$/.test(from)) {
        const match = /\.(js|mjs|cjs)$/.exec(target)
        if (match) {
          const substitutions = { js: ['.ts', '.tsx', '.d.ts'], mjs: ['.mts', '.d.mts'], cjs: ['.cts', '.d.cts'] }
          alternatives.push(...substitutions[match[1]].map(extension => target.slice(0, -match[0].length) + extension))
        }
      }
      for (const candidate of alternatives) if (sourcePaths.has(candidate) && !reachable.has(candidate)) pending.push(candidate)
    }
  }
  return reachable
}

// Pure read-only review: the caller supplies bounded fixed-Commit text reads.
// This module never installs, imports or executes the inspected package.
export async function reviewFixedSource(candidate, manifest, tree, policy, readSource, options = {}) {
  const runtimeContext = options.runtimeContext ?? 'package'
  if (!['package', 'node-library'].includes(runtimeContext)) throw new Error('fixed-source runtime context is unsupported')
  const surface = packageSourceSurface(manifest, tree, candidate.installPath)
  const reasons = [...surface.reasons]
  const runtimeDependencies = { ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) }
  const resolutionEvidence = []
  if (Object.keys(runtimeDependencies).length > 0 && !policy.automaticApproval.allowRuntimeDependencies) {
    reasons.push('runtime or optional dependencies require a separate supply-chain review')
    const manifestDir = posix.dirname(candidate.manifestPath ?? 'package.json')
    const lockNames = ['npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
    const locks = (tree?.tree ?? []).filter(item => item.type === 'blob'
      && lockNames.includes(posix.basename(item.path))
      && (manifestDir === '.' ? !item.path.includes('/') : posix.dirname(item.path) === manifestDir))
    if (locks.length !== 1) {
      reasons.push('runtime dependencies do not have one unambiguous fixed lockfile for supply-chain review')
    } else {
      const lock = locks[0]
      try {
        const source = await readSource(lock.path, policy.sourceBounds.maxFileBytes)
        if (typeof source !== 'string' || Buffer.byteLength(source) !== lock.size
          || !/^[a-f0-9]{40}$/.test(lock.sha ?? '')
          || createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex') !== lock.sha) {
          reasons.push(`fixed dependency lockfile does not match the Git tree: ${lock.path}`)
        } else {
          resolutionEvidence.push({ file: lock.path, bytes: lock.size, blob: lock.sha, sha256: createHash('sha256').update(source).digest('hex') })
        }
      } catch {
        reasons.push(`fixed dependency lockfile could not be read within the review bound: ${lock.path}`)
      }
    }
  }
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
  const sourceEvidence = [], capabilityEvidence = [], toolViewEvidence = [], securitySources = []
  const modulesByPath = new Map()
  const legalFiles = surface.entries.filter(item => item.type === 'blob'
    && /^(?:licen[cs]e|copying|notice|third_party_notices)(?:\..*)?$/i.test(posix.basename(item.relativePath)))
  const licenseEvidence = []
  if (legalFiles.length > 8) reasons.push('package has too many fixed license/notice files for a bounded manual review')
  for (const item of legalFiles.slice(0, 8)) {
    try {
      const source = await readSource(item.path, policy.sourceBounds.maxFileBytes)
      if (typeof source !== 'string' || Buffer.byteLength(source) !== item.size
        || !/^[a-f0-9]{40}$/.test(item.sha ?? '')
        || createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex') !== item.sha) {
        reasons.push(`fixed license/notice file does not match the Git tree: ${item.relativePath}`)
        continue
      }
      licenseEvidence.push({ file: item.relativePath, bytes: item.size, blob: item.sha,
        sha256: createHash('sha256').update(source).digest('hex') })
    } catch {
      reasons.push(`fixed license/notice file could not be read within the review bound: ${item.relativePath}`)
    }
  }
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
        const toolView = dshInterfaceSignals(source, item.relativePath).toolViewExtension
        reviewSignals.toolViewExtension ||= toolView
        if (toolView) toolViewEvidence.push({ file: item.relativePath, sha256 })
        const modules = localModuleEvidence(source, item.relativePath)
        modulesByPath.set(item.relativePath, modules)
        reasons.push(...missingLocalModuleReasons(modules.references, item.relativePath, surface.entries))
      }
    }
  }
  const sourcePaths = new Set(runtimeFiles.filter(item => !/\.d\.(?:ts|mts|cts)$/i.test(item.relativePath)).map(item => item.relativePath))
  const runtimePaths = runtimeSourceClosure(manifest, sourcePaths, modulesByPath, runtimeContext)
  const binPaths = runtimeSourceClosure(manifest, sourcePaths, modulesByPath, 'bin')
  reviewSignals.dynamicModuleLoading = [...runtimePaths].some(path => modulesByPath.get(path)?.dynamic === true)
  reviewSignals.dynamicBinLoading = [...binPaths].some(path => modulesByPath.get(path)?.dynamic === true)
  const scanComplete = canScan && filesScanned === runtimeFiles.length && surface.complete && unsupported.length === 0
    && !reasons.some(reason => reason.startsWith('local module'))
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
  if (runtimeContext === 'node-library' && reviewSignals.dynamicBinLoading) reasons.push('package bin contains dynamic loading that requires separate review')
  return {
    reasons: [...new Set(reasons)],
    signals: Object.fromEntries(Object.entries(signals).map(([key, value]) => [key, value || (scanComplete ? false : null)])),
    securityScan,
    engine: SCAN_POLICY_VERSION,
    sourceDigest: createHash('sha256').update(JSON.stringify(sourceEvidence)).digest('hex'),
    sourceEvidence, capabilityEvidence, toolViewEvidence, budgetFindings,
    licenseEvidence,
    reviewSignals, scanComplete, filesScanned, unsupportedFiles: unsupported.length,
    scope: { kind: surface.kind, repositoryEntries: surface.repositoryEntries, packageEntries: surface.packageEntries, files: surface.entries.length },
    runtimeFiles: runtimeFiles.length, runtimeBytes: totalBytes,
    ...(Object.keys(runtimeDependencies).length ? { runtimeDependencies } : {}),
    ...(resolutionEvidence.length ? { resolutionEvidence } : {}),
    runtimeContext,
    runtimeEntryFiles: [...runtimePaths].sort((left, right) => left.localeCompare(right, 'en')),
    binEntryFiles: [...binPaths].sort((left, right) => left.localeCompare(right, 'en')),
  }
}
