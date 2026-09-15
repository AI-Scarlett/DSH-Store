import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const STATES = new Set(['queued', 'running', 'succeeded', 'failed', 'rolled-back', 'recovery-required'])
const active = state => state === 'queued' || state === 'running'
const fail = code => Object.assign(new Error(code), { code })
export function createOperationJournal({ dshHome, bootId, capacity = 128 }) {
  const directory = join(dshHome, 'dsh-safe-plugin-manager', 'operations')
  let serial = Promise.resolve()
  const locked = worker => { const value = serial.then(worker); serial = value.catch(() => {}); return value }
  async function prepare() {
    for (const path of [join(dshHome, 'dsh-safe-plugin-manager'), directory]) {
      await mkdir(path, { recursive: true, mode: 0o700 })
      const stat = await lstat(path)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('JOURNAL_UNSAFE_PATH')
    }
  }
  async function read(id) {
    if (!ID.test(id)) throw fail('INVALID_OPERATION_ID')
    const handle = await open(join(directory, `${id}.json`), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > 65536) throw fail('JOURNAL_INVALID')
      const value = JSON.parse(await handle.readFile('utf8'))
      if (value.schemaVersion !== 1 || value.id !== id || !STATES.has(value.state) || typeof value.bootId !== 'string') throw fail('JOURNAL_INVALID')
      return value
    } finally { await handle.close() }
  }
  async function write(value) {
    if (Buffer.byteLength(JSON.stringify(value)) > 65536) throw fail('JOURNAL_TOO_LARGE')
    const temp = join(directory, `.${randomUUID()}.tmp`)
    const handle = await open(temp, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
    try { await rename(temp, join(directory, `${value.id}.json`)) } finally { await rm(temp, { force: true }) }
  }
  async function listRaw() {
    await prepare()
    const files = (await readdir(directory)).filter(file => file.endsWith('.json'))
    if (files.length > capacity) throw fail('JOURNAL_CAPACITY_EXCEEDED')
    return Promise.all(files.map(file => read(file.slice(0, -5))))
  }
  function project(record) {
    if (active(record.state) && record.bootId !== bootId) return { ...record, state: 'recovery-required', phase: 'interrupted', restartRequired: false }
    return record
  }
  return {
    async get(id) { return project(await read(id)) },
    async list() { return (await listRaw()).map(project).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },
    reserve(plan, id) { return locked(async () => {
      const records = await listRaw()
      if (records.some(record => record.profile === plan.profile && (active(record.state) || record.state === 'recovery-required'))) throw fail('OPERATION_RECOVERY_REQUIRED')
      if (records.length >= capacity) {
        const oldest = records.filter(record => !active(record.state) && record.state !== 'recovery-required').sort((a,b) => a.createdAt.localeCompare(b.createdAt))[0]
        if (!oldest) throw fail('JOURNAL_FULL')
        await rm(join(directory, `${oldest.id}.json`))
      }
      const record = { schemaVersion: 1, id, bootId, state: 'queued', phase: 'reserved', createdAt: new Date().toISOString(),
        profile: plan.profile, action: plan.action, packageName: plan.plugin.packageName, targetVersion: plan.plugin.targetVersion,
        source: { repositoryUrl: plan.plugin.repositoryUrl, commit: plan.plugin.commit, manifestPath: plan.plugin.manifestPath, installPath: plan.plugin.installPath },
        planId: plan.planId, preconditions: plan.preconditions, restartRequired: false }
      await write(record)
      return record
    }) },
    update(id, patch) { return locked(async () => {
      const previous = await read(id)
      if (previous.bootId !== bootId || !active(previous.state) || !STATES.has(patch.state)) throw fail('JOURNAL_TRANSITION_REJECTED')
      const record = { ...previous, ...patch, id, bootId, updatedAt: new Date().toISOString() }
      await write(record)
      return record
    }) },
  }
}
