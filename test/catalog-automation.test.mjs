import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { promisify } from 'node:util'
import { permissionSignals } from '../src/automation-source-policy.mjs'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const execFileAsync = promisify(execFile)
const rootPath = fileURLToPath(new URL('..', import.meta.url))
const catalogAutomationPath = fileURLToPath(new URL('../scripts/automate-catalog.mjs', import.meta.url))

test('permission scan ignores inert Catalog metadata and ordinary identifiers', () => {
  const source = `
    const metadata = {
      repository: 'https://github.com/AI-Scarlett/dsh-settings-hub',
      network: 'none',
      credentials: ['none'],
    }
    function renameCustomTab() {}
    if (/network|browser|web|proxy/i.test(item.id)) return 'globe'
  `
  assert.deepEqual(permissionSignals(source), {
    files: false,
    network: false,
    commands: false,
    credentials: false,
    protectedDsh: false,
  })
})

test('permission scan still fails closed on executable capability signals', () => {
  assert.equal(permissionSignals(`import { readFile } from 'node:fs/promises'`).files, true)
  assert.equal(permissionSignals(`const transport = require('node:https')`).network, true)
  assert.equal(permissionSignals(`await fetch(endpoint)`).network, true)
  assert.equal(permissionSignals(`import { spawn } from 'node:child_process'`).commands, true)
  assert.equal(permissionSignals(`process.env.API_KEY`).credentials, true)
  assert.equal(permissionSignals(`credentials.get('provider')`).credentials, true)
})

test('automatic policy runs every eight hours and fails closed on permission or supply-chain signals', async () => {
  const policy = JSON.parse(await read('registry/automation-policy.json'))
  assert.equal(policy.scheduleHours, 8)
  assert.equal(policy.updates.checkAllCatalogEntries, true)
  assert.equal(policy.updates.versionAuthority, 'canonical-github-default-branch-manifest-at-fixed-commit')
  assert.equal(policy.updates.concurrency, 8)
  assert.equal(policy.updates.maxCommitSpan, 200)
  assert.deepEqual(policy.compatibility, {
    authority: 'official-npm-registry-active-supported-channels-through-highest',
    registryUrl: 'https://registry.npmjs.org/@deepseek-ai%2Fdsh',
    latestReleaseCount: 3,
    requiredCompatibleReleases: 1,
    unsupportedCatalogStatus: 'unlisted',
    candidateStatus: 'reviewing',
    failClosedOnAuthorityError: true,
  })
  assert.deepEqual(policy.candidateRetention, {
    authority: 'candidate-fixed-commit-package-manifests',
    pruneRejectedWithoutLatestThreeCompatibility: true,
    exactReleaseEvidenceRequired: true,
    scanBuckets: 24,
    maxCandidatesPerRun: 96,
    maxTreeEntries: 1200,
    maxManifestCandidates: 48,
    maxManifestBytes: 262144,
    concurrency: 8,
  })
  assert.equal(policy.automaticApproval.allowLifecycleScripts, false)
  assert.equal(policy.automaticApproval.allowRuntimeDependencies, false)
  assert.equal(policy.automaticApproval.requireManifestRepositoryMatch, true)
  assert.equal(policy.automaticApproval.requireRepositoryLicenseMatch, true)
  assert.ok(Object.values(policy.automaticApproval.permissionSignals).every(value => value === false))
  assert.equal(policy.publication.repository, 'AI-Scarlett/DSH-Store')
  assert.deepEqual(policy.publication.publicCatalogUrls, [
    'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/catalog.json',
    'https://ai-scarlett.github.io/DSH-Store/registry/catalog.json',
    'https://dsh.store/registry/catalog.json',
    'https://dsh-store.cn/registry/catalog.json',
  ])
})

