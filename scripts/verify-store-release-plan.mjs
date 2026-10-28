import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const planPath = 'docs/ops/store-095-catalog-20261016.json'
const digest = value => value === null ? null : createHash('sha256').update(value).digest('hex')
export function validateStoreRelease(plan, changes, readBase, readCurrent, sourceFile) {
  const currentPlanPath = plan?.planPath ?? planPath
  const sourceReviewPath = plan?.sourceReviewPath ?? 'docs/reviews/store-095-source-review-20261016.json'
  const version = plan?.version ?? '0.9.5'
  const latestDshWindow = plan?.latestDshWindow ?? ['0.2.1-alpha.4']
  const latestWindowTarget = Array.isArray(latestDshWindow) ? latestDshWindow.at(-1) : null
  if (!Array.isArray(latestDshWindow) || latestDshWindow.length < 1
    || new Set(latestDshWindow).size !== latestDshWindow.length
    || latestDshWindow.some(release => typeof release !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release))
    || (plan.latestDshWindow && (latestDshWindow.length !== 3 || plan.targetDshRelease !== latestWindowTarget))) throw new Error('Invalid exact DSH release window')
  if (!/^docs\/ops\/store-[0-9]{3,4}-catalog-[0-9]{8}\.json$/.test(currentPlanPath)
    || !/^docs\/reviews\/store-[0-9]{3,4}-source-review-[0-9]{8}\.json$/.test(sourceReviewPath)
    || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid Store release identity')
  if (plan?.schemaVersion !== 1 || plan.type !== 'first-party-store-catalog-release'
    || !/^[a-f0-9]{40}$/.test(plan.baseCommit ?? '') || !/^[a-f0-9]{40}$/.test(plan.sourceCommit ?? '')
    || !Array.isArray(plan.scope) || new Set(plan.scope).size !== plan.scope.length
    || JSON.stringify([...plan.scope].sort()) !== JSON.stringify(Object.keys(plan.preconditions ?? {}).sort())
    || plan.scope.some(p => typeof p !== 'string' || !/^[a-zA-Z0-9._/-]+$/.test(p) || p.startsWith('/') || p.includes('..'))
    || plan.authorization?.source !== 'direct-user-request'
    || plan.authorization?.githubWriteCredential !== 'short-lived-token-required') throw new Error('Invalid first-party Store release plan')
  for (const path of plan.scope) if (digest(readBase(path)) !== plan.preconditions[path]) throw new Error(`Base hash changed: ${path}`)
  for (const path of changes) {
    if (!plan.scope.includes(path)) throw new Error(`Outside Store release scope: ${path}`)
    if (path !== currentPlanPath && !/^[a-f0-9]{64}$/.test(plan.postconditions?.[path] ?? '')) throw new Error(`Missing reviewed hash: ${path}`)
  }
  for (const [path, hash] of Object.entries(plan.postconditions ?? {})) {
    if (!plan.scope.includes(path) || path === currentPlanPath || digest(readCurrent(path)) !== hash) throw new Error(`Reviewed content changed: ${path}`)
  }
  const review = JSON.parse(readCurrent(sourceReviewPath))
  const analysis = review.analysis
  if (review.commit !== plan.sourceCommit || review.sourceTree !== plan.sourceTree || review.sourceHead !== plan.sourceHead || !review.canonicalPublicRepository || !analysis?.scanComplete
    || analysis.filesScanned !== analysis.sourceEvidence?.length || analysis.sourceEvidence.length > 512
    || analysis.runtimeBytes > 8388608 || analysis.budgetFindings.length || analysis.unsupportedFiles
    || analysis.signals.protectedDsh || analysis.reviewSignals.dynamicModuleLoading || analysis.securityScan.findingsTruncated
    || review.manifest.name !== 'dsh-safe-plugin-manager' || review.manifest.version !== version
    || review.manifest.repository.url !== 'git+https://github.com/AI-Scarlett/DSH-Store.git'
    || review.manifest.dsh.bundle.patch !== './cordis.patch.yml'
    || Object.keys({ ...review.manifest.dependencies, ...review.manifest.optionalDependencies }).length
    || ['preinstall', 'install', 'postinstall', 'prepare'].some(key => review.manifest.scripts?.[key])) throw new Error('Incomplete first-party source evidence')
  for (const source of analysis.sourceEvidence) {
    if (digest(sourceFile(source.file)) !== source.sha256) throw new Error(`Fixed source changed: ${source.file}`)
  }
  if (digest(sourceFile('package.json')) !== digest(Buffer.from(JSON.stringify(review.manifest, null, 2) + '\n'))) throw new Error('Manifest evidence changed')
  const critical = analysis.securityScan.findings.filter(f => f.severity === 'critical')
  if (critical.length !== 1 || critical[0].rule !== 'crypto-miner' || critical[0].file !== 'src/submission-security-scan.mjs' || critical[0].line !== 58
    || review.disposition?.kind !== 'scanner-rule-literal'
    || review.disposition.sha256 !== digest(sourceFile('src/submission-security-scan.mjs'))) throw new Error('Unresolved critical source finding')
  if (!Array.isArray(review.findingReviews) || review.findingReviews.length !== analysis.securityScan.findings.length
    || review.findingReviews.some((row, index) => row.file !== analysis.securityScan.findings[index].file
      || row.rule !== analysis.securityScan.findings[index].rule || row.line !== analysis.securityScan.findings[index].line
      || row.rationale.length < 30 || row.sha256 !== digest(sourceFile(row.file)))) throw new Error('Missing exact finding review')
  if (plan.reviewMode === 'first-party-owner-reviewed') {
    const ownerReview = review.ownerReview
    const viewEvidence = analysis.toolViewEvidence ?? []
    const detail = JSON.parse(readCurrent('registry/catalog/details/dsh-safe-plugin-manager.json'))
    if (ownerReview?.status !== 'approved-with-existing-elevated-permissions'
      || ownerReview.decision !== 'pin-existing-first-party-catalog-entry'
      || ownerReview.commit !== plan.sourceCommit || ownerReview.automaticThirdPartyAdmission !== false
      || ownerReview.realDesktopUi !== 'unverified' || ownerReview.realProfile !== 'unchanged'
      || ownerReview.independentSecurityAudit !== 'not-performed'
      || JSON.stringify(ownerReview.compatibilityWindow) !== JSON.stringify(latestDshWindow)
      || JSON.stringify(ownerReview.permissionReview?.declared) !== JSON.stringify(detail.details?.permissions)
      || ownerReview.toolViewReview?.status !== 'serialized-review-data-only'
      || JSON.stringify(ownerReview.toolViewReview.evidence) !== JSON.stringify(viewEvidence)
      || viewEvidence.some(item => analysis.runtimeEntryFiles.includes(item.file) || analysis.binEntryFiles.includes(item.file))) {
      throw new Error('Incomplete first-party owner review')
    }
  }
  const runtimeNames = ['ubuntu-latest', 'macos-latest', 'windows-latest'].flatMap(os => ['10', '11', '12'].map(pnpm => `runtime (${os}, ${pnpm})`))
  if (runtimeNames.some(name => !review.sourceChecks.some(check => check.name === name && check.state === 'SUCCESS'))) throw new Error('Missing platform runtime evidence')
  const before = JSON.parse(readBase('registry/catalog.json'))
  const after = JSON.parse(readCurrent('registry/catalog.json'))
  const withoutManager = value => value.entries.filter(entry => entry.id !== 'dsh-safe-plugin-manager')
  if (JSON.stringify(withoutManager(before)) !== JSON.stringify(withoutManager(after))) throw new Error('Third-party Catalog entries changed')
  const manager = after.entries.find(entry => entry.id === 'dsh-safe-plugin-manager')
  const detail = JSON.parse(readCurrent('registry/catalog/details/dsh-safe-plugin-manager.json'))
  const targetOperations = review.manifest.dsh.compatibility.dshOperations ?? {}
  if (manager?.commit !== plan.sourceCommit || manager.version !== version || manager.status !== 'approved'
    || manager.repositoryUrl !== 'https://github.com/AI-Scarlett/DSH-Store'
    || JSON.stringify(manager.entryIds) !== '["dsh-safe-plugin-manager"]'
    || manager.compatibility.dsh !== review.manifest.dsh.compatibility.dsh
    || manager.compatibility.latestWindow?.state !== 'current'
    || JSON.stringify(manager.compatibility.latestWindow?.releases) !== JSON.stringify(latestDshWindow)
    || latestDshWindow.some(release => review.manifest.dsh.compatibility.dshReleases?.[release] !== 'compatible'
      || manager.compatibility.dshReleases?.[release] !== 'compatible')) throw new Error('Invalid Store Catalog target')
  for (const release of latestDshWindow) {
    const operations = targetOperations[release]
    if (!operations || operations.install !== 'passed' || operations.start !== 'passed'
      || operations.uninstall !== 'passed' || operations.rollback !== 'unknown'
      || JSON.stringify(detail.compatibility?.dshOperations?.[release]) !== JSON.stringify(operations)) {
      throw new Error('Invalid exact Store operation evidence: ' + release)
    }
  }
}
function main() {
  const currentPlanPath = process.argv[2] ?? planPath
  if (process.argv.length > 3 || !/^docs\/ops\/store-[0-9]{3,4}-catalog-[0-9]{8}\.json$/.test(currentPlanPath)) throw new Error('Invalid Store release plan path')
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 24 * 1024 * 1024 }).trim()
  if (process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH))
    const from = event.pull_request?.base?.sha ?? event.before
    const to = event.pull_request?.head?.sha ?? event.after
    if (!from || !to || !git('diff', '--name-only', from, to, '--', currentPlanPath)) { console.log('STORE_RELEASE_PLAN_NOT_CHANGED'); return }
  }
  const plan = JSON.parse(readFileSync(currentPlanPath))
  if (plan.planPath && plan.planPath !== currentPlanPath) throw new Error('Store release plan identity changed')
  git('merge-base', '--is-ancestor', plan.baseCommit, 'HEAD')
  if (git('rev-parse', `${plan.sourceCommit}^{tree}`) !== plan.sourceTree) throw new Error('Merged source differs from tested PR head')
  const show = (commit, path) => { try { return execFileSync('git', ['show', `${commit}:${path}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 24 * 1024 * 1024 }) } catch { return null } }
  const changes = [...new Set([git('diff', '--name-only', plan.baseCommit), git('ls-files', '--others', '--exclude-standard')].join('\n').split('\n').filter(Boolean))]
  validateStoreRelease(plan, changes, path => show(plan.baseCommit, path), path => readFileSync(path), path => show(plan.sourceCommit, path))
  console.log(`STORE_RELEASE_PLAN_OK source=${plan.sourceCommit} changed=${changes.length}`)
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
