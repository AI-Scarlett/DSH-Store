const moduleImport = names => new RegExp(
  `(?:\\bfrom\\s*|\\bimport\\s*(?:\\(\\s*)?|\\brequire\\s*\\(\\s*)["'](?:node:)?(?:${names})["']`,
  'i',
)

const FILE_MODULE = moduleImport('fs|fs/promises')
const NETWORK_MODULE = moduleImport('http|https|net|tls|dgram|axios|got|undici')
const COMMAND_MODULE = moduleImport('child_process')
// Match an actual command function call while ignoring member calls such as
// RegExp#exec() and parser.exec(). The scanner is intentionally conservative:
// imports and explicit shell modes still fail closed, but ordinary library
// member methods must not become command-capability evidence.
const COMMAND_CALL = /(?:^|[^\w$.'"`])(?:exec|execFile|spawn|fork)\s*\(/im
const SELF_MANAGER_REPOSITORY = 'https://github.com/AI-Scarlett/DSH-Store'
const GENERATED_CATALOG_DETAIL = /^registry\/catalog\/details\/[^/]+\.json$/i

export function isGeneratedSelfManagerCatalogDetail(candidate, relativePath) {
  const repository = typeof candidate?.repositoryUrl === 'string'
    ? candidate.repositoryUrl.trim().replace(/\.git\/?$/i, '').replace(/\/$/, '').toLowerCase()
    : null
  return String(candidate?.id ?? '').trim().toLowerCase() === 'dsh-safe-plugin-manager'
    && repository === SELF_MANAGER_REPOSITORY.toLowerCase()
    && GENERATED_CATALOG_DETAIL.test(String(relativePath ?? ''))
}

export function permissionSignals(source) {
  return {
    files: FILE_MODULE.test(source)
      || /\b(?:readFile|writeFile|appendFile|rename|unlink|mkdir|rmdir|rm)\s*\(/i.test(source)
      || /\$DSH_HOME|\.dsh\/profiles/i.test(source),
    network: NETWORK_MODULE.test(source)
      || /\b(?:fetch|WebSocket|EventSource)\s*\(/i.test(source)
      || /\b(?:axios|got|undici)\s*(?:\.|\()/i.test(source),
    commands: COMMAND_MODULE.test(source)
      || COMMAND_CALL.test(source)
      || /shell\s*:\s*true|Bun\.spawn|new\s+Deno\.Command/i.test(source),
    credentials: /process\.env/i.test(source)
      || /\b(?:keychain|credentials?|oauth)\b\s*(?:\.|\[|\()/i.test(source)
      || /\b(?:api[_-]?key|apiKey|access[_-]?token|accessToken|client[_-]?secret|clientSecret|password)\b/i.test(source),
    protectedDsh: /(?:__ModuleLoader__[^\n]{0,120}(?:unload|remove)|\bFiber\b[^\n]{0,120}(?:remove|disable|replace)|@deepseek-ai\/[^\n]{0,160}disabled\s*:\s*true|tool\.call\.toolview)/i.test(source),
  }
}

export function missingRuntimeEntryReasons(manifest, entries, prefix = '') {
  const files = new Set(entries.filter(item => item.type === 'blob' && item.mode !== '120000').map(item => item.path))
  const targets = new Set()
  const collect = value => {
    if (typeof value === 'string') targets.add(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(manifest.main)
  collect(manifest.module)
  collect(manifest.exports)
  collect(manifest.dsh?.client?.entry)
  return [...targets].filter(target => !target.includes('*')).flatMap(target => {
    const normalized = target.replace(/^\.\//, '')
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) return [`runtime artifact path is invalid: ${target}`]
    return files.has(prefix + normalized) ? [] : [`runtime artifact is missing from the fixed Git Commit: ${target}`]
  })
}
