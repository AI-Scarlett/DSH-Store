import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { validateCatalog, verifyCatalogEntry } from '../src/catalog.mjs'

export const SUBMISSION_REPORT_MARKER = '<!-- dsh-plugin-submission-check -->'

const LABELS = Object.freeze({
  catalogId: 'Catalog ID',
  displayName: 'Display name',
  description: 'Description',
  repositoryUrl: 'GitHub repository',
  commit: 'Immutable commit',
  manifestPath: 'Manifest path',
  installPath: 'Install path',
  packageName: 'Package name',
  version: 'Package version',
  categories: 'Categories',
  entryIds: 'DSH entry IDs',
  installScripts: 'Install lifecycle scripts',
  pluginType: 'Plugin type',
  license: 'License',
  permissionLevel: 'Permission level',
  filePermission: 'File permission',
  networkPermission: 'Network permission',
  commandPermission: 'Command execution',
  credentials: 'Credential access',
  externalDependencies: 'External dependencies',
  dshCompatibility: 'DSH compatibility',
  nodeCompatibility: 'Node.js compatibility',
  systems: 'Supported systems',
  profiles: 'Supported profiles',
  guarantees: 'Registry guarantees',
})

const NONE_VALUES = new Set(['none', '无', 'n/a', 'not applicable'])
const ROOT_VALUES = new Set(['.', '/', 'root', 'repository root', '仓库根目录'])
const PROTECTED_ENTRY_IDS = new Set(['ui-settings-plugin-inventory', 'dsh-safe-plugin-manager'])
const ALLOWED_INSTALL_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepare'])

function submissionError(code, message) {
  return Object.assign(new Error(message), { code })
}

function cleanValue(value) {
  const cleaned = String(value ?? '').trim()
  if (cleaned === '' || cleaned === '_No response_' || cleaned === 'No response') return ''
  return cleaned
}

export function parseIssueForm(body) {
  if (typeof body !== 'string' || body.trim() === '') {
    throw submissionError('SUBMISSION_BODY_INVALID', 'Issue body is empty or not an Issue Form response')
  }
  const fields = new Map()
  const lines = body.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^### (.+)$/.exec(lines[index])
    if (!match) continue
    let end = index + 1
    while (end < lines.length && !lines[end].startsWith('### ')) end += 1
    fields.set(match[1].trim(), cleanValue(lines.slice(index + 1, end).join('\n')))
    index = end - 1
  }
  return fields
}

function requiredField(fields, label) {
  const value = cleanValue(fields.get(label))
  if (value === '') throw submissionError('SUBMISSION_FIELD_MISSING', `${label} is required`)
  return value
}

function optionCode(value) {
  return cleanValue(value).split(/\s+(?:—|–|-)\s+/u)[0].trim().toLowerCase()
}

function listValue(value, options = {}) {
  const cleaned = cleanValue(value)
  if (cleaned === '') return []
  if (NONE_VALUES.has(cleaned.toLowerCase())) return options.noneIsValue === true ? ['none'] : []
  const items = cleaned
    .split(/[\n,，;；]+/u)
    .map(item => item.replace(/^\s*[-*]\s*(?:\[[ xX]\]\s*)?/, '').trim())
    .filter(Boolean)
    .map(item => options.codes === true ? optionCode(item) : item)
  return [...new Set(items)]
}

