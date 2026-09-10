const SIMPLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/

function indentation(line) {
  const match = /^(\s*)/.exec(line)
  const prefix = match?.[1] ?? ''
  if (prefix.includes('\t')) throw new TypeError('Bundle Patch uses ambiguous tab indentation')
  return prefix.length
}

function unquote(value) {
  const trimmed = String(value ?? '').trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed.slice(1, -1)
  return trimmed
}

function parseId(line) {
  const match = /^\s*-\s+id:\s*([^#\n]+?)(?:\s+#.*)?$/.exec(line)
  if (!match) return null
  const id = unquote(match[1])
  if (!SIMPLE_ID.test(id)) throw new TypeError(`Bundle Patch contains invalid entry id ${id}`)
  return id
}

function parseScalar(segment, key, baseIndent) {
  const directIndents = segment
    .filter(line => line.trim() !== '' && !line.trimStart().startsWith('#') && indentation(line) > baseIndent)
    .map(indentation)
  if (directIndents.length === 0) return null
  const directIndent = Math.min(...directIndents)
  const pattern = new RegExp(`^\\s*${key}:\\s*([^#\\n]+?)(?:\\s+#.*)?$`)
  for (const line of segment) {
    if (indentation(line) !== directIndent) continue
    const match = pattern.exec(line)
    if (match) return unquote(match[1])
  }
  return null
}

function entryRecord(id, segment, kind) {
  const baseIndent = indentation(segment[0])
  const name = parseScalar(segment.slice(1), 'name', baseIndent)
  const disabled = parseScalar(segment.slice(1), 'disabled', baseIndent)
  return {
    id,
    kind,
    name,
    disabled: disabled === null ? false : disabled.toLowerCase() === 'true',
  }
}

function rootItems(lines) {
  const candidates = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*-\s+(?:id:|insert:\s*(?:#.*)?$)/.test(lines[index])) continue
    candidates.push({ index, indent: indentation(lines[index]) })
  }
  if (candidates.length === 0) return []
  const rootIndent = Math.min(...candidates.map(item => item.indent))
  return candidates.filter(item => item.indent === rootIndent)
}

export function analyzeBundlePatch(patch) {
  if (typeof patch !== 'string' || patch.trim() === '') throw new TypeError('Bundle Patch must be non-empty text')
  const lines = patch.replace(/\r\n?/g, '\n').split('\n')
  const roots = rootItems(lines)
  const ownedEntries = []
  const hostOverlays = []
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const start = roots[rootIndex].index
    const end = roots[rootIndex + 1]?.index ?? lines.length
    const segment = lines.slice(start, end)
    const rootLine = lines[start]
    const hostId = parseId(rootLine)
    if (hostId !== null) {
      hostOverlays.push(entryRecord(hostId, segment, 'overlay'))
      continue
    }
    if (!/^\s*-\s+insert:\s*(?:#.*)?$/.test(rootLine)) {
      throw new TypeError('Bundle Patch root entry is ambiguous')
    }

    const nested = []
    for (let index = start + 1; index < end; index += 1) {
      const id = parseId(lines[index])
      if (id === null) continue
      const indent = indentation(lines[index])
      if (indent <= roots[rootIndex].indent) throw new TypeError('Bundle Patch insert indentation is ambiguous')
      nested.push({ index, indent, id })
    }
    if (nested.length === 0) throw new TypeError('Bundle Patch insert does not declare an entry id')
    const itemIndent = Math.min(...nested.map(item => item.indent))
    const items = nested.filter(item => item.indent === itemIndent)
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const itemStart = items[itemIndex].index
      const itemEnd = items[itemIndex + 1]?.index ?? end
      ownedEntries.push(entryRecord(items[itemIndex].id, lines.slice(itemStart, itemEnd), 'insert'))
    }
  }
  return {
    ownedEntries,
    hostOverlays,
    ownedEntryIds: [...new Set(ownedEntries.map(entry => entry.id))],
  }
}

export function ownedBundleEntryIds(patch) {
  return analyzeBundlePatch(patch).ownedEntryIds
}

export function officialNamespaceInsertions(patch) {
  return analyzeBundlePatch(patch).ownedEntries
    .filter(entry => typeof entry.name === 'string' && entry.name.toLowerCase().startsWith('@deepseek-ai/'))
}

export function disabledOfficialOverlays(patch) {
  return analyzeBundlePatch(patch).hostOverlays.filter(entry => entry.disabled
    && typeof entry.name === 'string'
    && entry.name.toLowerCase().startsWith('@deepseek-ai/'))
}
