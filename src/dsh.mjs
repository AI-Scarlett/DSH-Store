import { execFile } from 'node:child_process'

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

function runFile(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      resolve({
        ok: error === null,
        exitCode: typeof error?.code === 'number' ? error.code : error === null ? 0 : 1,
        signal: error?.signal ?? null,
        timedOut: error?.killed === true && error?.signal === 'SIGTERM',
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      })
    })
  })
}

export function createDshRunner(options = {}) {
  const nodePath = options.nodePath ?? process.execPath
  const cliPath = options.cliPath ?? process.argv[1]
  const timeoutMs = options.timeoutMs ?? 180_000
  if (typeof cliPath !== 'string' || cliPath.trim() === '') {
    throw new TypeError('DSH CLI path is unavailable')
  }
  return {
    async plugin(profile, args) {
      return runFile(nodePath, [cliPath, 'plugin', '--profile', profile, ...args], { timeoutMs })
    },
    async dumpConfig(profile) {
      return runFile(nodePath, [cliPath, '--profile', profile, '--dump-config'], { timeoutMs: Math.min(timeoutMs, 30_000) })
    },
  }
}
