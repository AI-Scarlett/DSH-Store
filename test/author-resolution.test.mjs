import test from 'node:test'
import assert from 'node:assert/strict'
import { digest, resolutionPath, validateAuthorResolutions, verifyReplyResolution } from '../src/author-resolution.mjs'

const record = () => ({ issueNumber: 123, requestCommentId: 456, userId: 789, requestBodySha256: 'a'.repeat(64),
  repositoryUrl: 'https://github.com/example/plugin', version: '1.0.0', commit: 'b'.repeat(40), binding: 'c'.repeat(64),
  catalogId: 'plugin', decision: 'rejected', summary: 'A concrete source defect prevents admission.',
  evidenceUrl: 'https://github.com/example/plugin/commit/' + 'b'.repeat(40),
  blockers: [{ code: 'AUTH001', owner: 'author', file: 'index.js', line: 12, finding: 'The write route lacks a trust check.',
    requiredChange: 'Gate the handler before any write.', acceptance: 'An untrusted request receives 403 without writing.' }] })
const entry = r => ({ id: r.catalogId, repositoryUrl: r.repositoryUrl, commit: r.commit, version: r.version,
  status: r.decision === 'admitted' ? 'approved' : 'blocked', admission: { binding: r.binding } })

test('remediation must end in an accurate admitted or actionable rejected decision, not a review receipt', () => {
  const r = record()
  assert.doesNotThrow(() => validateAuthorResolutions({ schemaVersion: 1, resolutions: [r] }, [entry(r)]))
  for (const decision of ['pending', 'review-required', 'source-read', 'replied']) assert.throws(() => validateAuthorResolutions({ schemaVersion: 1, resolutions: [{ ...r, decision }] }))
  for (const field of ['requiredChange', 'acceptance', 'file']) {
    const bad = structuredClone(r); delete bad.blockers[0][field]
    assert.throws(() => validateAuthorResolutions({ schemaVersion: 1, resolutions: [bad] }))
  }
  const storeWork = structuredClone(r); storeWork.blockers[0].owner = 'store'
  assert.throws(() => validateAuthorResolutions({ schemaVersion: 1, resolutions: [storeWork] }), /concrete/)
  assert.throws(() => validateAuthorResolutions({ schemaVersion: 1, resolutions: [r] }, [{ ...entry(r), status: 'approved' }]), /Catalog/)
  const admitted = { ...r, decision: 'admitted', blockers: [] }
  assert.doesNotThrow(() => validateAuthorResolutions({ schemaVersion: 1, resolutions: [admitted] }, [entry(admitted)]))
})

test('a terminal reply binds the exact request, current Catalog source and all concrete blockers', () => {
  const r = record(), bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, resolutions: [r] }))
  const plan = { issueNumber: r.issueNumber, userId: r.userId, requestCommentId: r.requestCommentId, requestBodySha256: r.requestBodySha256,
    responseBody: `${r.commit} AUTH001 ${r.evidenceUrl}`, resolution: { path: resolutionPath, sha256: digest(bytes) } }
  assert.equal(verifyReplyResolution(plan, bytes, [entry(r)]).decision, 'rejected')
  assert.throws(() => verifyReplyResolution({ ...plan, requestCommentId: 999 }, bytes), /exact/)
  assert.throws(() => verifyReplyResolution({ ...plan, responseBody: r.commit }, bytes), /evidence/)
  assert.throws(() => verifyReplyResolution(plan, Buffer.from(bytes + ' ')), /hash-bound/)
  assert.throws(() => verifyReplyResolution(plan, bytes, [{ ...entry(r), commit: 'd'.repeat(40) }]), /superseded/)
  // Future source updates preserve historical decisions but cannot send them.
  assert.doesNotThrow(() => validateAuthorResolutions(JSON.parse(bytes), [{ ...entry(r), commit: 'd'.repeat(40) }]))
})
