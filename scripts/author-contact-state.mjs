#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubClient } from './author-contact-http.mjs'

export const CONTACT_POLICY = 'github-person-once-v1'
export const STATE_BRANCH = 'author-contact-state'
export const STATE_PATH = 'contacts.json'
export const digest = value => createHash('sha256').update(value).digest('hex')
const loginPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
const repositoryPattern = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
const RESERVATION_READBACK_ATTEMPTS = 5
const RESERVATION_READBACK_DELAY_MS = 200
export function requireRepository(value) {
  if (!repositoryPattern.test(value)) throw new Error('invalid repository')
  return value
}
export function humanIdentity(value) {
  if (value?.type !== 'User' || !Number.isSafeInteger(value.id) || value.id < 1
    || !loginPattern.test(value.login) || /^(dependabot|github-actions)$/i.test(value.login)
    || typeof value.node_id !== 'string' || !value.node_id) return null
  return { id: value.id, node_id: value.node_id, login: value.login, type: 'User' }
}
export function validateState(state) {
  if (state?.schemaVersion !== 1 || state.policy !== CONTACT_POLICY || state.historyComplete !== true
    || !state.contacts || Array.isArray(state.contacts) || typeof state.contacts !== 'object'
    || !Array.isArray(state.blockedLogins) || !Array.isArray(state.blockedRepositories)) {
    throw new Error('contact history missing or incomplete; no messages allowed')
  }
  if (Object.keys(state.contacts).length > 10_000) throw new Error('contact history bound exceeded')
  for (const [id, record] of Object.entries(state.contacts)) {
    if (!/^[1-9][0-9]*$/.test(id) || Number(id) !== record.userId || !Number.isSafeInteger(record.userId)
      || typeof record.nodeId !== 'string' || !record.nodeId
      || !Array.isArray(record.logins) || !record.logins.length
      || !record.logins.every(login => loginPattern.test(login))
      || typeof record.stopped !== 'boolean' || !record.firstContact
      || !['historical', 'reserved'].includes(record.firstContact.kind)
      || !record.reservations || typeof record.reservations !== 'object' || Array.isArray(record.reservations)) {
      throw new Error('invalid contact record')
    }
  }
  if (!state.blockedLogins.every(login => loginPattern.test(login))
    || !state.blockedRepositories.every(key => repositoryPattern.test(key))) throw new Error('invalid history quarantine')
  return state
}
export function verifyHistoryPreserved(state, seed) {
  validateState(state); validateState(seed)
  for (const [id, record] of Object.entries(seed.contacts)) {
    const live = state.contacts[id]
    for (const [key, reservation] of Object.entries(record.reservations)) {
      if (JSON.stringify(live?.reservations?.[key]) !== JSON.stringify(reservation)) throw new Error('historical request reservation was removed')
    }
    if (!live || live.nodeId !== record.nodeId || (record.stopped && !live.stopped)
      || record.logins.some(login => !live.logins.includes(login))) throw new Error('historical contact or stop was removed')
  }
  for (const key of ['blockedLogins', 'blockedRepositories']) {
    if (seed[key].some(value => !state[key].includes(value))) throw new Error('historical quarantine was removed')
  }
}
export function contactDecision(state, recipient, repositoryKey) {
  validateState(state)
  const person = humanIdentity(recipient)
  if (!person) return 'unresolved-human'
  if (state.blockedRepositories.some(key => key.toLowerCase() === repositoryKey.toLowerCase())) return 'historical-repository'
  const prior = state.contacts[String(person.id)]
  if (prior) {
    if (prior.nodeId !== person.node_id) return 'identity-mismatch'
    return prior.stopped ? 'stopped' : 'already-contacted'
  }
  const alias = person.login.toLowerCase()
  if (state.blockedLogins.some(login => login.toLowerCase() === alias)
    || Object.values(state.contacts).some(record => record.logins.some(login => login.toLowerCase() === alias))) {
    return 'historical-alias'
  }
  return 'first-contact'
}
// Remove all recipient syntax from source-controlled or upstream-provided prose,
// then add exactly one verified recipient. Even encoded @ must not smuggle a ping.
export function contactBody(body, recipient, mention = true) {
  const person = humanIdentity(recipient)
  if (!person || typeof body !== 'string' || !body || Buffer.byteLength(body) > 59_000) throw new Error('invalid contact body')
  const clean = body.replace(/&#(?:0*64|x0*40);?|&commat;/gi, '＠').replaceAll('@', '＠')
  return mention ? `@${person.login}\n\n${clean}` : clean
}
export async function loadSeed() {
  return validateState(JSON.parse(await readFile(new URL('../registry/author-contact-history.json', import.meta.url), 'utf8')))
}
export async function readContactState(github, repository, seed) {
  requireRepository(repository)
  if (repository.toLowerCase() !== 'ai-scarlett/dsh-store') throw new Error('central contact ledger required')
  const file = await github.request('GET', `/repos/${repository}/contents/${STATE_PATH}?ref=${STATE_BRANCH}`)
  if (!/^[0-9a-f]{40}$/.test(file?.sha) || file.encoding !== 'base64' || file.size > 4_000_000) throw new Error('contact state file is invalid')
  const state = validateState(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')))
  verifyHistoryPreserved(state, seed ?? await loadSeed())
  return { fileSha: file.sha, state }
}
// This is the only permission-consuming writer. A reservation is never undone,
// including on timeout or failed readback. CAS conflicts are re-evaluated, not sent.
export async function reserveContact({ github, repository, recipient, key, claimId, seed, continuation = null }) {
  const person = humanIdentity(recipient)
  if (!person || !/^[0-9a-f]{24,64}$/.test(claimId)) throw new Error('invalid contact reservation')
  requireRepository(key)
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await readContactState(github, repository, seed)
    const decision = contactDecision(snapshot.state, person, key)
    const existing = snapshot.state.contacts[String(person.id)]
    if (continuation) {
      // Only the separately reviewed, live-verified reply command supplies this.
      if (!existing || existing.stopped || existing.nodeId !== person.node_id) return { allowed: false, reason: 'no-continuation-permission' }
      if (!/^[1-9][0-9]*$/.test(String(continuation.commentId))
        || !/^[0-9a-f]{64}$/.test(continuation.requestHash)) throw new Error('invalid continuation evidence')
      if (Object.values(existing.reservations).some(item => item.commentId === continuation.commentId)) {
        return { allowed: false, reason: 'request-already-consumed' }
      }
    } else if (decision !== 'first-contact') return { allowed: false, reason: decision }
    const state = structuredClone(snapshot.state)
    const reservation = { kind: continuation ? 'requested-reply' : 'first-contact', key: key.toLowerCase(), reservedAt: new Date().toISOString(), ...(continuation ?? {}) }
    const record = state.contacts[String(person.id)] ?? {
      userId: person.id, nodeId: person.node_id, logins: [person.login],
      stopped: false, firstContact: { kind: 'reserved', claimId }, reservations: {},
    }
    if (record.reservations[claimId]) return { allowed: false, reason: 'reservation-already-consumed' }
    record.logins = [...new Set([...record.logins, person.login])]
    record.reservations[claimId] = reservation
    state.contacts[String(person.id)] = record
    try {
      await github.request('PUT', `/repos/${repository}/contents/${STATE_PATH}`, {
        branch: STATE_BRANCH, sha: snapshot.fileSha,
        message: `Record author contact reservation ${person.id}`,
        content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64'),
      })
    } catch (error) {
      if (error.status === 409) continue
      throw error
    }
    // GitHub's Contents API can acknowledge the branch commit before a
    // subsequent GET is served from the new revision. Treat a temporarily
    // missing record as eventual consistency, while still failing closed on a
    // present-but-different or stopped record.
    for (let readbackAttempt = 0; readbackAttempt < RESERVATION_READBACK_ATTEMPTS; readbackAttempt += 1) {
      const confirmed = await readContactState(github, repository, seed)
      const committed = confirmed.state.contacts[String(person.id)]
      if (committed) {
        if (committed.stopped || JSON.stringify(committed.reservations[claimId]) !== JSON.stringify(reservation)) {
          throw new Error('contact reservation readback failed; do not send')
        }
        return { allowed: true, claimId }
      }
      if (readbackAttempt + 1 < RESERVATION_READBACK_ATTEMPTS) {
        await new Promise(resolveDelay => setTimeout(resolveDelay, RESERVATION_READBACK_DELAY_MS))
      }
    }
    throw new Error('contact reservation readback failed; do not send')
  }
  throw new Error('contact state contention; no message sent')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--output') throw new Error('--output is required')
  const snapshot = await readContactState(githubClient(process.env.GITHUB_TOKEN), process.env.GITHUB_REPOSITORY)
  await writeFile(resolve(args[1]), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  process.stdout.write(`AUTHOR_CONTACT_SNAPSHOT_OK people=${Object.keys(snapshot.state.contacts).length}\n`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
