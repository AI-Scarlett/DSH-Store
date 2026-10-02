const moduleImport = names => new RegExp(
  `(?:\\bfrom\\s*|\\bimport\\s*(?:\\(\\s*)?|\\brequire\\s*\\(\\s*)["'](?:node:)?(?:${names})["']`,
  'i',
)

const FILE_MODULE = moduleImport('fs|fs/promises')
const NETWORK_MODULE = moduleImport('http|https|net|tls|dgram|axios|got|undici')
const COMMAND_MODULE = moduleImport('child_process')
// Match an actual command function call while ignoring member calls such as
// RegExp#exec() and parser.exec(). JavaScript source is lexically masked first
// so comments, help text, and template-literal prose are not treated as code.
const COMMAND_CALL = /(?:^|[^\w$.'"`])(?:exec|execFile|spawn|fork)\s*\(/im
const SELF_MANAGER_REPOSITORY = 'https://github.com/AI-Scarlett/DSH-Store'
const GENERATED_CATALOG_DETAIL = /^registry\/catalog\/details\/[^/]+\.json$/i
const TEST_SOURCE_FILE = /^(?:test|spec)[-_.].*\.(?:[cm]?[jt]sx?|json|ya?ml|sh|py|rb|go|rs)$/i
const SUFFIXED_TEST_SOURCE_FILE = /^.+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i

export function isTestSourceFile(relativePath) {
  const name = String(relativePath ?? '').split('/').at(-1) ?? ''
  return TEST_SOURCE_FILE.test(name) || SUFFIXED_TEST_SOURCE_FILE.test(name)
}

export function isBoundedSourceLineage(lineage, maxCommitSpan, { allowDiverged = false } = {}) {
  if (!lineage || !Number.isInteger(maxCommitSpan) || maxCommitSpan < 1) return false
  if (lineage.status === 'ahead') {
    return Number.isInteger(lineage.total_commits)
      && lineage.total_commits > 0
      && lineage.total_commits <= maxCommitSpan
  }
  if (!allowDiverged || lineage.status !== 'diverged') return false
  const aheadBy = lineage.ahead_by
  const behindBy = lineage.behind_by
  return Number.isInteger(lineage.total_commits)
    && Number.isInteger(aheadBy) && aheadBy > 0
    && Number.isInteger(behindBy) && behindBy > 0
    && lineage.total_commits === aheadBy
    && aheadBy + behindBy <= maxCommitSpan
    && /^[0-9a-f]{40}$/.test(lineage.merge_base_commit?.sha ?? '')
}

export function isNoCommonAncestorError(error, baseCommit, candidateCommit) {
  if (error?.status !== 404 || !/^[0-9a-f]{40}$/.test(baseCommit ?? '')
    || !/^[0-9a-f]{40}$/.test(candidateCommit ?? '')) return false
  const message = String(error?.message ?? '').trim()
  return message === `No common ancestor between ${baseCommit} and ${candidateCommit}.`
    || message === `No common ancestor between ${baseCommit} and ${candidateCommit}`
}

export function isGeneratedSelfManagerCatalogDetail(candidate, relativePath) {
  const repository = typeof candidate?.repositoryUrl === 'string'
    ? candidate.repositoryUrl.trim().replace(/\.git\/?$/i, '').replace(/\/$/, '').toLowerCase()
    : null
  return String(candidate?.id ?? '').trim().toLowerCase() === 'dsh-safe-plugin-manager'
    && repository === SELF_MANAGER_REPOSITORY.toLowerCase()
    && GENERATED_CATALOG_DETAIL.test(String(relativePath ?? ''))
}

const JAVASCRIPT_SOURCE = /\.(?:[cm]?[jt]sx?|[cm]?ts)$/i
const EXPRESSION_PREFIX_KEYWORDS = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new',
  'of', 'return', 'throw', 'typeof', 'void', 'yield',
])
const CONTROL_PAREN_KEYWORDS = new Set(['catch', 'for', 'if', 'switch', 'while', 'with'])

function blankNonCode(source, start, end, output) {
  for (let index = start; index < end; index++) {
    if (source[index] !== '\n' && source[index] !== '\r') output[index] = ' '
  }
}

