#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPATIBILITY_HOLD_PREFIX } from '../src/catalog-compatibility-policy.mjs'

const MARKER_PATTERN = /<!-- dsh-author-notice:v1 key=([a-z0-9_.-]+\/[a-z0-9_.-]+) signature=([0-9a-f]{64}) notified=([0-9a-f]{64}) -->/i
const SOURCE_MARKER_PATTERN = /<!-- dsh-author-source:v1 fingerprint=([0-9a-f]{64}) known=(true|false) -->/i
const INFRASTRUCTURE_REASON = /(?:HTTP (?:403|404|409|429|5\d\d)|rate.?limit|timed?\s*out|timeout|temporar(?:y|ily)|default branch moved|transport|connection|ECONN|ENOTFOUND)/i
const EXPLICIT_CANDIDATE_SOURCE = /(?:user-request|plugin-submission|fixed-commit-review)/i
const STRONG_DSH_DESCRIPTION = /(?:DeepSeek Harness|\bDSH\s+(?:plugin|插件)|(?:plugin|插件)\s+(?:for\s+)?DSH)\b/i

export const AUTHOR_NOTICE_LABELS = [
  { name: 'author-action-required', color: 'D93F0B', description: 'Upstream author changes are required before DSH STORE can proceed' },
  { name: 'catalog-blocked', color: 'B60205', description: 'Catalog entry remains non-installable' },
  { name: 'update-deferred', color: 'FBCA04', description: 'A newer upstream version was found but could not be applied' },
  { name: 'compatibility-outdated', color: 'E99695', description: 'Catalog entry is temporarily unlisted outside the latest-three DSH compatibility window' },
  { name: 'candidate-rejected', color: 'D4C5F9', description: 'DSH candidate needs upstream changes before another review' },
]

function parseArgs(argv) {
  const options = { maxCreate: 3 }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
    options[name.slice(2)] = value
    index += 1
  }
  options.maxCreate = Number(options['max-create'] ?? options.maxCreate)
  if (!Number.isInteger(options.maxCreate) || options.maxCreate < 0 || options.maxCreate > 12) {
    throw new Error('--max-create must be an integer between 0 and 12')
  }
  return options
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function array(value) {
  return Array.isArray(value) ? value : []
}

function markdownCell(value) {
  return String(value ?? '未知').replace(/\r?\n/g, ' ').replaceAll('|', '\\|')
}

function compactReason(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 1_200)
}

function canonicalNotificationTargets(value) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('notification targets must be an object')
  const output = {}
  for (const key of Object.keys(value).sort()) {
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(key)) throw new Error(`invalid notification target repository: ${key}`)
    if (!Array.isArray(value[key]) || value[key].length < 1 || value[key].length > 3) {
      throw new Error(`invalid notification targets for ${key}`)
    }
    output[key] = [...new Set(value[key].map(login => {
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(String(login))) throw new Error(`invalid GitHub login for ${key}`)
      return String(login)
    }))]
  }
  return output
}

function githubRepository(value) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/?$/i.exec(String(value ?? ''))
  if (!match) throw new Error(`unsupported GitHub repository URL: ${value}`)
  const owner = match[1]
  const repository = match[2]
  return {
    key: `${owner}/${repository}`.toLowerCase(),
    owner,
    repository,
    url: `https://github.com/${owner}/${repository}`,
  }
}

function candidateHasDshIntent(candidate) {
  const topics = new Set(array(candidate.topics).map(item => String(item).toLowerCase()))
  const repositoryName = githubRepository(candidate.repositoryUrl).repository
  return topics.has('dsh-plugin') || topics.has('deepseek-harness')
    || STRONG_DSH_DESCRIPTION.test(String(candidate.description ?? ''))
    || /(?:^|[-_.])dsh(?:$|[-_.])/i.test(repositoryName)
}

function candidateIsExplicit(candidate) {
  return array(candidate.discoverySources).some(source => EXPLICIT_CANDIDATE_SOURCE.test(String(source)))
}

function candidateIsActionable(candidate) {
  const reason = compactReason(candidate.statusReason)
  return candidate.status === 'rejected' && reason !== '' && !INFRASTRUCTURE_REASON.test(reason) && candidateHasDshIntent(candidate)
}

export function parseAuthorNoticeMarker(body) {
  const match = MARKER_PATTERN.exec(String(body ?? ''))
  if (!match) return null
  const source = SOURCE_MARKER_PATTERN.exec(String(body ?? ''))
  return {
    key: match[1].toLowerCase(),
    signature: match[2],
    notifiedSignature: match[3],
    sourceFingerprint: source?.[1] ?? null,
    sourceKnown: source?.[2] === 'true',
  }
}

