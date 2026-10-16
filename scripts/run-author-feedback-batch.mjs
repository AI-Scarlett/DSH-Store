#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubClient } from './author-contact-http.mjs'
import { digest } from './author-contact-state.mjs'

const scriptFor = path => /^registry\/author-stops\/[a-z0-9-]+\.json$/.test(path) ? 'scripts/record-author-contact-stop.mjs'
  : /^registry\/author-closures\/[a-z0-9-]+\.json$/.test(path) ? 'scripts/close-author-contact.mjs'
    : /^registry\/author-replies\/[a-z0-9-]+\.json$/.test(path) ? 'scripts/reply-author-contact.mjs' : null

export async function runFeedbackBatch({ batch, readPlan, executePlan, report = () => {} }) {
  if (batch?.schemaVersion !== 1 || batch.operation !== 'reviewed-feedback-batch'
    || !Array.isArray(batch.plans) || batch.plans.length < 1 || batch.plans.length > 32) throw new Error('Invalid feedback batch')
  const seen = new Set()
  let passedStops = false
  // Validate the complete immutable manifest before starting any operation.
  for (const item of batch.plans) {
    if (!scriptFor(item.path) || seen.has(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256)
      || digest(await readPlan(item.path)) !== item.sha256) throw new Error('Feedback batch scope or content changed')
    const stop = item.path.startsWith('registry/author-stops/')
    if (stop && passedStops) throw new Error('All contact stops must precede messages')
    if (!stop) passedStops = true
    seen.add(item.path)
  }
  const results = []
  for (const item of batch.plans) {
    try {
      // No retries here: each dedicated sender owns its central CAS reservation.
      const receipt = await executePlan(scriptFor(item.path), item.path)
      const result = { path: item.path, status: 'completed', receipt }
      results.push(result); report(result)
    } catch {
      const result = { path: item.path, status: 'failed-or-uncertain-do-not-retry' }
      results.push(result); report(result)
      if (item.path.startsWith('registry/author-stops/')) break
    }
  }
  return results
}

async function main() {
  const [flag, path, ...extra] = process.argv.slice(2)
  if (flag !== '--plan' || extra.length || !/^registry\/author-batches\/[a-z0-9-]+\.json$/.test(path ?? '')) throw new Error('Main-reviewed feedback batch required')
  const bytes = await readFile(path)
  const github = githubClient(process.env.GITHUB_TOKEN)
  const remote = await github.request('GET', `/repos/AI-Scarlett/DSH-Store/contents/${path}?ref=main`)
  if (remote.encoding !== 'base64' || digest(Buffer.from(remote.content, 'base64')) !== digest(bytes)) throw new Error('Batch is not reviewed on main')
  const run = promisify(execFile)
  const results = await runFeedbackBatch({
    batch: JSON.parse(bytes), readPlan: path => readFile(path),
    executePlan: async (script, path) => {
      const result = await run(process.execPath, [script, '--plan', path], { timeout: 120000, maxBuffer: 16384 })
      return result.stdout.trim()
    },
    report: result => process.stdout.write(`FEEDBACK_BATCH_ITEM ${JSON.stringify(result)}\n`),
  })
  if (results.some(result => result.status !== 'completed')) process.exitCode = 1
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
