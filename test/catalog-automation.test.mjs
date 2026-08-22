import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('automatic policy runs every three hours and fails closed on permission or supply-chain signals', async () => {
  const policy = JSON.parse(await read('registry/automation-policy.json'))
  assert.equal(policy.scheduleHours, 3)
  assert.equal(policy.automaticApproval.allowLifecycleScripts, false)
  assert.equal(policy.automaticApproval.allowRuntimeDependencies, false)
  assert.equal(policy.automaticApproval.requireManifestRepositoryMatch, true)
  assert.equal(policy.automaticApproval.requireRepositoryLicenseMatch, true)
  assert.ok(Object.values(policy.automaticApproval.permissionSignals).every(value => value === false))
  assert.deepEqual(policy.publication.publicCatalogUrls, [
    'https://raw.githubusercontent.com/AI-Scarlett/dsh-safe-plugin-manager/main/registry/catalog.json',
    'https://ai-scarlett.github.io/dsh-safe-plugin-manager/registry/catalog.json',
    'https://dsh.store/registry/catalog.json',
    'https://dsh-store.cn/registry/catalog.json',
  ])
})

test('scheduled automation uses a policy PR and never executes third-party package code', async () => {
  const [workflow, source] = await Promise.all([
    read('.github/workflows/catalog-automation.yml'),
    read('scripts/automate-catalog.mjs'),
  ])
  assert.match(workflow, /cron: "5 \*\/3 \* \* \*"/)
  assert.match(workflow, /pull-requests: write/)
  assert.match(workflow, /gh workflow run registry\.yml --ref "\$branch"/)
  assert.match(workflow, /gh run watch "\$validation_run_id" --exit-status/)
  assert.match(workflow, /codeql_passed/)
  assert.match(workflow, /gh pr merge --squash --delete-branch/)
  assert.match(workflow, /--json state --jq \.state/)
  assert.match(workflow, /createCommitOnBranch/)
  assert.match(workflow, /registry\/catalog\.json.+@base64/s)
  assert.match(workflow, /registry\/candidates\.json.+@base64/s)
  assert.match(workflow, /commit\.verification\.verified/)
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
  assert.match(source, /localizeCatalogEntry/)
  assert.match(source, /assertCatalogLocalization/)
  assert.match(source, /automation precondition hash mismatch/)
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
  assert.match(builder, /automation-status\.json/)
  assert.match(builder, /\['release-manifest\.json', 'automation-status\.json'\]/)
  assert.match(client, /data-automation-additions/)
  assert.match(client, /entry\.searchTerms/)
})

test('watchdog checks the previous run and every public Catalog surface', async () => {
  const [workflow, timer, service, international, intlPublic, domestic, refresh, governance] = await Promise.all([
    read('.github/workflows/marketplace-watchdog.yml'),
    read('deploy/dsh-store-refresh@.timer'),
    read('deploy/dsh-store-refresh@.service'),
    read('deploy/refresh-international.env'),
    read('deploy/refresh-intl-public.env'),
    read('deploy/refresh-domestic.env'),
    read('deploy/refresh-from-pages.sh'),
    read('AGENTS.md'),
  ])
  assert.match(workflow, /cron: "55 \*\/3 \* \* \*"/)
  assert.match(workflow, /gh workflow run catalog-automation\.yml --ref main/)
  assert.match(workflow, /gh workflow run pages\.yml --ref main/)
  assert.match(timer, /00,03,06,09,12,15,18,21:47:00 UTC/)
  assert.match(service, /EnvironmentFile=\/etc\/dsh-store\/refresh-%i\.env/)
  assert.match(service, /ReadWritePaths=\/opt\/dsh-store -\/opt\/dsh-store-cn \/run\/lock/)
  assert.match(international, /DSH_STORE_DOMAIN=dsh\.store/)
  assert.match(international, /DSH_STORE_HEALTH_SCHEME=http/)
  assert.match(international, /DSH_STORE_SITE_PREFIX=\/marketplace/)
  assert.match(intlPublic, /DSH_STORE_DOMAIN=dsh\.store/)
  assert.match(intlPublic, /DSH_STORE_ROOT=\/opt\/dsh-store/)
  assert.match(intlPublic, /DSH_STORE_HEALTH_SCHEME=https/)
  assert.match(intlPublic, /DSH_STORE_SITE_PREFIX=$/m)
  assert.match(domestic, /DSH_STORE_DOMAIN=dsh-store\.cn/)
  assert.match(domestic, /DSH_STORE_HEALTH_SCHEME=https/)
  assert.match(domestic, /DSH_STORE_SITE_PREFIX=$/m)
  assert.ok(refresh.indexOf('check_public\n  printf') < refresh.indexOf('reason=already-current'))
  assert.match(refresh, /DSH_STORE_DOMAIN/)
  assert.match(refresh, /data-static-featured-id=/)
  assert.doesNotMatch(refresh, /id="catalog-snapshot"/)
  assert.match(refresh, /Refusing to remove unexpected failed candidate/)
  assert.match(refresh, /dsh\.store:http:\/marketplace/)
  assert.match(refresh, /dsh\.store:https:/)
  assert.match(refresh, /dsh-store\.cn:https:/)
  assert.doesNotMatch(refresh, /curl[^\n]+ -k(?:\s|$)/)
  assert.match(governance, /does not require a human\s+confirmation for each scheduled run/)
  assert.match(governance, /Real DSH Profile\/package\/restart/)
})