function sourceCommit(value) {
  return /^[0-9a-f]{40}$/.test(String(value ?? '')) ? String(value) : null
}

function sourceEvidence(values) {
  const commits = [...new Set(values.map(sourceCommit).filter(Boolean))].sort()
  return {
    commits,
    known: commits.length > 0,
    fingerprint: sha256(JSON.stringify(commits)),
  }
}

function collectObservedSources(catalog, candidates, report) {
  const commitsByRepository = new Map()
  const add = (repositoryUrl, commit, priority = 1) => {
    const source = sourceCommit(commit)
    if (!source) return
    let key
    try { key = githubRepository(repositoryUrl).key } catch { return }
    const current = commitsByRepository.get(key)
    if (!current || priority > current.priority) {
      commitsByRepository.set(key, { priority, commits: [source] })
      return
    }
    if (priority === current.priority) current.commits.push(source)
  }
  const catalogById = new Map(array(catalog?.entries).map(entry => [entry.id, entry]))
  for (const entry of array(catalog?.entries)) add(entry.repositoryUrl, entry.commit)
  for (const candidate of array(candidates?.entries)) add(candidate.repositoryUrl, candidate.latestCommit)
  for (const item of array(report?.addedEntries)) add(catalogById.get(item.id)?.repositoryUrl, item.commit, 2)
  for (const item of array(report?.updatedEntries)) add(catalogById.get(item.id)?.repositoryUrl, item.to ?? item.commit, 2)
  for (const item of array(report?.deferredUpdates)) add(catalogById.get(item.id)?.repositoryUrl, item.commit, 2)
  for (const item of array(report?.sourceChangesWithoutVersionBump)) add(catalogById.get(item.id)?.repositoryUrl, item.candidateCommit, 2)
  for (const item of array(report?.upstreamVersionBehind)) add(catalogById.get(item.id)?.repositoryUrl, item.candidateCommit, 2)
  for (const item of array(report?.prunedCandidates)) add(item.repositoryUrl, item.commit, 2)
  for (const item of array(report?.rejectedCandidates)) add(item.repository, item.commit, 2)
  return new Map([...commitsByRepository].map(([key, value]) => [key, sourceEvidence(value.commits)]))
}

export function canonicalExistingIssues(issues) {
  if (!Array.isArray(issues)) throw new Error('existing issues snapshot must be an array')
  return issues.map(issue => {
    if (!Number.isInteger(issue?.number) || issue.number < 1) throw new Error('existing issue number is invalid')
    const state = String(issue.state ?? '').toLowerCase()
    if (!['open', 'closed'].includes(state)) throw new Error(`existing issue #${issue.number} state is invalid`)
    return {
      number: issue.number,
      title: String(issue.title ?? ''),
      state,
      body: String(issue.body ?? ''),
      url: String(issue.url ?? issue.html_url ?? ''),
    }
  }).sort((left, right) => left.number - right.number)
}

function issueSnapshotBuffer(issues) {
  return Buffer.from(`${JSON.stringify(canonicalExistingIssues(issues), null, 2)}\n`)
}

