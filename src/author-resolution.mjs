import { createHash } from 'node:crypto'

export const resolutionPath = 'registry/author-resolutions.json'
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const hash = value => /^[a-f0-9]{64}$/.test(value ?? '')
const text = value => typeof value === 'string' && value.trim().length > 0

// A reply is the final communication step, not the admission decision itself.
// Store work that is still pending must not be labelled an author's failure.
export function validateAuthorResolutions(document, entries) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document.resolutions)) throw new Error('invalid author resolution registry')
  const seen = new Set()
  for (const r of document.resolutions) {
    if (!Number.isSafeInteger(r.issueNumber) || !Number.isSafeInteger(r.requestCommentId) || !Number.isSafeInteger(r.userId)
      || !hash(r.requestBodySha256) || !/^[a-f0-9]{40}$/.test(r.commit ?? '') || !hash(r.binding)
      || !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(r.repositoryUrl ?? '')
      || !text(r.version) || !text(r.catalogId) || !text(r.summary) || !text(r.evidenceUrl)
      || !['admitted', 'rejected'].includes(r.decision) || !Array.isArray(r.blockers)) throw new Error('nonterminal or incomplete author resolution')
    const key = `${r.userId}:${r.requestCommentId}`
    if (seen.has(key)) throw new Error('duplicate request resolution')
    seen.add(key)
    if (r.decision === 'rejected' && !r.blockers.length || r.decision === 'admitted' && r.blockers.length) throw new Error('resolution and blockers disagree')
    for (const b of r.blockers) {
      if (b.owner !== 'author' || !text(b.code) || !text(b.file) || !Number.isSafeInteger(b.line) || b.line < 1
        || !text(b.finding) || !text(b.requiredChange) || !text(b.acceptance)) throw new Error('rejection requires exact evidence, a concrete change and acceptance criteria')
    }
    const entry = entries?.find(e => e.id === r.catalogId)
    // A later reviewed source may supersede this historical request. If the
    // Commit still matches, its current public state must match the decision.
    if (entries && (!entry || entry.repositoryUrl !== r.repositoryUrl || entry.commit === r.commit && (entry.version !== r.version
      || entry.admission?.binding !== r.binding || (r.decision === 'admitted' ? entry.status !== 'approved' : entry.status !== 'blocked')))) throw new Error('resolution differs from the published Catalog decision')
  }
  return document
}

export function verifyReplyResolution(plan, bytes, entries) {
  const reference = plan?.resolution
  if (reference?.path !== resolutionPath || !hash(reference.sha256) || digest(bytes) !== reference.sha256) throw new Error('a hash-bound terminal admission resolution is required')
  const registry = validateAuthorResolutions(JSON.parse(bytes), entries)
  const r = registry.resolutions.find(r => r.issueNumber === plan.issueNumber && r.requestCommentId === plan.requestCommentId
    && r.userId === plan.userId && r.requestBodySha256 === plan.requestBodySha256)
  if (!r) throw new Error('reply does not resolve this exact author request')
  if (entries && !entries.some(e => e.id === r.catalogId && e.commit === r.commit)) throw new Error('reply decision was superseded by newer source')
  if (!plan.responseBody.includes(r.commit) || !plan.responseBody.includes(r.evidenceUrl)) throw new Error('reply must identify the exact decision and public evidence')
  if (r.decision === 'rejected' && r.blockers.some(b => !plan.responseBody.includes(b.code))) throw new Error('reply omits an actionable admission blocker')
  return r
}
