import { randomUUID } from 'node:crypto'

export function restartCommand(profile) {
  return profile === 'web' ? ['dsh', 'web'] : ['dsh', '--profile', profile]
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`
}

export function createRuntimeStatus(options = {}) {
  const profile = options.profile
  const bootId = options.bootId ?? randomUUID()
  const startedAt = options.startedAt ?? new Date().toISOString()
  const command = Array.isArray(options.restartCommand) ? [...options.restartCommand] : restartCommand(profile)
  return Object.freeze({
    schemaVersion: 1,
    bootId,
    startedAt,
    profile,
    restartCommand: command,
    restartCommandText: command.map(shellQuote).join(' '),
    restartWorkingDirectory: options.restartWorkingDirectory ?? null,
    restartSupported: true,
    restartMode: 'external-guardian',
    restartReason: 'Restart is accepted only by the marketplace-bundled Guardian running outside the DSH process.',
  })
}