function suggestionLines(reasons) {
  const text = reasons.join('\n')
  const suggestions = []
  const multiplePackages = /Multiple DSH plugins|Plugin path|SUBMISSION_PACKAGE_AMBIGUOUS/i.test(text)
  const add = value => { if (!suggestions.includes(value)) suggestions.push(value) }
  if (text.includes(COMPATIBILITY_HOLD_PREFIX) || /no exact compatible declaration for official DSH releases/i.test(text)) add('提升插件 SemVer，并在新固定 Commit 的 `package.json` 中通过 `dsh.compatibility.dshReleases` 对列出的 DSH 完整版本逐项声明 `compatible`、`incompatible` 或 `unknown`；仅写宽泛范围不会恢复上架或保留失败候选。 / Bump the plugin SemVer and declare each listed full DSH version as `compatible`, `incompatible`, or `unknown` under `dsh.compatibility.dshReleases` in the new fixed-Commit manifest; a range alone will not restore a listing or retain a failed candidate.')
  if (/bundle|dsh\.bundle\.patch|patch/i.test(text)) add('补齐并校验 `package.json` 中的 `dsh.bundle.patch`，确保 Patch 文件位于包内且只新增唯一 DSH entry ID。 / Add a package-local `dsh.bundle.patch` and an additive Patch with unique DSH entry IDs.')
  if (/runtime artifact|runtime source (?:is|was) (?:missing|unavailable)|files list|distributable files|source exceeds|file bytes/i.test(text)) add('把实际运行文件纳入固定 Commit 与 manifest `files`；若需要构建，请提交可分发产物或明确、可复现的 `prepare` 契约。 / Commit the bounded runtime files and declare them in `files`; ship build output or a reproducible `prepare` contract.')
  if (/lifecycle|prepare|install script|preinstall|postinstall/i.test(text)) add('准确声明生命周期脚本及其必要性；能移除安装期执行时优先移除，并保留可复现安装证据。 / Declare every lifecycle script exactly, remove install-time execution where possible, and retain reproducible install evidence.')
  if (/repository.*match|canonical GitHub repository/i.test(text)) add('让 manifest 的 `repository` 指向当前 canonical GitHub 项目，避免目录与源码身份不一致。 / Point the manifest `repository` field at this canonical GitHub repository.')
  if (/license/i.test(text)) add('添加清晰的许可证文件，并让 manifest、GitHub 与分发产物中的许可证标识一致。 / Add a clear license file and keep manifest, GitHub, and distributed-artifact license metadata consistent.')
  if (/Node\.js compatibility|DSH compatibility|compatib/i.test(text)) add('在 manifest 中明确声明 Node.js 与 DSH 兼容范围，并补充一次性 Profile 的安装、启动与卸载证据。 / Declare Node.js and DSH compatibility ranges and add disposable-Profile install/start/uninstall evidence.')
  if (/protected|@deepseek-ai|official|shadow|impersonat/i.test(text)) add('移除对 `@deepseek-ai/*`、受保护 entry ID 或官方组件的替换/冒用；改为仅新增插件自有 ID。 / Do not replace or impersonate protected DSH packages or entry IDs; use additive plugin-owned IDs only.')
  if (/collision|already owned|duplicate/i.test(text)) add('为 Catalog、包名和 Bundle entry 选择新的全局唯一 ID，并同步所有引用。 / Choose globally unique Catalog, package, and Bundle entry IDs and update every reference.')
  if (/dependenc|permission|files permission|network permission|commands permission|credentials permission/i.test(text)) add('明确依赖、权限、外部服务和失败边界；高权限项目可能仍需保持 `user-reviewed`/`blocked`，声明本身不保证自动批准。 / Document dependencies, permissions, external services, and failure bounds; elevated capability may still require a guarded status.')
  if (/symbolic link|symlink|submodule/i.test(text)) add('用固定 Commit 内的普通文件替代符号链接或 Git submodule，保证安装源完整且可复现。 / Replace symlinks or Git submodules with bounded regular files in the pinned source.')
  if (multiplePackages) add('这是包含多个 DSH 插件的 monorepo；请在[上架申请](https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml)中为每个插件分别提交明确的 `tree/<branch>/<package-path>` GitHub 地址，不需要删除其他包。 / This monorepo contains multiple DSH plugins; submit each explicit `tree/<branch>/<package-path>` URL separately through the linked submission form without removing the other packages.')
  if (suggestions.length === 0) add('按下方确定性原因修正固定 GitHub 源、manifest、Bundle、版本与安装契约；不要只修改 README 或标签。 / Fix the pinned source, manifest, Bundle, version, and install contract described below; README or topic changes alone are insufficient.')
  if (multiplePackages) {
    add('提交明确子路径后会立即自动预检；源码修复也会在八小时扫描中复检，无需人工回复“确认”。 / An explicit package path is checked immediately; source fixes are rechecked in the eight-hour scan without a manual approval reply.')
  } else {
    add('修改并推送到默认分支即可；DSH STORE 每八小时自动复检，无需人工回复“确认”。 / Push the fix to the default branch; DSH STORE rechecks every eight hours and needs no manual approval reply.')
  }
  return suggestions
}

function ensureRepository(map, url) {
  const repository = githubRepository(url)
  let record = map.get(repository.key)
  if (!record) {
    record = {
      ...repository,
      catalogBlocked: [],
      deferredUpdates: [],
      compatibilityHolds: [],
      candidates: [],
      createCategories: new Set(),
      createPriority: new Set(),
    }
    map.set(repository.key, record)
  }
  return record
}

function stableItems(record) {
  const byId = (left, right) => String(left.id).localeCompare(String(right.id), 'en')
  return {
    catalogBlocked: [...record.catalogBlocked].sort(byId),
    deferredUpdates: [...record.deferredUpdates].sort(byId),
    compatibilityHolds: [...record.compatibilityHolds].sort(byId),
    candidates: [...record.candidates].sort(byId),
  }
}

