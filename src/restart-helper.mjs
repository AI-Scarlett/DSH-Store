import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function processExists(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function portIsListening(host, port) {
  return new Promise(resolve => {
    const socket = connect({ host, port })
    const finish = value => { socket.destroy(); resolve(value) }
    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function decodeSpec(value) {
  const spec = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  if (!Number.isSafeInteger(spec.oldPid) || spec.oldPid < 2) throw new Error('invalid old pid')
  if (!isAbsolute(spec.nodePath) || !isAbsolute(spec.cliPath) || !isAbsolute(spec.cwd)) throw new Error('restart paths must be absolute')
  if (!Array.isArray(spec.runtimeArgs) || spec.runtimeArgs.some(value => typeof value !== 'string')) throw new Error('invalid runtime arguments')
  if (typeof spec.profile !== 'string' || !/^[A-Za-z0-9._-]+$/.test(spec.profile)) throw new Error('invalid profile')
  if (spec.host !== '127.0.0.1' || !Number.isInteger(spec.port) || spec.port < 1 || spec.port > 65535) throw new Error('invalid listener')
  return spec
}

export async function restartHost(spec, options = {}) {
  const spawnProcess = options.spawn ?? spawn
  const exists = options.processExists ?? processExists
  const killProcess = options.killProcess ?? ((pid, signal) => process.kill(pid, signal))
  const deadline = Date.now() + (options.waitForExitMs ?? 5_000)
  while (exists(spec.oldPid) && Date.now() < deadline) await delay(100)
  if (exists(spec.oldPid)) {
    killProcess(spec.oldPid, 'SIGKILL')
    const killDeadline = Date.now() + (options.waitForKillMs ?? 5_000)
    while (exists(spec.oldPid) && Date.now() < killDeadline) await delay(100)
  }
  if (exists(spec.oldPid)) throw new Error('old DSH Host did not exit after escalation')
  await delay(options.supervisorGraceMs ?? 1_500)
  if (await (options.portIsListening ?? portIsListening)(spec.host, spec.port)) {
    return { status: 'supervisor-restored' }
  }
  const profileArgs = spec.profile === 'web' ? ['web'] : ['--profile', spec.profile]
  const child = spawnProcess(spec.nodePath, [...spec.runtimeArgs, spec.cliPath, ...profileArgs], {
    cwd: spec.cwd, env: process.env, detached: true, stdio: 'ignore', shell: false,
  })
  child.unref()
  return { status: 'started', pid: child.pid }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  restartHost(decodeSpec(process.argv[2])).catch(() => { process.exitCode = 1 })
}