function relativePath(value, label, options = {}) {
  const cleaned = cleanValue(value)
  if (options.root === true && ROOT_VALUES.has(cleaned.toLowerCase())) return null
  if (cleaned === '' || cleaned.startsWith('/') || cleaned.includes('..') || cleaned.includes('\\')) {
    throw submissionError('SUBMISSION_PATH_INVALID', `${label} must be a safe repository-relative path`)
  }
  return cleaned.replace(/^\.\//, '').replace(/\/$/, '')
}

function guaranteesChecked(value) {
  const checks = cleanValue(value).match(/^- \[[xX]\] /gm) ?? []
  if (checks.length < 3) {
    throw submissionError('SUBMISSION_GUARANTEE_MISSING', 'All registry guarantees must be accepted')
  }
}

export function buildCandidateEntry(fields) {
  const manifestPath = relativePath(requiredField(fields, LABELS.manifestPath), LABELS.manifestPath)
  const installPath = relativePath(requiredField(fields, LABELS.installPath), LABELS.installPath, { root: true })
  const expectedManifest = installPath === null ? 'package.json' : `${installPath}/package.json`
  if (manifestPath !== expectedManifest) {
    throw submissionError(
      'SUBMISSION_INSTALL_PATH_MISMATCH',
      `Manifest path must be ${expectedManifest} for the declared install path`,
    )
  }
  const commit = requiredField(fields, LABELS.commit).toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw submissionError('SUBMISSION_COMMIT_INVALID', 'Immutable commit must be a full 40-character lowercase Git SHA')
  }
  const installScripts = listValue(requiredField(fields, LABELS.installScripts), { codes: true })
  if (installScripts.some(script => !ALLOWED_INSTALL_SCRIPTS.has(script))) {
    throw submissionError('SUBMISSION_LIFECYCLE_INVALID', 'Lifecycle scripts may only contain preinstall, install, postinstall, or prepare')
  }
  const entryIds = listValue(requiredField(fields, LABELS.entryIds))
  if (entryIds.some(id => PROTECTED_ENTRY_IDS.has(id))) {
    throw submissionError('SUBMISSION_ENTRY_PROTECTED', 'The submission uses a protected DSH entry ID')
  }
  const packageName = requiredField(fields, LABELS.packageName)
  if (packageName.startsWith('@deepseek-ai/')) {
    throw submissionError('SUBMISSION_PACKAGE_PROTECTED', 'Third-party plugins cannot use the @deepseek-ai namespace')
  }
  const credentials = listValue(requiredField(fields, LABELS.credentials), { codes: true, noneIsValue: true })
  if (credentials.includes('none') && credentials.length > 1) {
    throw submissionError('SUBMISSION_CREDENTIAL_INVALID', 'Credential access cannot combine none with another permission')
  }
  guaranteesChecked(requiredField(fields, LABELS.guarantees))
  return {
    id: requiredField(fields, LABELS.catalogId),
    name: requiredField(fields, LABELS.displayName),
    packageName,
    description: requiredField(fields, LABELS.description),
    repositoryUrl: requiredField(fields, LABELS.repositoryUrl),
    defaultBranch: 'main',
    manifestPath,
    ...(installPath === null ? {} : { installPath }),
    commit,
    version: requiredField(fields, LABELS.version),
    categories: listValue(requiredField(fields, LABELS.categories)),
    featured: false,
    entryIds,
    status: 'approved',
    compatibility: {
      dsh: requiredField(fields, LABELS.dshCompatibility),
      node: requiredField(fields, LABELS.nodeCompatibility),
      systems: listValue(requiredField(fields, LABELS.systems)),
      profiles: listValue(requiredField(fields, LABELS.profiles)),
    },
    details: {
      pluginType: optionCode(requiredField(fields, LABELS.pluginType)),
      installSource: 'github',
      license: requiredField(fields, LABELS.license),
      permissions: {
        level: optionCode(requiredField(fields, LABELS.permissionLevel)),
        files: optionCode(requiredField(fields, LABELS.filePermission)),
        network: optionCode(requiredField(fields, LABELS.networkPermission)),
        commands: optionCode(requiredField(fields, LABELS.commandPermission)),
        credentials,
      },
      externalDependencies: listValue(requiredField(fields, LABELS.externalDependencies)),
      reviewStatus: 'automated-scan',
    },
    risk: {
      installScripts,
      review: 'submission-static-precheck-not-security-audited',
    },
  }
}