function renderNoticeBody(record, signature, notifiedSignature) {
  const items = stableItems(record)
  const reasons = [
    ...items.catalogBlocked.map(item => item.reason),
    ...items.deferredUpdates.map(item => item.reason),
    ...items.compatibilityHolds.map(item => item.reason),
    ...items.candidates.map(item => item.reason),
  ]
  const lines = [
    `<!-- dsh-author-notice:v1 key=${record.key} signature=${signature} notified=${notifiedSignature} -->`,
    `<!-- dsh-author-source:v1 fingerprint=${record.source.fingerprint} known=${record.source.known} -->`,
    `${record.notificationTargets.map(login => `@${login}`).join(' ')} 您好，DSH STORE 的固定 Commit 自动检查发现这个项目目前需要上游修改。`,
    '',
    `Hello ${record.notificationTargets.map(login => `@${login}`).join(' ')}. DSH STORE's fixed-Commit automation found upstream changes required for this repository.`,
    '',
    `项目 / Repository: [${record.owner}/${record.repository}](${record.url})`,
    '',
    '### 检测结果 / Findings',
    '',
    '| 类型 | 插件/候选 | 当前版本 | 上游版本 | 确定性原因 |',
    '|---|---|---:|---:|---|',
  ]
  for (const item of items.catalogBlocked) {
    lines.push(`| Catalog blocked | ${markdownCell(item.name)} | ${markdownCell(item.version)} | — | ${markdownCell(item.reason)} |`)
  }
  for (const item of items.deferredUpdates) {
    lines.push(`| 更新暂缓 / Update deferred | ${markdownCell(item.name)} | ${markdownCell(item.catalogVersion)} | ${markdownCell(item.upstreamVersion)} | ${markdownCell(item.reason)} |`)
  }
  for (const item of items.compatibilityHolds) {
    lines.push(`| 兼容性暂时下架 / Compatibility unlisted | ${markdownCell(item.name)} | ${markdownCell(item.version)} | ${markdownCell(item.requiredDshReleases.join(', '))} | ${markdownCell(item.reason)} |`)
  }
  for (const item of items.candidates) {
    lines.push(`| ${item.pruned ? '候选未保留 / Candidate pruned' : '候选未通过 / Candidate rejected'} | ${markdownCell(item.name)} | ${markdownCell(item.commit?.slice(0, 12) ?? '未知')} | — | ${markdownCell(item.reason)} |`)
  }
  lines.push('', '### 修改建议 / Suggested remediation', '')
  for (const suggestion of suggestionLines(reasons)) lines.push(`- ${suggestion}`)
  lines.push(
    '- 建议使用 [build-dsh-plugin](https://github.com/AI-Scarlett/build-dsh-plugin) 对项目执行 DSH 插件契约检查并生成修改方案；修复后可在 [DSH STORE 官网](https://dsh.store/) 查看重新收录或更新状态。 / Use [build-dsh-plugin](https://github.com/AI-Scarlett/build-dsh-plugin) to check the DSH plugin contract and prepare fixes, then follow the result on the [DSH STORE website](https://dsh.store/).',
  )
  lines.push(
    '',
    '### 自动复检 / Automatic recheck',
    '',
    '- 修复推送后或提交明确的 monorepo 子路径后，自动化会读取新的固定 Commit，重新检查 manifest、许可证、Bundle Patch、entry IDs、生命周期、依赖、权限和运行文件。',
    '- When the deterministic blockers clear, this issue is updated or closed automatically.',
    '- 检查不会执行第三方 `install`、`prepare`、`build`、`test` 或运行时代码。',
    '',
    '> 这不是安全漏洞指控，也不表示项目质量有问题；它只说明当前固定源码尚未满足 DSH STORE 的可安装或自动更新契约。Catalog 通过也不等于真实 DSH Profile 已安装或完成运行时验收。',
    '',
    '[使用 build-dsh-plugin 检查和修改](https://github.com/AI-Scarlett/build-dsh-plugin) · [DSH STORE 官网](https://dsh.store/) · [查看自动化运行](https://github.com/AI-Scarlett/DSH-Store/actions/workflows/catalog-automation.yml) · [查看上架契约](https://github.com/AI-Scarlett/DSH-Store/blob/main/registry/README.md)',
    '',
  )
  const body = `${lines.join('\n')}\n`
  if (Buffer.byteLength(body) > 60_000) throw new Error(`author notice for ${record.key} exceeds the GitHub issue body bound`)
  return body
}