// A deliberately small JavaScript/TypeScript lexer, not a parser. It retains
// code positions (including `${...}` expressions) and blanks comments, quoted
// strings, template raw text, and regex literals without changing offsets.
function javascriptCode(source, { keepStrings = false } = {}) {
  // Keep UTF-16 indexing aligned with RegExp match.index.
  const output = source.split('')
  const templates = []
  const parens = []
  let mode = 'code'
  let canStartRegex = true
  let previousWord = ''

  for (let index = 0; index < source.length;) {
    const char = source[index]
    const next = source[index + 1]

    if (mode === 'template') {
      if (char === '\\') {
        blankNonCode(source, index, Math.min(source.length, index + 2), output)
        index += 2
      } else if (char === '`') {
        if (!keepStrings) output[index] = ' '
        templates.pop()
        mode = 'code'
        canStartRegex = false
        previousWord = ''
        index++
      } else if (char === '$' && next === '{') {
        output[index] = output[index + 1] = ' '
        templates.at(-1).expressionDepth = 0
        mode = 'code'
        canStartRegex = true
        previousWord = ''
        index += 2
      } else {
        if (!keepStrings) blankNonCode(source, index, index + 1, output)
        index++
      }
      continue
    }

    if (char === '/' && next === '/') {
      let end = index + 2
      while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end++
      blankNonCode(source, index, end, output)
      index = end
      continue
    }
    if (char === '/' && next === '*') {
      let end = index + 2
      while (end < source.length && !(source[end] === '*' && source[end + 1] === '/')) end++
      end = Math.min(source.length, end + 2)
      blankNonCode(source, index, end, output)
      index = end
      continue
    }
    if (char === "'" || char === '"') {
      let end = index + 1
      while (end < source.length) {
        if (source[end] === '\\') { end += 2; continue }
        if (source[end] === char) { end++; break }
        end++
      }
      end = Math.min(source.length, end)
      if (!keepStrings) blankNonCode(source, index, end, output)
      index = end
      canStartRegex = false
      previousWord = ''
      continue
    }
    if (char === '`') {
      if (!keepStrings) output[index] = ' '
      templates.push({ expressionDepth: null })
      mode = 'template'
      index++
      continue
    }
    if (char === '/' && canStartRegex && next !== '=' && next !== '/' && next !== '*') {
      let end = index + 1
      let inCharacterClass = false
      while (end < source.length) {
        if (source[end] === '\\') { end += 2; continue }
        if (source[end] === '[') inCharacterClass = true
        else if (source[end] === ']') inCharacterClass = false
        else if (source[end] === '/' && !inCharacterClass) { end++; break }
        else if (source[end] === '\n' || source[end] === '\r') break
        end++
      }
      while (/[A-Za-z]/.test(source[end] ?? '')) end++
      blankNonCode(source, index, end, output)
      index = end
      canStartRegex = false
      previousWord = ''
      continue
    }

    if (/\s/.test(char)) { index++; continue }
    const template = templates.at(-1)
    if (char === '{' && template?.expressionDepth !== null && template?.expressionDepth !== undefined) {
      template.expressionDepth++
      canStartRegex = true
      previousWord = ''
      index++
      continue
    }
    if (char === '}' && template?.expressionDepth !== null && template?.expressionDepth !== undefined) {
      if (template.expressionDepth === 0) {
        output[index] = ' '
        template.expressionDepth = null
        mode = 'template'
        index++
        continue
      }
      template.expressionDepth--
      canStartRegex = false
      previousWord = ''
      index++
      continue
    }
    if (/[A-Za-z_$]/.test(char)) {
      let end = index + 1
      while (/[\w$]/.test(source[end] ?? '')) end++
      const word = source.slice(index, end)
      canStartRegex = EXPRESSION_PREFIX_KEYWORDS.has(word)
      previousWord = word
      index = end
      continue
    }
    if (/[0-9]/.test(char)) {
      let end = index + 1
      while (/[$\w.]/.test(source[end] ?? '')) end++
      canStartRegex = false
      previousWord = ''
      index = end
      continue
    }
    if (char === '(') {
      parens.push(CONTROL_PAREN_KEYWORDS.has(previousWord))
      canStartRegex = true
    } else if (char === ')') {
      canStartRegex = parens.pop() ?? false
    } else if (char === ']' || char === '.') {
      canStartRegex = false
    } else if (char === '}') {
      canStartRegex = true
    } else {
      canStartRegex = !/[)\]}]/.test(char)
    }
    previousWord = ''
    index++
  }
  return output.join('')
}

function hasCodeMatch(pattern, source, code) {
  const matcher = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  let match
  while ((match = matcher.exec(source)) !== null) {
    if (code[match.index] !== ' ') return true
    if (match[0].length === 0) matcher.lastIndex++
  }
  return false
}