async function verifySubmissionPatchSurface(entry, patchUrl, request) {
  const response = await request(patchUrl, {
    headers: { accept: 'application/vnd.github.raw+json', 'user-agent': 'dsh-safe-plugin-manager-submission-check' },
  })
  if (!response?.ok) {
    throw submissionError('SUBMISSION_PATCH_HTTP', `Bundle Patch returned HTTP ${response?.status ?? 'unknown'}`)
  }
  const patch = await response.text()
  if (Buffer.byteLength(patch) > 512 * 1024) {
    throw submissionError('SUBMISSION_PATCH_TOO_LARGE', 'Bundle Patch exceeds the 512 KiB static precheck limit')
  }
  if (/\bname:\s*['"]?@deepseek-ai\//i.test(patch)) {
    throw submissionError('SUBMISSION_PATCH_PROTECTED', 'Bundle Patch impersonates the protected @deepseek-ai namespace')
  }
  const declared = [...patch.matchAll(/(?:^|\n)\s*- id:\s*['"]?([A-Za-z0-9][A-Za-z0-9._-]{0,95})['"]?\s*(?:\n|$)/g)]
    .map(match => match[1])
  const expected = [...entry.entryIds].sort()
  const actual = [...new Set(declared)].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw submissionError('SUBMISSION_PATCH_ENTRIES_MISMATCH', 'Bundle Patch inserted entry IDs must exactly match the submitted DSH entry IDs')
  }
}

function checkCatalogCollisions(entry, catalog) {
  const existing = catalog.entries.find(item => item.id === entry.id || item.packageName === entry.packageName)
  if (existing && (existing.id !== entry.id || existing.packageName !== entry.packageName || existing.repositoryUrl !== entry.repositoryUrl)) {
    throw submissionError('SUBMISSION_CATALOG_COLLISION', 'Catalog ID or package name collides with another registry entry')
  }
  const ownerId = existing?.id ?? null
  const entryIds = new Map()
  for (const item of catalog.entries) {
    if (item.id === ownerId) continue
    for (const id of item.entryIds) entryIds.set(id, item.id)
  }
  for (const id of entry.entryIds) {
    if (entryIds.has(id)) {
      throw submissionError('SUBMISSION_ENTRY_COLLISION', `DSH entry ID ${id} is already owned by ${entryIds.get(id)}`)
    }
  }
}

export async function checkSubmission(body, options = {}) {
  const catalogDocument = options.catalogDocument ?? JSON.parse(await readFile(
    new URL('../registry/catalog.json', import.meta.url), 'utf8',
  ))
  const catalog = validateCatalog(catalogDocument)
  const candidate = buildCandidateEntry(parseIssueForm(body))
  const validated = validateCatalog({ ...catalogDocument, entries: [candidate] }).entries[0]
  checkCatalogCollisions(validated, catalog)
  const source = await verifyCatalogEntry(validated, {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.retryDelaysMs ? { retryDelaysMs: options.retryDelaysMs } : {}),
  })
  const request = options.fetch ?? globalThis.fetch
  if (typeof request !== 'function') throw submissionError('SUBMISSION_FETCH_UNAVAILABLE', 'Public fixed-source verification is unavailable')
  await verifySubmissionPatchSurface(validated, source.patchUrl, request)
  return { status: 'passed', candidate: validated, source }
}

function safeCode(value) {
  return String(value ?? '').replace(/`/g, '\\`').slice(0, 500)
}

export function renderSubmissionReport(result) {
  if (result.status === 'passed') {
    const entry = result.candidate
    return `${SUBMISSION_REPORT_MARKER}\n### DSH 插件提交自动预检：通过\n\n` +
      `- 固定来源：[\`${safeCode(entry.commit)}\`](${entry.repositoryUrl}/commit/${entry.commit})\n` +
      `- 安装目标：\`${safeCode(entry.packageName)}@${safeCode(entry.version)}\`，manifest 为 \`${safeCode(entry.manifestPath)}\`\n` +
      `- Bundle 入口：${entry.entryIds.map(id => `\`${safeCode(id)}\``).join('、')}\n` +
      `- 生命周期脚本：${entry.risk.installScripts.length > 0 ? entry.risk.installScripts.map(name => `\`${name}\``).join('、') : '无'}\n\n` +
      '> 此结果仅表示固定 Commit 的 manifest、Bundle Patch、入口 ID、生命周期声明和目录字段通过静态预检。工作流不会执行第三方代码；通过不代表安全审计、运行验证或自动上架。'
  }
  return `${SUBMISSION_REPORT_MARKER}\n### DSH 插件提交自动预检：未通过\n\n` +
    `- 错误代码：\`${safeCode(result.code ?? 'SUBMISSION_CHECK_FAILED')}\`\n` +
    `- 原因：${safeCode(result.message ?? 'Unknown validation failure')}\n\n` +
    '> 请编辑本 Issue 修正字段；编辑后会自动重新检查。未通过的申请不会进入人工上架评审。工作流不会执行第三方代码。'
}

function argumentsFrom(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw submissionError('SUBMISSION_CLI_INVALID', 'Expected --event, --report, and --result arguments')
    args.set(key, value)
  }
  return args
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = argumentsFrom(argv)
  const eventPath = args.get('--event')
  const reportPath = args.get('--report')
  const resultPath = args.get('--result')
  if (!eventPath || !reportPath || !resultPath) {
    throw submissionError('SUBMISSION_CLI_INVALID', '--event, --report, and --result are required')
  }
  const event = JSON.parse(await readFile(eventPath, 'utf8'))
  let result
  try {
    result = await checkSubmission(event?.issue?.body, { retryDelaysMs: [300, 900] })
  } catch (error) {
    result = {
      status: 'failed',
      code: typeof error?.code === 'string' ? error.code : 'SUBMISSION_CHECK_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }
  }
  await writeFile(reportPath, `${renderSubmissionReport(result)}\n`, 'utf8')
  await writeFile(resultPath, `${JSON.stringify({
    status: result.status,
    code: result.code ?? null,
    checkedAt: new Date().toISOString(),
  })}\n`, 'utf8')
  return result.status === 'passed' ? 0 : 1
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli().then(code => { process.exitCode = code }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  })
}