function eventComment(record, signature) {
  const mentions = record.notificationTargets.map(login => `@${login}`).join(' ')
  return `<!-- dsh-author-notice-event:update:${record.key}:${signature} -->\n${mentions} 自动复检发现阻断条件发生变化，本修复单已更新。 / The automatic recheck found changed blockers and updated this remediation issue.\n`
}

function sourceUpdateComment(record) {
  const mentions = record.notificationTargets.map(login => `@${login}`).join(' ')
  return `<!-- dsh-author-notice-event:source:${record.key}:${record.source.fingerprint} -->\n${mentions} 自动复检检测到上游固定 Commit 已变化，但当前阻断条件仍未清除。建议使用 https://github.com/AI-Scarlett/build-dsh-plugin 检查和修改；状态可在 https://dsh.store/ 查看。 / A new upstream fixed Commit was detected, but the blockers remain. Use build-dsh-plugin to check and fix the project, then follow its DSH STORE status.\n`
}

function closeComment(key, signature, sourceStatus) {
  const sourceNote = sourceStatus === 'modified-and-resolved'
    ? '检测到上游源码修改，并且当前阻断条件已清除。 / Upstream source changed and the blockers are now cleared.'
    : '当前阻断条件已清除；是否由作者源码修改导致，现有证据无法确认。 / The blockers are cleared; current evidence cannot attribute that outcome to an upstream source change.'
  return `<!-- dsh-author-notice-event:close:${key}:${signature} -->\n${sourceNote}\n\n自动复检已不再发现本修复单记录的阻断条件，因此自动关闭。该结论只针对 Catalog/候选契约，不代表真实 Profile 安装或运行时验收。 / The recorded Catalog or candidate blockers are no longer present, so this issue is closed automatically.\n`
}

function selectCreates(records, existingKeys, maximum) {
  const categoryOrder = ['update-deferred', 'compatibility-outdated', 'candidate-rejected', 'catalog-blocked']
  const pools = new Map(categoryOrder.map(category => [category, records
    .filter(record => !existingKeys.has(record.key) && record.createCategories.has(category))
    .sort((left, right) => Number(right.createPriority.has(category)) - Number(left.createPriority.has(category))
      || left.key.localeCompare(right.key, 'en'))]))
  const selected = []
  const selectedKeys = new Set()
  while (selected.length < maximum) {
    let added = false
    for (const category of categoryOrder) {
      const pool = pools.get(category)
      while (pool.length > 0 && selectedKeys.has(pool[0].key)) pool.shift()
      if (pool.length === 0) continue
      const record = pool.shift()
      selected.push(record)
      selectedKeys.add(record.key)
      added = true
      if (selected.length >= maximum) break
    }
    if (!added) break
  }
  return selected
}

