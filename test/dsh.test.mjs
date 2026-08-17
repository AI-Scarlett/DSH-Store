import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'
import { createDshRunner } from '../src/dsh.mjs'

test('DSH runner preserves fixed arguments and exposes launcher sibling pnpm to a minimal service PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-runner-'))
  const launcherDirectory = join(root, 'homebrew-bin')
  const nodeLauncherPath = join(launcherDirectory, 'node')
  const pnpmPath = join(launcherDirectory, 'pnpm')
  const cliPath = join(root, 'fixture-cli.mjs')
  await mkdir(launcherDirectory)
  await writeFile(pnpmPath, '#!/usr/bin/env node\nprocess.stdout.write("fixture-pnpm\\n")\n', { mode: 0o700 })
  await writeFile(cliPath, `
import { execFileSync } from 'node:child_process'
const pnpm = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), path: process.env.PATH, pnpm }))
`)
  try {
    const runner = createDshRunner({
      nodePath: process.execPath,
      nodeLauncherPath,
      cliPath,
      environment: { PATH: '/usr/bin:/bin' },
      timeoutMs: 5_000,
    })
    const result = await runner.plugin('web', ['--help'])
    assert.equal(result.ok, true)
    const output = JSON.parse(result.stdout)
    assert.deepEqual(output.argv, ['plugin', '--profile', 'web', '--help'])
    assert.equal(output.path.split(delimiter)[0], launcherDirectory)
    assert.equal(output.path.split(delimiter)[1], dirname(process.execPath))
    assert.match(output.path, /\/usr\/bin/)
    assert.equal(output.pnpm, 'fixture-pnpm')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('DSH runner preserves only module-loading Node arguments for a TypeScript CLI entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-runner-loader-'))
  try {
    const loader = join(root, 'loader.mjs')
    const cli = join(root, 'cli.mjs')
    await writeFile(loader, 'export async function resolve(specifier, context, nextResolve) { return nextResolve(specifier, context) }\n')
    await writeFile(cli, 'process.stdout.write(JSON.stringify(process.execArgv))\n')
    const runner = createDshRunner({
      nodePath: process.execPath,
      cliPath: cli,
      runtimeArgs: ['--inspect=0', '--import', loader, '--trace-warnings'],
    })
    const result = await runner.dumpConfig('web')
    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(result.stdout), ['--import', loader])
    assert.deepEqual(runner.restartSpec('web'), {
      nodePath: process.execPath, runtimeArgs: ['--import', loader], cliPath: cli,
      cwd: process.cwd(), profile: 'web',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
