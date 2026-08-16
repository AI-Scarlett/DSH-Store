import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'
import { createDshRunner } from '../src/dsh.mjs'

test('DSH runner preserves fixed arguments and exposes sibling pnpm to a minimal service PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-runner-'))
  const cliPath = join(root, 'fixture-cli.mjs')
  await writeFile(cliPath, `process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), path: process.env.PATH }))\n`)
  try {
    const runner = createDshRunner({
      nodePath: process.execPath,
      cliPath,
      environment: { PATH: '/usr/bin:/bin' },
      timeoutMs: 5_000,
    })
    const result = await runner.plugin('web', ['--help'])
    assert.equal(result.ok, true)
    const output = JSON.parse(result.stdout)
    assert.deepEqual(output.argv, ['plugin', '--profile', 'web', '--help'])
    assert.equal(output.path.split(delimiter)[0], dirname(process.execPath))
    assert.match(output.path, /\/usr\/bin/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