test('scheduled automation uses a policy PR and never executes third-party package code', async () => {
  const [workflow, source] = await Promise.all([
    read('.github/workflows/catalog-automation.yml'),
    read('scripts/automate-catalog.mjs'),
  ])
  assert.match(workflow, /cron: "5 \*\/8 \* \* \*"/)
  assert.match(workflow, /pull-requests: write/)
  assert.match(workflow, /ref: main/)
  assert.match(workflow, /Pin the fresh main authority for this run/)
  assert.match(workflow, /CATALOG_BASE_COMMIT: \$\{\{ steps\.base\.outputs\.sha \}\}/)
  assert.doesNotMatch(workflow, /-f sha="\$GITHUB_SHA"|--arg head "\$GITHUB_SHA"/)
  assert.match(workflow, /gh workflow run registry\.yml --ref "\$branch"/)
  assert.match(workflow, /gh run watch "\$validation_run_id" --exit-status/)
  assert.match(workflow, /codeql_passed/)
  assert.match(workflow, /gh pr merge --squash --delete-branch/)
  assert.match(workflow, /--json state --jq \.state/)
  assert.match(workflow, /createCommitOnBranch/)
  assert.match(workflow, /registry\/catalog\.json.+@base64/s)
  assert.match(workflow, /registry\/candidates\.json.+@base64/s)
  assert.match(workflow, /commit\.verification\.verified/)
  assert.match(workflow, /uses: \.\/\.github\/workflows\/author-notifications\.yml/)
  assert.match(workflow, /uses: \.\/\.github\/workflows\/catalog-run-report\.yml/)
  assert.match(workflow, /catalog_run_id: \$\{\{ github\.run_id \}\}/)
  assert.match(workflow, /catalog_run_attempt: \$\{\{ github\.run_attempt \}\}/)
  assert.match(workflow, /inline_catalog_run: true/)
  assert.match(workflow, /owner-report:[\s\S]+needs: \[update, author-notifications\][\s\S]+if: always\(\)/)
  assert.doesNotMatch(workflow, /git commit|git push/)
  assert.doesNotMatch(workflow, /npm (?:install|ci)|pnpm|yarn/)
  assert.doesNotMatch(source, /from ['"]node:child_process['"]|require\(['"](?:node:)?child_process['"]\)/)
  assert.doesNotMatch(source, /npm (?:install|ci)|pnpm|yarn/)
  assert.match(source, /allowLifecycleScripts/)
  assert.match(source, /permissionSignals/)
  assert.match(source, /transientFailures/)
  assert.match(source, /skippedDiscoveries/)
  assert.match(source, /error\?\.status === 404 \|\| error\?\.status === 409/)
  assert.match(source, /retryInfrastructure/)
  assert.match(source, /runtimeFiles\.slice\(index, index \+ 8\)/)
  assert.match(source, /Promise\.all\(batch\.map/)
  assert.match(source, /catalog\.entries\.sort\(compareCatalogEntries\)/)
  assert.match(source, /baselineCatalog\.entries\.slice/)
  assert.match(source, /sourceVersionChecks\.checkedEntries/)
  assert.match(source, /sourceVersionChecks\.newerVersionsDeferred/)
  assert.match(source, /sourceVersionChecks\.unresolvedEntries/)
  assert.match(source, /fetchOfficialDshReleaseWindow/)
  assert.match(source, /applyLatestDshCompatibilityPolicy/)
  assert.match(source, /compatibilityPolicy\.catalogChanged/)
  assert.match(source, /dshReleaseWindowSha256/)
  assert.match(source, /pruneHistoricalRejectedCandidates/)
  assert.match(source, /inspectRejectedCandidateCompatibility/)
  assert.match(source, /candidateRetention\.registryRemovals/)
  assert.match(source, /maximum \$\{policy\.sourceBounds\.maxTotalRuntimeBytes\}/)
  assert.match(source, /CATALOG_AUTOMATION_UPDATE_REVIEW/)
  assert.match(source, /catalogUpdateIdentityMatches/)
  assert.match(source, /buildCatalogVersionUpdate/)
  assert.match(source, /isSafeSelfManagerUpdate/)
  assert.match(source, /SELF_MANAGER_PROTECTED_ENTRY_REASON/)
  assert.match(source, /SELF_MANAGER_PROTECTED_DSH_REASON/)
  assert.match(source, /SELF_MANAGER_MAX_FILE_BYTES = 4 \* 1024 \* 1024/)
  assert.match(source, /SELF_MANAGER_MAX_TOTAL_RUNTIME_BYTES/)
  assert.match(source, /allowProtectedManager/)
  assert.doesNotMatch(source, /entry\.status !== 'approved' \|\| entry\.updatePolicy !== 'source-verified'/)
  assert.match(source, /localizeCatalogEntry/)
  assert.match(source, /assertCatalogLocalization/)
  assert.match(source, /assertLegacyCatalogCompatibility/)
  assert.match(source, /automation precondition hash mismatch/)
  assert.match(source, /automation base Commit must be a full Git SHA/)
  assert.match(source, /writeAutomationFailureReport/)
  assert.match(source, /statisticsAvailable: false/)
})

test('failed Catalog automation preserves a machine-readable failure report before any network scan', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-catalog-automation-failure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const reportPath = join(directory, 'catalog-automation-report.json')
  await assert.rejects(execFileAsync(process.execPath, [
    catalogAutomationPath,
    '--observed-at', '2026-08-25T10:00:00Z',
    '--report', reportPath,
  ], {
    cwd: rootPath,
    env: { ...process.env, CATALOG_BASE_COMMIT: 'not-a-full-commit' },
  }))
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(report.status, 'failed')
  assert.equal(report.completed, false)
  assert.equal(report.statisticsAvailable, false)
  assert.equal(report.failure.stage, 'validate-authority')
  assert.match(report.failure.message, /full Git SHA/)
  assert.equal(Object.hasOwn(report, 'postconditions'), false)
})

test('author remediation notifications are hash-bound, rate-limited, and use only the repository token', async () => {
  const [workflow, planner, resolver, apply] = await Promise.all([
    read('.github/workflows/author-notifications.yml'),
    read('scripts/plan-author-notices.mjs'),
    read('scripts/resolve-author-notice-targets.mjs'),
    read('scripts/apply-author-notice-plan.mjs'),
  ])
  assert.match(workflow, /workflow_call:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /workflow_run:/)
  assert.match(workflow, /Exact completed Catalog run ID to recover/)
  assert.match(workflow, /run-name: Author notifications for Catalog run \$\{\{ inputs\.catalog_run_id \}\}/)
  assert.match(workflow, /issues: write/)
  assert.match(workflow, /actions: read/)
  assert.match(workflow, /jq -r \.path/)
  assert.match(workflow, /\.github\/workflows\/catalog-automation\.yml/)
  assert.doesNotMatch(workflow, /jq -r \.name/)
  assert.match(workflow, /group: author-notifications/)
  assert.match(workflow, /catalog-automation-\$\{CATALOG_RUN_ID\}-\$\{CATALOG_RUN_ATTEMPT\}/)
  assert.match(workflow, /author-notification-plan-\$\{\{ inputs\.catalog_run_id \}\}-\$\{\{ inputs\.catalog_run_attempt \}\}/)
  assert.match(workflow, /--max-create 10/)
  assert.match(workflow, /Candidate Registry 全量覆盖/)
  assert.match(workflow, /candidate_unaccounted/)
  assert.match(workflow, /registry\/candidates\.json/)
  assert.match(workflow, /--catalog-run-id "\$\{\{ steps\.report\.outputs\.run_id \}\}"/)
  assert.match(workflow, /plan-author-notices\.mjs/)
  assert.match(workflow, /apply-author-notice-plan\.mjs/)
  assert.match(workflow, /resolve-author-notice-targets\.mjs/)
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/)
  assert.doesNotMatch(workflow, /PAT|SMTP|npm (?:install|ci)|pnpm|yarn/)
  assert.match(planner, /ignoreInfrastructureFailures: true/)
  assert.match(planner, /deduplicateByCanonicalRepository: true/)
  assert.match(planner, /accountForEveryCandidateRepository: true/)
  assert.match(planner, /neverSendPromotionOnlyMessages: true/)
  assert.match(planner, /neverCreateIssuesInExternalRepositories: true/)
  assert.match(planner, /queueAllDeterministicCandidateRemediation: true/)
  assert.match(planner, /Candidate Registry coverage invariant failed/)
  assert.match(planner, /candidateCoverageFingerprint/)
  assert.match(planner, /candidate-rejected/)
  assert.match(planner, /queuedNewIssues/)
  assert.match(planner, /githubNotificationEmailTriggers/)
  assert.match(planner, /upstreamModifiedStillBlocked/)
  assert.match(planner, /github\.com\/AI-Scarlett\/build-dsh-plugin/)
  assert.match(planner, /https:\/\/dsh\.store\//)
  assert.doesNotMatch(planner, /from ['"]node:child_process['"]|require\(['"](?:node:)?child_process['"]\)/)
  assert.match(resolver, /repository\.owner\.type === 'User'/)
  assert.match(resolver, /commits\?per_page=20/)
  assert.doesNotMatch(resolver, /from ['"]node:child_process['"]|require\(['"](?:node:)?child_process['"]\)/)
  assert.match(apply, /remote main changed after the author notice plan was created/)
  assert.match(apply, /managed GitHub Issues changed after the author notice plan was created/)
  assert.match(apply, /candidate coverage summary invariant failed/)
  assert.match(apply, /candidate coverage fingerprint mismatch/)
  assert.match(apply, /source-update/)
  assert.match(apply, /baseline/)
  assert.doesNotMatch(apply, /from ['"]node:child_process['"]|require\(['"](?:node:)?child_process['"]\)/)
})

test('Catalog directly creates one exact and deduplicated owner report notification', async () => {
  const [workflow, delivery] = await Promise.all([
    read('.github/workflows/catalog-run-report.yml'),
    read('scripts/catalog-report-delivery.mjs'),
  ])
  assert.match(workflow, /workflow_call:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /workflow_run:/)
  assert.match(workflow, /Exact completed Catalog run ID to report/)
  assert.match(workflow, /run-name: Owner report for Catalog run \$\{\{ inputs\.catalog_run_id \}\} \(\$\{\{ inputs\.request_id \}\}\)/)
  assert.match(workflow, /issues: write/)
  assert.match(workflow, /actions: read/)
  assert.match(workflow, /jq -r \.path/)
  assert.match(workflow, /\.github\/workflows\/catalog-automation\.yml/)
  assert.doesNotMatch(workflow, /jq -r \.name/)
  assert.match(workflow, /\.sourceCatalogRunId == \$catalog_run_id/)
  assert.doesNotMatch(workflow, /gh run list --workflow author-notifications\.yml/)
  assert.match(workflow, /author-notification-plan-\$\{CATALOG_RUN_ID\}-\$\{CATALOG_RUN_ATTEMPT\}/)
  assert.match(workflow, /catalog-automation-\$\{CATALOG_RUN_ID\}-\$\{CATALOG_RUN_ATTEMPT\}/)
  assert.match(workflow, /CATALOG_RUN_ID: \$\{\{ steps\.catalog\.outputs\.run_id \}\}/)
  assert.match(workflow, /--delivery-key "catalog-\$CATALOG_RUN_ID"/)
  assert.match(workflow, /catalog-report-delivery\.mjs snapshot/)
  assert.match(workflow, /catalog-report-delivery\.mjs plan/)
  assert.match(workflow, /catalog-report-delivery\.mjs apply/)
  assert.match(workflow, /--mention "@\$GITHUB_REPOSITORY_OWNER"/)
  assert.doesNotMatch(workflow, /SMTP|RESEND|\bPAT\b|npm (?:install|ci)|pnpm|yarn/)
  assert.match(delivery, /reportBodySha256/)
  assert.match(delivery, /reportStateSha256/)
  assert.match(delivery, /remote main changed after the Catalog report delivery plan was created/)
  assert.match(delivery, /managed Catalog report Issue changed after the delivery plan was created/)
  assert.match(delivery, /dsh-catalog-report:v1:/)
  assert.match(delivery, /githubNotificationEmailDeliveryVerified: false/)
  assert.doesNotMatch(delivery, /from ['"]node:child_process['"]|require\(['"](?:node:)?child_process['"]\)/)
})

test('Pages publishes bounded public automation evidence and recent additions', async () => {
  const [workflow, builder, client] = await Promise.all([
    read('.github/workflows/pages.yml'),
    read('scripts/build-marketplace-static.mjs'),
    read('marketplace/app.js'),
  ])
  assert.match(workflow, /actions: read/)
  assert.match(workflow, /gh run list --workflow catalog-automation\.yml --limit 8/)
  assert.match(workflow, /gh run list --workflow marketplace-watchdog\.yml --limit 8/)
  assert.match(workflow, /gh run download "\$run_id"/)
  assert.match(workflow, /--automation-runs/)
  assert.match(workflow, /Build domestic marketplace artifact/)
  assert.match(workflow, /--site-origin https:\/\/dsh-store\.cn/)
  assert.match(workflow, /--baidu-verification codeva-gZjUUScijx/)
  assert.match(workflow, /cp -a _site-domestic\/. _site\/domestic\//)
  assert.match(builder, /automation-status\.json/)
  assert.match(builder, /\['release-manifest\.json', 'automation-status\.json'\]/)
  assert.match(client, /data-automation-additions/)
  assert.match(client, /data-automation-updates/)
  assert.match(client, /data-automation-source-checked/)
  assert.match(client, /data-automation-source-applied/)
  assert.match(client, /entry\.searchTerms/)
})

test('watchdog waits for its exact repair run, invokes its report, and checks every public surface', async () => {
  const [workflow, timer, service, international, intlPublic, domestic, refresh, verifier, governance] = await Promise.all([
    read('.github/workflows/marketplace-watchdog.yml'),
    read('deploy/dsh-store-refresh@.timer'),
    read('deploy/dsh-store-refresh@.service'),
    read('deploy/refresh-international.env'),
    read('deploy/refresh-intl-public.env'),
    read('deploy/refresh-domestic.env'),
    read('deploy/refresh-from-pages.sh'),
    read('scripts/verify-marketplace-public.mjs'),
    read('AGENTS.md'),
  ])
  assert.match(workflow, /cron: "55 \*\/3 \* \* \*"/)
  assert.match(workflow, /32400/)
  assert.match(workflow, /issues: write/)
  assert.match(workflow, /request_id="watchdog-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/)
  assert.match(workflow, /gh workflow run catalog-automation\.yml --ref main -f request_id="\$request_id"/)
  assert.match(workflow, /select\(\.displayTitle == \$expected\)/)
  assert.match(workflow, /repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$target_id/)
  assert.match(workflow, /Directly invoke the owner report for the repaired Catalog run/)
  assert.match(workflow, /gh workflow run catalog-run-report\.yml --ref main/)
  assert.match(workflow, /expected_title="Owner report for Catalog run \$\{CATALOG_RUN_ID\} \(\$\{REQUEST_ID\}\)"/)
  assert.match(workflow, /-f catalog_run_id="\$CATALOG_RUN_ID"/)
  assert.match(workflow, /-f catalog_run_attempt="\$CATALOG_RUN_ATTEMPT"/)
  assert.match(workflow, /gh workflow run pages\.yml --ref main/)
  assert.match(workflow, /render-catalog-automation-notification\.mjs/)
  assert.match(workflow, /Catalog and Candidate Registries/)
  assert.match(workflow, /Download the exact author notification record/)
  assert.match(workflow, /author-notification-plan-\$\{REPORT_RUN_ID\}-\$\{REPORT_RUN_ATTEMPT\}/)
  assert.doesNotMatch(workflow, /gh run list --workflow author-notifications\.yml/)
  assert.match(workflow, /--author-notice-plan/)
  assert.match(workflow, /id: catalog_report[\s\S]{0,160}continue-on-error: true/)
  assert.match(workflow, /catalog-report-delivery\.mjs snapshot/)
  assert.match(workflow, /catalog-report-delivery\.mjs plan/)
  assert.match(workflow, /catalog-report-delivery\.mjs apply/)
  assert.match(workflow, /watchdog-alert/)
  assert.match(workflow, /catalog-report-state\.json/)
  assert.match(workflow, /\.issue\.comments\[\]\?\.body \| contains\(\$marker\)/)
  assert.doesNotMatch(workflow, /gh issue comment/)
  assert.match(timer, /00,03,06,09,12,15,18,21:47:00 UTC/)
  assert.match(service, /EnvironmentFile=\/etc\/dsh-store\/refresh-%i\.env/)
  assert.match(service, /ReadWritePaths=\/opt\/dsh-store -\/opt\/dsh-store-cn \/run\/lock/)
  assert.match(international, /DSH_STORE_DOMAIN=dsh\.store/)
  assert.match(international, /DSH_STORE_HEALTH_SCHEME=http/)
  assert.match(international, /DSH_STORE_SITE_PREFIX=\/marketplace/)
  assert.match(intlPublic, /DSH_STORE_DOMAIN=dsh\.store/)
  assert.match(intlPublic, /DSH_STORE_ROOT=\/opt\/dsh-store/)
  assert.match(intlPublic, /DSH_STORE_PAGES_SUBDIR=$/m)
  assert.match(intlPublic, /DSH_STORE_HEALTH_SCHEME=https/)
  assert.match(intlPublic, /DSH_STORE_SITE_PREFIX=$/m)
  assert.match(domestic, /DSH_STORE_DOMAIN=dsh-store\.cn/)
  assert.match(domestic, /DSH_STORE_PAGES_SUBDIR=domestic/)
  assert.match(domestic, /DSH_STORE_HEALTH_SCHEME=https/)
  assert.match(domestic, /DSH_STORE_SITE_PREFIX=$/m)
  assert.ok(refresh.indexOf('check_public\n  printf') < refresh.indexOf('reason=already-current'))
  assert.match(refresh, /DSH_STORE_DOMAIN/)
  assert.match(refresh, /pages_subdir/)
  assert.match(refresh, /pages_path_prefix/)
  assert.match(refresh, /data-static-featured-id=/)
  assert.match(refresh, /candidates \/registry\/candidates\.json/)
  assert.match(refresh, /'registry\/candidates\.json'/)
  assert.match(refresh, /Candidate Registry artifact trust boundary is invalid/)
  assert.doesNotMatch(refresh, /id="catalog-snapshot"/)
  assert.match(refresh, /Refusing to remove unexpected failed candidate/)
  assert.match(refresh, /--max-time 300 --retry 4 --retry-all-errors --retry-delay 2 --continue-at -/)
  assert.match(refresh, /dsh\.store:http:\/marketplace/)
  assert.match(refresh, /dsh\.store:https:/)
  assert.match(refresh, /dsh-store\.cn:https:/)
  assert.match(refresh, /dsh-store\.cn:domestic/)
  assert.doesNotMatch(refresh, /curl[^\n]+ -k(?:\s|$)/)
  assert.match(verifier, /validateCandidateRegistry/)
  assert.match(verifier, /candidateSurfaces/)
  assert.match(verifier, /Candidate Registry does not match GitHub main authority/)
  assert.match(governance, /does not require a human\s+confirmation for each scheduled run/)
  assert.match(governance, /Real DSH Profile\/package\/restart/)
})
