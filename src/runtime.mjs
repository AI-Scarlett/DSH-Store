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
    restartMode: 'guarded-helper',
    restartReason: 'DSH CLI has no native restart command; the manager uses a confirmed detached helper and the original fixed launcher arguments.',
  })
}
