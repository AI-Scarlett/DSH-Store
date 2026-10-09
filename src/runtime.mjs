import { randomUUID } from 'node:crypto'

export function restartCommand(profile) {
  return profile === 'web' ? ['dsh', 'web'] : ['dsh', '--profile', profile]
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`
}

export function createRuntimeStatus(options = {}) {
  const profile = options.profile
  const desktopMode = options.desktopMode === true
  const bootId = options.bootId ?? randomUUID()
  const startedAt = options.startedAt ?? new Date().toISOString()
  const command = Array.isArray(options.restartCommand) ? [...options.restartCommand] : restartCommand(profile)
  return Object.freeze({
    schemaVersion: 1,
    bootId,
    startedAt,
    profile,
    desktopMode,
    restartCommand: command,
    restartCommandText: command.map(shellQuote).join(' '),
    restartWorkingDirectory: options.restartWorkingDirectory ?? null,
    restartSupported: !desktopMode,
    restartMode: desktopMode ? 'official-desktop' : 'external-guardian',
    restartReason: desktopMode
      ? 'The official Desktop application owns its Host and restart lifecycle.'
      : 'Restart is accepted only by the marketplace-bundled Guardian running outside the DSH process.',
  })
}
