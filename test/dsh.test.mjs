import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'
import { createDshRunner, resolveCommandPath } from '../src/dsh.mjs'

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
      nodeLauncherPath: process.execPath,
      cliPath: cli,
      runtimeArgs: ['--inspect=0', '--import', loader, '--trace-warnings'],
      environment: { PATH: '/usr/bin:/bin' },
    })
    const result = await runner.dumpConfig('web')
    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(result.stdout), ['--import', loader])
    assert.deepEqual(runner.restartSpec('web'), {
      nodePath: process.execPath, runtimeArgs: ['--import', loader], cliPath: cli,
      cwd: process.cwd(), profile: 'web',
      commandPath: [dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('DSH runner derives an executable pnpm bin from a globally installed CLI when Node uses a disjoint runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-runner-global-'))
  const prefix = join(root, 'homebrew')
  const globalBin = join(prefix, 'bin')
  const cliPath = join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.mjs')
  const nodeLauncherPath = join(root, 'codex-runtime', 'bin', 'node')
  try {
    await mkdir(dirname(cliPath), { recursive: true })
    await mkdir(globalBin, { recursive: true })
    await writeFile(join(globalBin, 'pnpm'), '#!/usr/bin/env node\nprocess.stdout.write("global-pnpm\\n")\n', { mode: 0o700 })
    await writeFile(cliPath, `
import { execFileSync } from 'node:child_process'
const pnpm = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()
process.stdout.write(JSON.stringify({ path: process.env.PATH, pnpm }))
`)
    const runner = createDshRunner({
      nodePath: process.execPath,
      nodeLauncherPath,
      cliPath,
      environment: { PATH: '/usr/bin:/bin' },
      timeoutMs: 5_000,
    })
    const result = await runner.plugin('web', ['install', '--offline'])
    assert.equal(result.ok, true)
    const output = JSON.parse(result.stdout)
    assert.equal(output.pnpm, 'global-pnpm')
    assert.ok(output.path.split(delimiter).includes(globalBin))
    assert.equal(runner.restartSpec('web').commandPath, output.path)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('command PATH does not trust an unverified global bin candidate', () => {
  const root = join(tmpdir(), 'dsh-safe-runner-missing')
  const prefix = join(root, 'prefix')
  const commandPath = resolveCommandPath({
    nodePath: process.execPath,
    nodeLauncherPath: join(root, 'runtime', 'node'),
    cliPath: join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.mjs'),
    environment: { PATH: '/usr/bin:/bin' },
    access: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
  })
  assert.ok(!commandPath.split(delimiter).includes(join(prefix, 'bin')))
})