export function buildAuthorNoticePlan({
  catalog, candidates, report, existingIssues, notificationTargets, baseCommit, inputHashes,
  maxCreate = 3, sourceCatalogRunId = null,
}) {
  if (!/^[0-9a-f]{40}$/.test(String(baseCommit ?? ''))) throw new Error('base Commit must be a full Git SHA')
  if (sourceCatalogRunId !== null && !/^\d+$/.test(String(sourceCatalogRunId))) {
    throw new Error('source Catalog run ID must contain digits only')
  }
  const targetsByRepository = canonicalNotificationTargets(notificationTargets)
  const existing = canonicalExistingIssues(existingIssues)
  const existingByKey = new Map()
  for (const issue of existing) {
    const marker = parseAuthorNoticeMarker(issue.body)
    if (!marker) continue
    if (existingByKey.has(marker.key)) throw new Error(`duplicate author notice issues for ${marker.key}`)
    existingByKey.set(marker.key, { ...issue, marker })
  }

  const repositories = new Map()
  const observedSources = collectObservedSources(catalog, candidates, report)
  const catalogById = new Map(array(catalog?.entries).map(entry => [entry.id, entry]))
  const addedIds = new Set(array(report?.addedEntries).map(entry => entry.id))
  const newlyUnlistedIds = new Set(array(report?.compatibilityUnlisted).map(entry => entry.id))
  for (const entry of array(catalog?.entries)) {
    if (entry.status !== 'blocked' || !entry.statusReason) continue
    const record = ensureRepository(repositories, entry.repositoryUrl)
    record.catalogBlocked.push({ id: entry.id, name: entry.name, version: entry.version, reason: compactReason(entry.statusReason) })
    record.createCategories.add('catalog-blocked')
    if (addedIds.has(entry.id)) record.createPriority.add('catalog-blocked')
  }

  for (const entry of array(catalog?.entries)) {
    if (entry.status !== 'unlisted' || !String(entry.statusReason ?? '').startsWith(COMPATIBILITY_HOLD_PREFIX)) continue
    const record = ensureRepository(repositories, entry.repositoryUrl)
    const reportItem = array(report?.compatibilityUnlisted).find(item => item.id === entry.id)
      ?? array(report?.compatibilityRefreshed).find(item => item.id === entry.id)
    record.compatibilityHolds.push({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      requiredDshReleases: array(reportItem?.requiredDshReleases).length > 0
        ? array(reportItem.requiredDshReleases)
        : array(report?.compatibilityPolicy?.latestReleases),
      reason: compactReason(entry.statusReason),
    })
    record.createCategories.add('compatibility-outdated')
    if (newlyUnlistedIds.has(entry.id)) record.createPriority.add('compatibility-outdated')
  }

  for (const deferred of array(report?.deferredUpdates)) {
    if (typeof deferred.upstreamVersion !== 'string' || INFRASTRUCTURE_REASON.test(String(deferred.reason ?? ''))) continue
    const entry = catalogById.get(deferred.id)
    if (!entry) continue
    const record = ensureRepository(repositories, entry.repositoryUrl)
    record.deferredUpdates.push({
      id: entry.id,
      name: entry.name,
      catalogVersion: deferred.catalogVersion ?? entry.version,
      upstreamVersion: deferred.upstreamVersion,
      reason: compactReason(deferred.reason ?? '自动固定源证据不足'),
    })
    record.createCategories.add('update-deferred')
  }

  const recentRejected = new Set(array(report?.rejectedCandidates).map(item => {
    try { return githubRepository(item.repository).key } catch { return null }
  }).filter(Boolean))
  for (const candidate of array(report?.prunedCandidates)) {
    if (!candidate?.repositoryUrl || !candidateHasDshIntent(candidate) || INFRASTRUCTURE_REASON.test(String(candidate.reason ?? ''))) continue
    const record = ensureRepository(repositories, candidate.repositoryUrl)
    record.candidates.push({
      id: candidate.id,
      name: candidate.name,
      commit: candidate.commit,
      route: 'pruned',
      pruned: true,
      reason: compactReason(candidate.reason),
    })
    record.createCategories.add('candidate-rejected')
    record.createPriority.add('candidate-rejected')
  }
  for (const candidate of array(candidates?.entries)) {
    if (!candidateIsActionable(candidate)) continue
    const repository = githubRepository(candidate.repositoryUrl)
    const explicit = candidateIsExplicit(candidate)
    const recent = recentRejected.has(repository.key)
    if (!explicit && !recent && !existingByKey.has(repository.key)) continue
    const record = ensureRepository(repositories, candidate.repositoryUrl)
    record.candidates.push({
      id: candidate.id,
      name: candidate.name,
      commit: candidate.latestCommit,
      route: candidate.route,
      reason: compactReason(candidate.statusReason),
    })
    if (explicit || recent) record.createCategories.add('candidate-rejected')
    if (recent) record.createPriority.add('candidate-rejected')
  }

  const desired = [...repositories.values()].sort((left, right) => left.key.localeCompare(right.key, 'en'))
  for (const record of desired) {
    const items = stableItems(record)
    record.source = observedSources.get(record.key) ?? sourceEvidence([])
    record.notificationTargets = targetsByRepository[record.key] ?? [record.owner]
    record.labels = ['author-action-required']
    if (items.catalogBlocked.length > 0) record.labels.push('catalog-blocked')
    if (items.deferredUpdates.length > 0) record.labels.push('update-deferred')
    if (items.compatibilityHolds.length > 0) record.labels.push('compatibility-outdated')
    if (items.candidates.length > 0) record.labels.push('candidate-rejected')
    record.labels.sort()
    record.signature = sha256(JSON.stringify({ key: record.key, items, notificationTargets: record.notificationTargets }))
    record.title = `作者修复请求：${record.owner}/${record.repository}（DSH STORE）`
  }

  const createRecords = selectCreates(desired, new Set(existingByKey.keys()), maxCreate)
  const createKeys = new Set(createRecords.map(record => record.key))
  const actions = []
  let unchanged = 0
  const sourceStatuses = []
  for (const record of desired) {
    const current = existingByKey.get(record.key)
    if (!current) {
      if (!createKeys.has(record.key)) continue
      const sourceStatus = record.source.known ? 'new-baseline' : 'unknown'
      sourceStatuses.push({ key: record.key, status: sourceStatus })
      actions.push({
        type: 'create', key: record.key, title: record.title, labels: record.labels,
        signature: record.signature,
        sourceFingerprint: record.source.fingerprint,
        sourceStatus,
        body: renderNoticeBody(record, record.signature, record.signature),
      })
      continue
    }
    const needsBodyUpdate = current.marker.signature !== record.signature || current.state === 'closed'
    const needsNotification = current.marker.notifiedSignature !== record.signature
    const canCompareSource = current.marker.sourceKnown && current.marker.sourceFingerprint && record.source.known
    const sourceChanged = canCompareSource && current.marker.sourceFingerprint !== record.source.fingerprint
    const needsSourceBaselineUpdate = !current.marker.sourceFingerprint
      || (!current.marker.sourceKnown && record.source.known)
    const sourceStatus = sourceChanged
      ? 'modified-still-blocked'
      : canCompareSource
        ? 'not-modified'
        : needsSourceBaselineUpdate
          ? 'tracking-baseline'
          : 'unknown'
    sourceStatuses.push({ key: record.key, status: sourceStatus })
    if (needsBodyUpdate) {
      actions.push({
        type: 'update', key: record.key, issueNumber: current.number, title: record.title, labels: record.labels,
        signature: record.signature,
        sourceFingerprint: record.source.fingerprint,
        sourceStatus,
        pendingBody: renderNoticeBody(record, record.signature, current.marker.notifiedSignature),
        body: renderNoticeBody(record, record.signature, record.signature),
        comment: eventComment(record, record.signature),
        commentMarker: `dsh-author-notice-event:update:${record.key}:${record.signature}`,
      })
    } else if (needsNotification) {
      actions.push({
        type: 'notify', key: record.key, issueNumber: current.number, signature: record.signature,
        sourceFingerprint: record.source.fingerprint,
        sourceStatus,
        body: renderNoticeBody(record, record.signature, record.signature),
        comment: eventComment(record, record.signature),
        commentMarker: `dsh-author-notice-event:update:${record.key}:${record.signature}`,
      })
    } else if (sourceChanged) {
      actions.push({
        type: 'source-update', key: record.key, issueNumber: current.number, signature: record.signature,
        sourceFingerprint: record.source.fingerprint,
        sourceStatus,
        body: renderNoticeBody(record, record.signature, record.signature),
        comment: sourceUpdateComment(record),
        commentMarker: `dsh-author-notice-event:source:${record.key}:${record.source.fingerprint}`,
      })
    } else if (needsSourceBaselineUpdate) {
      actions.push({
        type: 'baseline', key: record.key, issueNumber: current.number, signature: record.signature,
        sourceFingerprint: record.source.fingerprint,
        sourceStatus,
        body: renderNoticeBody(record, record.signature, record.signature),
      })
    } else {
      unchanged += 1
    }
  }

  const desiredKeys = new Set(desired.map(record => record.key))
  for (const [key, current] of existingByKey) {
    if (desiredKeys.has(key) || current.state === 'closed') continue
    const source = observedSources.get(key)
    const canCompareSource = current.marker.sourceKnown && current.marker.sourceFingerprint && source?.known
    const sourceStatus = canCompareSource && current.marker.sourceFingerprint !== source.fingerprint
      ? 'modified-and-resolved'
      : canCompareSource
        ? 'resolved-without-source-change'
        : 'resolved-source-unknown'
    sourceStatuses.push({ key, status: sourceStatus })
    actions.push({
      type: 'close', key, issueNumber: current.number, signature: current.marker.signature,
      sourceFingerprint: source?.fingerprint ?? sourceEvidence([]).fingerprint,
      sourceStatus,
      comment: closeComment(key, current.marker.signature, sourceStatus),
      commentMarker: `dsh-author-notice-event:close:${key}:${current.marker.signature}`,
    })
  }

  const actionOrder = { close: 0, baseline: 1, notify: 2, 'source-update': 3, update: 4, create: 5 }
  actions.sort((left, right) => actionOrder[left.type] - actionOrder[right.type] || left.key.localeCompare(right.key, 'en'))
  const eligibleCreates = desired.filter(record => !existingByKey.has(record.key) && record.createCategories.size > 0).length
  const githubMessageTypes = new Set(['create', 'update', 'notify', 'source-update'])
  const githubMessages = actions.filter(action => githubMessageTypes.has(action.type)).length
  const planIdentity = {
    baseCommit,
    sourceCatalogRunId,
    inputHashes,
    desired: desired.map(record => ({ key: record.key, signature: record.signature, sourceFingerprint: record.source.fingerprint })),
    actions: actions.map(action => ({
      type: action.type, key: action.key, signature: action.signature,
      sourceFingerprint: action.sourceFingerprint, sourceStatus: action.sourceStatus,
    })),
  }
  return {
    schemaVersion: 1,
    planId: sha256(JSON.stringify(planIdentity)).slice(0, 24),
    baseCommit,
    sourceCatalogRunId: sourceCatalogRunId === null ? null : String(sourceCatalogRunId),
    observedAt: report.observedAt,
    preconditions: inputHashes,
    policy: {
      maxNewIssuesPerRun: maxCreate,
      notifyOnlyDeterministicAuthorActions: true,
      ignoreInfrastructureFailures: true,
      neverExecuteThirdPartyCode: true,
      deduplicateByCanonicalRepository: true,
    },
    requiredLabels: AUTHOR_NOTICE_LABELS,
    summary: {
      desiredRepositories: desired.length,
      managedExistingIssues: existingByKey.size,
      eligibleNewIssues: eligibleCreates,
      queuedNewIssues: Math.max(0, eligibleCreates - createRecords.length),
      creates: actions.filter(action => action.type === 'create').length,
      updates: actions.filter(action => action.type === 'update' || action.type === 'notify').length,
      sourceUpdates: actions.filter(action => action.type === 'source-update').length,
      baselineUpdates: actions.filter(action => action.type === 'baseline').length,
      closes: actions.filter(action => action.type === 'close').length,
      unchanged,
      githubMessages,
      githubNotificationEmailTriggers: githubMessages,
      githubNotificationEmailDeliveriesVerified: 0,
      emailDeliveryStatus: 'unverified-recipient-github-settings',
      upstreamModifiedStillBlocked: sourceStatuses.filter(item => item.status === 'modified-still-blocked').length,
      upstreamModifiedResolved: sourceStatuses.filter(item => item.status === 'modified-and-resolved').length,
      noUpstreamModificationDetected: sourceStatuses.filter(item => item.status === 'not-modified').length,
      sourceTrackingBaselines: sourceStatuses.filter(item => item.status === 'new-baseline' || item.status === 'tracking-baseline').length,
      sourceModificationUnknown: sourceStatuses.filter(item => item.status === 'unknown' || item.status === 'resolved-source-unknown').length,
      resolvedWithoutDetectedSourceChange: sourceStatuses.filter(item => item.status === 'resolved-without-source-change').length,
    },
    actions,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  for (const required of ['catalog', 'candidates', 'report', 'existing-issues', 'notification-targets', 'base-commit', 'output']) {
    if (!options[required]) throw new Error(`--${required} is required`)
  }
  const paths = {
    catalog: resolve(options.catalog),
    candidates: resolve(options.candidates),
    report: resolve(options.report),
    existing: resolve(options['existing-issues']),
    targets: resolve(options['notification-targets']),
  }
  const [catalogBuffer, candidatesBuffer, reportBuffer, existingBuffer, targetsBuffer] = await Promise.all([
    readFile(paths.catalog), readFile(paths.candidates), readFile(paths.report), readFile(paths.existing), readFile(paths.targets),
  ])
  const catalog = JSON.parse(catalogBuffer)
  const candidates = JSON.parse(candidatesBuffer)
  const report = JSON.parse(reportBuffer)
  const existingIssues = JSON.parse(existingBuffer)
  const notificationTargets = JSON.parse(targetsBuffer)
  const catalogSha256 = sha256(catalogBuffer)
  const candidatesSha256 = sha256(candidatesBuffer)
  if (report?.postconditions?.catalogSha256 !== catalogSha256 || report?.postconditions?.candidatesSha256 !== candidatesSha256) {
    throw new Error('Catalog automation report does not match the current Registry hashes')
  }
  const inputHashes = {
    catalogSha256,
    candidatesSha256,
    reportSha256: sha256(reportBuffer),
    existingIssuesSha256: sha256(issueSnapshotBuffer(existingIssues)),
    notificationTargetsSha256: sha256(targetsBuffer),
  }
  const plan = buildAuthorNoticePlan({
    catalog, candidates, report, existingIssues, notificationTargets,
    baseCommit: options['base-commit'], inputHashes, maxCreate: options.maxCreate,
    sourceCatalogRunId: options['catalog-run-id'] ?? null,
  })
  await writeFile(resolve(options.output), `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  process.stdout.write(`AUTHOR_NOTICE_PLAN_OK plan=${plan.planId} creates=${plan.summary.creates} updates=${plan.summary.updates} closes=${plan.summary.closes} queued=${plan.summary.queuedNewIssues}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
