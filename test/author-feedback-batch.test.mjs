import assert from 'node:assert/strict'
import test from 'node:test'
import { digest } from '../scripts/author-contact-state.mjs'
import { runFeedbackBatch } from '../scripts/run-author-feedback-batch.mjs'
const stop = 'registry/author-stops/fixture.json'
const first = 'registry/author-replies/first.json'
const second = 'registry/author-replies/second.json'
const batch = paths => ({ schemaVersion: 1, operation: 'reviewed-feedback-batch', plans: paths.map(path => ({ path, sha256: digest(path) })) })

test('the reviewed batch applies stops first, never retries uncertain messages, and continues other requests', async () => {
  const calls = []
  const results = await runFeedbackBatch({ batch: batch([stop, first, second]), readPlan: async path => path,
    executePlan: async (script, path) => { calls.push(path); if (path === first) throw Object.assign(new Error('uncertain send'), { stderr: 'GitHub POST failed: HTTP 403' }); return 'verified' } })
  assert.deepEqual(calls, [stop, first, second])
  assert.equal(results[1].httpStatus, 403)
  assert.equal(results[1].method, 'POST')
  assert.deepEqual(results.map(row => row.status), ['completed', 'failed-or-uncertain-do-not-retry', 'completed'])
})

test('changed content, duplicate scope and misplaced stop fail before any sender; failed stop halts all messages', async () => {
  let calls = 0
  const executePlan = async () => { calls++; throw new Error('failed stop') }
  for (const paths of [[first, stop], [first, first]]) await assert.rejects(runFeedbackBatch({ batch: batch(paths), readPlan: async path => path, executePlan }))
  await assert.rejects(runFeedbackBatch({ batch: batch([first]), readPlan: async () => 'changed', executePlan }))
  assert.equal(calls, 0)
  const results = await runFeedbackBatch({ batch: batch([stop, first]), readPlan: async path => path, executePlan })
  assert.equal(calls, 1)
  assert.equal(results.length, 1)
})
