// Shared resource limits for submission and Catalog review. These are scanner
// budgets, never a requirement to minify or restructure a plugin.
export const SCAN_POLICY_VERSION = 'bounded-source-v3'
export const SOURCE_SCAN_BOUNDS = Object.freeze({
  maxTreeEntries: 1200, maxRuntimeFiles: 512,
  maxFileBytes: 4 * 1024 * 1024, maxTotalRuntimeBytes: 8 * 1024 * 1024,
})
export const MANIFEST_MAX_BYTES = 262144

export function sourceBudgetFindings(files, bounds = SOURCE_SCAN_BOUNDS) {
  const findings = []
  const add = (rule, actual, limit, file = null) => findings.push({
    rule, responsibility: 'store-scanner', file, actual, limit,
    action: 'Use a larger bounded review budget; do not rewrite plugin functionality to satisfy the scanner.',
  })
  if (!files.length || files.length > bounds.maxRuntimeFiles) add('source-file-count', files.length, bounds.maxRuntimeFiles)
  let total = 0
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) add('source-size-unknown', null, bounds.maxFileBytes, file.relativePath ?? file.path)
    else {
      total += file.size
      if (file.size > bounds.maxFileBytes) add('source-file-bytes', file.size, bounds.maxFileBytes, file.relativePath ?? file.path)
    }
  }
  if (total > bounds.maxTotalRuntimeBytes) add('source-total-bytes', total, bounds.maxTotalRuntimeBytes)
  return { findings, total }
}
