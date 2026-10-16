// Deliberately bounded YAML subset. No evaluation, aliases, tags, flow maps or
// multiline scalars. Unsupported syntax is a review blocker, never guessed.
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
function fail(message) { throw Object.assign(new Error(message), { code: 'BUNDLE_PATCH_AMBIGUOUS' }) }
function quotedSequence(text) {
  const result = []
  let cursor = 1
  const end = text.length - 1
  while (cursor < end) {
    while (/\s/.test(text[cursor] ?? '') && cursor < end) cursor++
    const start = cursor, quote = text[cursor]
    if (!['"', "'"].includes(quote) || result.length >= 64) fail('Unsupported Patch inline sequence requires review')
    cursor++
    let closed = false
    while (cursor < end) {
      if (quote === '"' && text[cursor] === '\\') { cursor += 2; continue }
      if (quote === "'" && text[cursor] === "'" && text[cursor + 1] === "'") { cursor += 2; continue }
      if (text[cursor++] === quote) { closed = true; break }
    }
    if (!closed) fail('Unterminated Patch inline string')
    result.push(scalar(text.slice(start, cursor)))
    while (/\s/.test(text[cursor] ?? '') && cursor < end) cursor++
    if (cursor === end) break
    if (text[cursor++] !== ',' || !text.slice(cursor, end).trim()) fail('Malformed Patch inline sequence')
  }
  return result
}
function scalar(raw) {
  const text = raw.trim()
  if (text === '{}') return Object.create(null)
  if (text === '[]') return []
  if (text.startsWith('[') && text.endsWith(']')) return quotedSequence(text)
  if (text.startsWith('"')) {
    try { const v = JSON.parse(text); if (typeof v === 'string') return v } catch {}
    fail('Invalid quoted Patch scalar')
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) fail('Invalid quoted Patch scalar')
    return text.slice(1, -1).replaceAll("''", "'")
  }
  if (!text || /^[&*!|>{}\[\]"']/.test(text) || /:\s|\s[&*!]|[\[\]{}]/.test(text)) fail('Unsupported Patch scalar requires review')
  return text
}
function object(node) { return node?.value && !Array.isArray(node.value) && typeof node.value === 'object' }

export function bundlePatchContract(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 512 * 1024) fail('Bundle Patch exceeds the bounded parser limit')
  const tokens = source.split(/\r?\n/).map((text, i) => ({ text, line: i + 1 }))
    .filter(row => row.text.trim() && !row.text.trimStart().startsWith('#'))
    .map(row => {
      if (/\t/.test(row.text)) fail('Patch tabs require review')
      // Strip comments only outside quotes. Preserve hashes inside values.
      let quote = null, end = row.text.length
      for (let i = 0; i < row.text.length; i++) {
        const c = row.text[i]
        if (quote === '"' && c === '\\') { i++; continue }
        if (quote === "'" && c === "'" && row.text[i + 1] === "'") { i++; continue }
        if (c === quote) quote = null
        else if (!quote && (c === '"' || c === "'")) quote = c
        else if (!quote && c === '#' && /\s/.test(row.text[i - 1] ?? '')) { end = i; break }
      }
      const text = row.text.slice(0, end).trimEnd()
      return { line: row.line, indent: text.length - text.trimStart().length, body: text.trimStart() }
    })
  if (!tokens.length || tokens.length > 8192 || tokens[0].indent !== 0 || !tokens[0].body.startsWith('- ')) fail('Patch must be a bounded top-level block sequence')
  let cursor = 0
  function pair(body) {
    const m = /^([A-Za-z0-9_.-]+):(?:\s+(.*)|\s*)$/.exec(body)
    if (!m || m[1] === '__proto__' || m[1] === 'constructor') fail('Malformed Patch mapping field')
    return [m[1], m[2] ?? '']
  }
  function value(raw, parentIndent, depth, line) {
    if (raw) return { value: scalar(raw), line }
    if (!tokens[cursor] || tokens[cursor].indent < parentIndent || (tokens[cursor].indent === parentIndent && !tokens[cursor].body.startsWith('- '))) fail('Patch field has no explicit value')
    return node(tokens[cursor].indent, depth + 1, tokens[cursor].indent === parentIndent)
  }
  function mapping(indent, depth, initial = null) {
    const result = Object.create(null), line = initial?.line ?? tokens[cursor]?.line
    function add(body, fieldLine) {
      const [key, raw] = pair(body)
      if (Object.hasOwn(result, key)) fail('Duplicate Patch mapping field')
      result[key] = value(raw, indent, depth, fieldLine)
    }
    if (initial) add(initial.body, initial.line)
    while (tokens[cursor]?.indent === indent) {
      const row = tokens[cursor++]
      add(row.body, row.line)
    }
    if (tokens[cursor]?.indent > indent) fail('Ambiguous Patch indentation')
    return { value: result, line }
  }
  function node(indent, depth, indentless = false) {
    if (depth > 32) fail('Patch nesting exceeds the parser bound')
    if (!tokens[cursor].body.startsWith('- ')) return mapping(indent, depth)
    const list = [], line = tokens[cursor].line
    while (tokens[cursor]?.indent === indent) {
      const row = tokens[cursor++]
      if (!row.body.startsWith('- ')) {
        if (indentless) { cursor--; break }
        fail('Patch sequence mixes mappings and rows')
      }
      const body = row.body.slice(2)
      if (/^[A-Za-z0-9_.-]+:(?:\s|$)/.test(body)) list.push(mapping(indent + 2, depth + 1, { body, line: row.line }))
      else list.push(value(body, indent, depth + 1, row.line))
      if (tokens[cursor]?.indent > indent) fail('Ambiguous Patch sequence indentation')
    }
    return { value: list, line }
  }
  const root = node(0, 0)
  if (cursor !== tokens.length) fail('Patch contains trailing or ambiguous YAML')
  const insertedEntries = [], configOverrides = [], ids = new Set(), overrideIds = new Set()
  function operation(row, inserted = false) {
    if (!object(row)) fail('Patch operation must be a mapping')
    const fields = row.value, keys = Object.keys(fields)
    if (Object.hasOwn(fields, 'insert')) {
      if (inserted || keys.length !== 1 || !Array.isArray(fields.insert.value)) fail('Unsupported Patch insertion selector')
      fields.insert.value.forEach(child => operation(child, true))
      return
    }
    const id = fields.id?.value
    if (typeof id !== 'string' || !ID.test(id)) fail('Patch entry ID must be explicit and unambiguous')
    if (keys.some(key => !['id', 'name', 'config', 'inject'].includes(key))) fail('Patch removal, disable or unknown operation requires review')
    if (fields.config && !object(fields.config)) fail('Patch config must be a mapping')
    // Official include 1.0.10-alpha.2 permits inject metadata. Support only
    // the independently verified commands-service form on additive entries;
    // arbitrary injection shapes and unknown services still require review.
    let inject
    if (fields.inject) {
      if (!inserted || !fields.name || !Array.isArray(fields.inject.value)
        || fields.inject.value.length !== 1 || (typeof fields.inject.value[0] === 'string'
          ? fields.inject.value[0] : fields.inject.value[0]?.value) !== 'commands') {
        fail('Patch service injection requires an explicit supported additive contract')
      }
      inject = ['commands']
    }
    if (fields.name) {
      if (!inserted) fail('Name-qualified override is not an inserted entry; separate implementation review is required')
      const name = fields.name.value
      if (typeof name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)) fail('Patch package identity requires review')
      if (ids.has(id) || overrideIds.has(id)) fail('Conflicting Patch entry ID')
      ids.add(id); insertedEntries.push({ id, name, line: row.line, ...(inject ? { inject } : {}) })
    } else {
      if (inserted || !fields.config || ids.has(id) || overrideIds.has(id)) fail('Unsupported or conflicting Patch config override')
      overrideIds.add(id); configOverrides.push({ id, line: row.line, replacesEntireConfig: true })
    }
  }
  root.value.forEach(row => operation(row))
  return { insertedEntries, entryIds: insertedEntries.map(row => row.id), configOverrides }
}
