import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const root = new URL('../', import.meta.url)
const script = fileURLToPath(new URL('scripts/analyze-ai-crawler-logs.py', root))

test('AI crawler log analyzer aggregates named bots and omits sensitive log fields', async () => {
  const directory = await mkdtemp(new URL('.tmp-ai-crawler-', root))
  const input = join(directory, 'access.log')
  const output = join(directory, 'report.md')
  const jsonOutput = join(directory, 'report.json')
  const rawLog = [
    '203.0.113.42 - - [02/Sep/2026:09:00:00 +0800] "GET /plugins/?token=secret HTTP/1.1" 200 123 "-" "DeepSeekBot/1.0"',
    '198.51.100.8 - - [02/Sep/2026:09:01:00 +0800] "GET /_analytics/ HTTP/1.1" 403 9 "-" "Bytespider"',
    '192.0.2.9 - - [02/Sep/2026:09:02:00 +0800] "GET /faq/ HTTP/1.1" 500 9 "-" "Kimi-SearchBot"',
    '192.0.2.10 - - [02/Sep/2026:09:03:00 +0800] "GET /about/ HTTP/1.1" 200 9 "-" "ordinary browser"',
  ].join('\n') + '\n'
  await writeFile(input, rawLog)

  try {
    await execFileAsync('python3', [
      script,
      '--input', input,
      '--output', output,
      '--json-output', jsonOutput,
      '--period', '2026-09-02',
    ])
    const report = await readFile(output, 'utf8')
    const json = JSON.parse(await readFile(jsonOutput, 'utf8'))
    assert.equal(json.matchedRequests, 3)
    assert.equal(json.http200, 1)
    assert.equal(json.bots.DeepSeekBot.http200Rate, 1)
    assert.equal(json.bots.Bytespider.statusCounts['403'], 1)
    assert.equal(json.bots['Kimi-SearchBot'].statusCounts['500'], 1)
    assert.match(report, /HTTP 200：1（33\.33%）/)
    assert.match(report, /`\/plugins\/`：1 次/)
    assert.doesNotMatch(report, /203\.0\.113\.42|token=secret|GET \/plugins\//)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
