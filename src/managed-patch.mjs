const START = '# dsh-safe-plugin-manager:start'
const END = '# dsh-safe-plugin-manager:end'
const BASE_EMPTY = '# dsh-safe-plugin-manager:base-empty'
const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/

function assertIds(entryIds) {
  if (!Array.isArray(entryIds) || entryIds.some(id => typeof id !== 'string' || !ENTRY_ID.test(id))) {
    throw new TypeError('entryIds must contain simple DSH entry identifiers')
  }
}

function findManagedBlock(text) {
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (start === -1 && end === -1) return null
  if (start === -1 || end === -1 || end < start || text.indexOf(START, start + START.length) !== -1
    || text.indexOf(END, end + END.length) !== -1) {
    throw new Error('managed patch markers are malformed or duplicated')
  }
  const after = end + END.length
  return { start, end: text[after] === '\n' ? after + 1 : after, body: text.slice(start + START.length, end) }
}

function idsFromBody(body) {
  const ids = []
  const lines = body.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^- id: ([A-Za-z0-9][A-Za-z0-9._-]{0,95})$/.exec(lines[index])
    if (!match) continue
    if (lines[index + 1] !== '  disabled: true') throw new Error('managed patch contains an unsupported entry')
    ids.push(match[1])
    index += 1
  }
  const meaningful = lines.filter(line => line.trim() !== '')
  if (meaningful.length !== ids.length * 2) throw new Error('managed patch contains unsupported content')
  return ids
}

function render(ids) {
  return `${START}\n${ids.map(id => `- id: ${id}\n  disabled: true`).join('\n')}\n${END}\n`
}

export function readManagedDisabledIds(text) {
  if (typeof text !== 'string') throw new TypeError('patch text must be a string')
  const block = findManagedBlock(text)
  return block ? idsFromBody(block.body) : []
}

export function setManagedDisabled(text, entryIds, disabled) {
  if (typeof text !== 'string') throw new TypeError('patch text must be a string')
  assertIds(entryIds)
  const block = findManagedBlock(text)
  const current = new Set(block ? idsFromBody(block.body) : [])
  for (const id of entryIds) {
    if (disabled) current.add(id)
    else current.delete(id)
  }
  const ids = [...current].sort()
  if (block) {
    if (ids.length > 0) return text.slice(0, block.start) + render(ids) + text.slice(block.end)
    const before = text.slice(0, block.start)
    const after = text.slice(block.end)
    if (before.endsWith(`${BASE_EMPTY}\n`)) {
      return before.slice(0, -(`${BASE_EMPTY}\n`).length) + '[]\n' + after
    }
    return before + after
  }
  if (!disabled || ids.length === 0) return text
  const emptyArray = /^([ \t]*\[\][ \t]*)(?:\r?\n)?$/m
  if (emptyArray.test(text)) {
    return text.replace(emptyArray, `${BASE_EMPTY}\n${render(ids)}`)
  }
  if (!/^\s*(?:#.*\r?\n\s*)*-/m.test(text)) {
    throw new Error('profile patch is not an empty array or a top-level YAML sequence')
  }
  const separator = text.endsWith('\n') ? '' : '\n'
  return `${text}${separator}${render(ids)}`
}