export function permissionSignals(source, relativePath = '') {
  const text = String(source ?? '')
  const useJavaScriptLexer = !relativePath || JAVASCRIPT_SOURCE.test(relativePath)
  const code = useJavaScriptLexer ? javascriptCode(text) : text
  const moduleSignal = (pattern) => useJavaScriptLexer
    ? hasCodeMatch(pattern, text, code)
    : pattern.test(text)
  return {
    files: moduleSignal(FILE_MODULE)
      || /\b(?:readFile|writeFile|appendFile|rename|unlink|mkdir|rmdir|rm)\s*\(/i.test(code)
      || /\bprocess\s*\.\s*env\s*\.\s*DSH_HOME\b/i.test(code),
    network: moduleSignal(NETWORK_MODULE)
      || /\b(?:fetch|WebSocket|EventSource)\s*\(/i.test(code)
      || /\b(?:axios|got|undici)\s*(?:\.|\()/i.test(code),
    commands: moduleSignal(COMMAND_MODULE)
      || COMMAND_CALL.test(code)
      || /shell\s*:\s*true|Bun\.spawn|new\s+Deno\.Command/i.test(code),
    credentials: /process\s*\.\s*env/i.test(code)
      || /\b(?:keychain|credentials?|oauth)\b\s*(?:\.|\[|\()/i.test(code)
      || /\b(?:api[_-]?key|apiKey|access[_-]?token|accessToken|client[_-]?secret|clientSecret|password)\b/i.test(code),
    protectedDsh: dshInterfaceSignals(text, relativePath).protectedDsh,
  }
}

// A supported tool-view slot is not a Loader/Fiber mutation. Static known
// official keys remain protected; dynamic/third-party keys require review, not
// automatic approval or a claim that the official inventory was overwritten.
export function dshInterfaceSignals(source, relativePath = '') {
  const text = String(source ?? '')
  const js = !relativePath || JAVASCRIPT_SOURCE.test(relativePath)
  const code = js ? javascriptCode(text) : text
  const literals = js ? javascriptCode(text, { keepStrings: true }) : text
  const directMutation = /\b(?:__ModuleLoader__|loader|fiber|Loader|Fiber)\s*(?:\?\.|\.)\s*(?:unload|insert|remove|patch|enable|disable|write|mutate|replace)\s*(?:\?\.)?\s*\(/i.test(code)
  const computedMutation = /\b(?:__ModuleLoader__|loader|fiber|Loader|Fiber)\s*\[\s*['"](?:unload|insert|remove|patch|enable|disable|write|mutate|replace)['"]\s*\]\s*\(/i
  // A live reference remains review-only even when registration is delegated
  // through an alias/wrapper. It is not proof of a mutation or key ownership.
  const toolViewExtension = /\btool\.call\.toolview\b/.test(literals)
  const officialKey = /\bkey\s*:\s*['"](?:bash|read|edit|write|ask_user_question|ui-settings-plugin-inventory)['"]/i
  const registrations = [...literals.matchAll(/\bslots\s*\.\s*register\s*\(\s*(\{[^{}]{0,1000}\})/g)]
  const knownOfficialOverride = registrations.some(match => {
    const start = match.index + match[0].indexOf('{')
    const objectCode = code.slice(start, start + match[1].length)
    if (code[match.index] === ' ' || objectCode.includes('...')
      || [...objectCode.matchAll(/\bkey\s*:/g)].length !== 1
      || [...objectCode.matchAll(/\bname\s*:/g)].length !== 1) return false
    return hasCodeMatch(/\bname\s*:\s*['"]tool\.call\.toolview['"]/, match[1], objectCode)
      && hasCodeMatch(officialKey, match[1], objectCode)
  })
  const protectedDsh = directMutation || hasCodeMatch(computedMutation, literals, code)
    || (!js && /@deepseek-ai\/[^\n]{0,160}disabled\s*:\s*true/i.test(text))
    || knownOfficialOverride
  return { protectedDsh, toolViewExtension }
}

export function localModuleEvidence(source, relativePath) {
  if (!JAVASCRIPT_SOURCE.test(relativePath)) return { references: [], dynamic: false }
  const text = String(source)
  const code = javascriptCode(text)
  const pattern = /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"\r\n]+)['"]/g
  const references = []
  let match
  while ((match = pattern.exec(text))) {
    if (code[match.index] !== ' ') references.push(match[1])
  }
  const calls = /\b(?:import|require)\s*\(/g
  let dynamic = false
  while ((match = calls.exec(code))) {
    if (!/^\s*['"][^'"\r\n]+['"]\s*\)/.test(text.slice(match.index + match[0].length))) dynamic = true
  }
  if (/\b(?:eval|Function)\s*\(/.test(code)) dynamic = true
  return { references: [...new Set(references)], dynamic }
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
