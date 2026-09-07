#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, lstat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const oid = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const allowedPath = value => /^(?:registry\/(?:catalog|catalog-index|candidates)\.json|registry\/catalog\/details\/[a-z0-9][a-z0-9-]*\.json)$/.test(value)
const pause = ms => new Promise(done => setTimeout(done, ms))

export function validateChanges(changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 2000) throw new Error('Invalid Catalog change count')
  const paths = new Set()
  let bytes = 0
  for (const change of changes) {
    if (!allowedPath(change.path) || paths.has(change.path)) throw new Error('Unsafe or duplicate Catalog path')
    paths.add(change.path)
    if (change.contents !== null && !Buffer.isBuffer(change.contents)) throw new Error('Invalid Catalog file contents')
    bytes += change.contents?.length ?? 0
    if ((change.contents?.length ?? 0) > 8 * 1024 * 1024 || bytes > 16 * 1024 * 1024) throw new Error('Catalog change payload exceeds bounds')
  }
  return changes
}

export function mutationInput({ repository, branch, base, changes }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^automation\/catalog-\d+-\d+$/.test(branch) || !oid(base)) throw new Error('Invalid Catalog commit identity')
  validateChanges(changes)
  return {
    branch: { repositoryNameWithOwner: repository, branchName: branch },
    expectedHeadOid: base,
    message: { headline: 'chore: apply automated Catalog policy' },
    fileChanges: {
      additions: changes.filter(change => change.contents !== null).map(change => ({ path: change.path, contents: change.contents.toString('base64') })),
      deletions: changes.filter(change => change.contents === null).map(change => ({ path: change.path })),
    },
  }
}

// A lost mutation response may still mean the commit exists. Never replay it
// until a readback proves the branch remains at the expected base.
export async function createVerifiedCommit(plan, io, attempts = 4) {
  mutationInput(plan)
  if (!oid(plan.expectedTree) || !Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new Error('Invalid commit verification plan')
  async function inspect() {
    if (await io.getMain() !== plan.base) throw new Error('Catalog main changed; regenerate the policy plan')
    const head = await io.getBranch()
    if (!oid(head)) throw new Error('Invalid Catalog branch head')
    if (head === plan.base) return null
    const commit = await io.getCommit(head)
    if (commit.sha !== head || commit.parents?.length !== 1 || commit.parents[0]?.sha !== plan.base || commit.commit?.tree?.sha !== plan.expectedTree || commit.commit?.verification?.verified !== true) throw new Error('Catalog branch does not match the planned signed commit')
    return head
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const prior = await inspect()
    if (prior) return prior
    let failure
    let returned
    try { returned = await io.createCommit(mutationInput(plan)) } catch (error) { failure = error }
    const actual = await inspect()
    if (actual) {
      if (returned && returned !== actual) throw new Error('Catalog mutation and branch readback disagree')
      return actual
    }
    if (!failure || failure.transient !== true || attempt === attempts) throw new Error('Catalog commit was not verified; submission stopped')
    await io.delay(attempt * 1000)
  }
}

function git(args, options = {}) {
  return execFileSync('git', args, { maxBuffer: 24 * 1024 * 1024, ...options })
}

export async function collectChanges(base) {
  if (!oid(base) || git(['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== base) throw new Error('Local Catalog base changed')
  const tracked = git(['diff', '--name-only', '-z', base, '--', 'registry/'], { encoding: 'utf8' })
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', 'registry/'], { encoding: 'utf8' })
  const paths = [...new Set((tracked + untracked).split('\0').filter(Boolean))].sort()
  const changes = []
  for (const path of paths) {
    if (!allowedPath(path)) throw new Error('Catalog change outside the allowed registry files')
    let contents
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('Unsafe Catalog file')
      contents = await readFile(path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      contents = null
    }
    changes.push({ path, contents })
  }
  return validateChanges(changes)
}

export async function expectedTree(base, changes) {
  validateChanges(changes)
  const temporary = await mkdtemp(join(tmpdir(), 'catalog-commit-'))
  const options = { env: { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') }, encoding: 'utf8' }
  try {
    git(['read-tree', base], options)
    for (const change of changes) {
      if (change.contents === null) git(['update-index', '--force-remove', '--', change.path], options)
      else {
        const blob = git(['hash-object', '-w', '--stdin'], { ...options, input: change.contents }).trim()
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${change.path}`], options)
      }
    }
    return git(['write-tree'], options).trim()
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

function gh(args, input) {
  try {
    return JSON.parse(execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 24 * 1024 * 1024 }))
  } catch (cause) {
    const message = String(cause.stderr ?? '')
    const error = new Error('GitHub Catalog API request failed')
    error.transient = cause.code === 'ETIMEDOUT' || /HTTP (?:429|5\d\d)\b|ECONNRESET|connection reset|TLS handshake timeout|i\/o timeout|unexpected EOF/i.test(message)
    throw error
  }
}

async function readApi(path) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return gh(['api', path]) } catch (error) {
      if (!error.transient || attempt === 3) throw error
      await pause(attempt * 1000)
    }
  }
}

async function main() {
  const [flag, output, ...extra] = process.argv.slice(2)
  if (flag !== '--output' || !output || extra.length) throw new Error('Usage: create-catalog-commit.mjs --output FILE')
  const plan = { repository: process.env.GITHUB_REPOSITORY, branch: process.env.CATALOG_BRANCH, base: process.env.CATALOG_BASE_COMMIT }
  plan.changes = await collectChanges(plan.base)
  mutationInput(plan)
  plan.expectedTree = await expectedTree(plan.base, plan.changes)
  const prefix = `repos/${plan.repository}`
  const commit = await createVerifiedCommit(plan, {
    getMain: async () => (await readApi(`${prefix}/git/ref/heads/main`)).object.sha,
    getBranch: async () => (await readApi(`${prefix}/git/ref/heads/${plan.branch}`)).object.sha,
    getCommit: head => readApi(`${prefix}/commits/${head}`),
    createCommit: async input => {
      const response = gh(['api', 'graphql', '--input', '-'], JSON.stringify({ query: 'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }', variables: { input } }))
      const commit = response.data?.createCommitOnBranch?.commit?.oid
      if (response.errors?.length || !oid(commit)) throw new Error('GitHub returned no verified Catalog commit')
      return commit
    },
    delay: pause,
  })
  await writeFile(resolve(output), JSON.stringify({ commit, expectedTree: plan.expectedTree, changedFiles: plan.changes.map(change => change.path) }, null, 2) + '\n')
  process.stdout.write(`CATALOG_COMMIT_VERIFIED ${commit} files=${plan.changes.length}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
