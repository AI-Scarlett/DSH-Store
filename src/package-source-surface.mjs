import { posix } from 'node:path'

export const SCANNABLE_SOURCE = /\.(?:[cm]?[jt]sx?|json|ya?ml|sh|bash|zsh|fish|py|rb|php|go|rs|java|kt|kts|swift|cs|c|cc|cpp|h|hpp|ps1|psm1|cmd|bat|html?|vue|svelte)$/i
export const NATIVE_ARTIFACT = /\.(?:node|wasm|dll|dylib|so|exe|bin)$/i
const STATIC_ASSET = /\.(?:md|txt|rst|png|jpe?g|webp|gif|ico|svg|css|woff2?|ttf|otf|map)$/i
const METADATA = /^(?:package\.json|npm-shrinkwrap\.json|readme(?:\..*)?|licen[cs]e(?:\..*)?|copying(?:\..*)?)$/i
const ALWAYS_EXCLUDED = /(?:^|\/)(?:\.git|node_modules)(?:\/|$)|^(?:package-lock\.json|\.npmrc)$/i

function validPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 1024
    && !path.startsWith('/') && !/[\\\0\r\n]/.test(path)
    && !path.split('/').some(part => part === '..' || part === '.' || part === '')
}

function targetsOf(value, targets = []) {
  if (typeof value === 'string') targets.push(value)
  else if (Array.isArray(value)) value.forEach(item => targetsOf(item, targets))
  else if (value && typeof value === 'object') Object.values(value).forEach(item => targetsOf(item, targets))
  return targets
}

// Support only positive literal paths, directories, segment * and directory/**.
// Unknown npm/glob semantics never narrow the review surface: fall back to the
// whole package and mark it incomplete. Ignore rules can only remove members;
// this is a conservative superset, not a claim to reproduce npm's packlist.
function selector(value) {
  if (typeof value !== 'string') return null
  const path = value.replace(/^\.\//, '').replace(/\/$/, '')
  if (!validPath(path) || /[!{}()[\]?]/.test(path)
    || path.split('/').some(part => part.includes('**') && part !== '**')) return null
  const segments = path.split('/')
  const pattern = segments.map((part, index) => {
    if (part === '**') return index < segments.length - 1 ? '(?:[^/]+/)*' : '.*'
    const escaped = part.split('*').map(text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')
    return escaped + (index < segments.length - 1 ? '/' : '')
  }).join('')
  return new RegExp(`^${pattern}(?:/.*)?$`)
}

export function packageSourceSurface(manifest, tree, installPath = '') {
  const reasons = []
  const directory = String(installPath ?? '').replace(/\/$/, '')
  if (directory && !validPath(directory)) reasons.push('package directory is invalid')
  const prefix = directory ? `${directory}/` : ''
  if (!Array.isArray(tree?.tree) || tree.tree.length === 0) reasons.push('repository tree is missing or empty')
  if (tree?.truncated !== false) reasons.push('repository tree completeness is unverified')
  const records = []
  const seen = new Set()
  for (const item of tree?.tree ?? []) {
    if (!validPath(item?.path) || seen.has(item.path)) {
      reasons.push('repository tree contains an invalid or duplicate path')
      continue
    }
    seen.add(item.path)
    if (prefix && !item.path.startsWith(prefix)) continue
    records.push({ ...item, relativePath: item.path.slice(prefix.length) })
  }
  const explicit = Array.isArray(manifest.files) && manifest.files.length > 0
  const selectors = explicit ? manifest.files.map(selector) : []
  const unsupported = manifest.files !== undefined && (!explicit || selectors.some(item => !item))
  if (unsupported) reasons.push('manifest files selectors are unsupported or ambiguous; whole-package fallback requires review')
  if (manifest.directories?.bin) reasons.push('directories.bin packaging requires explicit review')
  const automaticTargets = targetsOf(manifest.bin)
  if (typeof manifest.main === 'string') automaticTargets.push(manifest.main)
  const automatic = new Set(automaticTargets.map(path => path.replace(/^\.\//, '')))
  const selected = records.filter(item => !ALWAYS_EXCLUDED.test(item.relativePath)
    && (!explicit || unsupported || METADATA.test(item.relativePath) || automatic.has(item.relativePath)
      || selectors.some(pattern => pattern.test(item.relativePath))))
  const entries = selected.filter(item => item.type !== 'tree')
  const paths = new Set(entries.filter(item => item.type === 'blob' && item.mode !== '120000').map(item => item.relativePath))
  const required = targetsOf([manifest.main, manifest.module, manifest.exports, manifest.bin,
    manifest.types, manifest.typings, manifest.dsh?.client?.entry, manifest.dsh?.bundle?.patch])
  // Node's default main is also an implicit runtime entry when present.
  if (!manifest.main && records.some(item => item.relativePath === 'index.js') && !paths.has('index.js')) {
    reasons.push('default runtime entry is outside the distributable surface: index.js')
  }
  for (const raw of required) {
    const target = raw.replace(/^\.\//, '')
    if (!validPath(target)) reasons.push(`runtime artifact path is invalid: ${raw}`)
    else if (target.includes('*')) reasons.push(`runtime artifact pattern requires review: ${raw}`)
    else if (!paths.has(target)) reasons.push(`runtime artifact is missing from the distributable surface: ${raw}`)
  }
  // Nested ignore files can remove entrypoints; do not assert a complete
  // installable artifact without resolving their semantics.
  if (records.some(item => /(?:^|\/)\.(?:npmignore|gitignore)$/.test(item.relativePath)
    && ((!explicit || unsupported) || (item.relativePath.includes('/')
      && selected.some(other => other.relativePath.startsWith(item.relativePath.slice(0, item.relativePath.lastIndexOf('/') + 1))))))) {
    reasons.push('package ignore rules require artifact review')
  }
  return {
    kind: explicit && !unsupported ? 'explicit-files-conservative-superset' : 'whole-package-conservative-superset',
    complete: reasons.length === 0,
    reasons: [...new Set(reasons)], entries, prefix,
    repositoryEntries: tree?.tree?.length ?? 0,
    packageEntries: selected.length,
  }
}

export function unsupportedPackageEntry(item) {
  return item.type !== 'blob' || !['100644', '100755'].includes(item.mode)
    || NATIVE_ARTIFACT.test(item.relativePath)
    || (!SCANNABLE_SOURCE.test(item.relativePath) && !STATIC_ASSET.test(item.relativePath)
      && !METADATA.test(item.relativePath))
}

// This checks literal local module references only. Dynamic loading is a
// separate review signal; it must not be used to claim a proven dependency graph.
export function missingLocalModuleReasons(references, from, entries) {
  const paths = new Set(entries.filter(item => item.type === 'blob' && item.mode !== '120000').map(item => item.relativePath))
  return references.filter(ref => ref.startsWith('.')).flatMap(ref => {
    const target = posix.normalize(posix.join(posix.dirname(from), ref))
    if (!validPath(target)) return [`local module escapes the package: ${from}`]
    const alternatives = [target, ...['.js', '.mjs', '.cjs', '.json', '/index.js', '/index.mjs', '/index.cjs'].map(ext => target + ext)]
    return alternatives.some(path => paths.has(path)) ? [] : [`local module is missing from the distributable surface: ${from} -> ${ref}`]
  })
}
