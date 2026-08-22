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
  assert.match(workflow, /gh pr merge --auto --squash --delete-branch/)
  assert.match(workflow, /git add -- registry\/catalog\.json registry\/candidates\.json/)
  assert.doesNotMatch(workflow, /npm (?:install|ci)|pnpm|yarn/)
  assert.doesNotMatch(source, /from ['"]node:child_process['"]|require\(['"](?:node:)?child_process['"]\)/)
  assert.doesNotMatch(source, /npm (?:install|ci)|pnpm|yarn/)
  assert.match(source, /allowLifecycleScripts/)
  assert.match(source, /permissionSignals/)
  assert.match(source, /transientFailures/)
  assert.match(source, /retryInfrastructure/)
  assert.match(source, /runtimeFiles\.slice\(index, index \+ 8\)/)
  assert.match(source, /Promise\.all\(batch\.map/)
  assert.match(source, /automation precondition hash mismatch/)
})

test('watchdog checks the previous run and every public Catalog surface', async () => {
  const [workflow, timer, service, international, domestic, refresh, governance] = await Promise.all([
    read('.github/workflows/marketplace-watchdog.yml'),
    read('deploy/dsh-store-refresh@.timer'),
    read('deploy/dsh-store-refresh@.service'),
    read('deploy/refresh-international.env'),
    read('deploy/refresh-domestic.env'),
    read('deploy/refresh-from-pages.sh'),
    read('AGENTS.md'),
  ])
  assert.match(workflow, /cron: "55 \*\/3 \* \* \*"/)
  assert.match(workflow, /gh workflow run catalog-automation\.yml --ref main/)
  assert.match(workflow, /gh workflow run pages\.yml --ref main/)
  assert.match(timer, /00,03,06,09,12,15,18,21:47:00 UTC/)
  assert.match(service, /EnvironmentFile=\/etc\/dsh-store\/refresh-%i\.env/)
  assert.match(service, /ReadWritePaths=\/opt\/dsh-store \/opt\/dsh-store-cn \/run\/lock/)
  assert.match(international, /DSH_STORE_DOMAIN=dsh\.store/)
  assert.match(domestic, /DSH_STORE_DOMAIN=dsh-store\.cn/)
  assert.ok(refresh.indexOf('check_public\n  printf') < refresh.indexOf('reason=already-current'))
  assert.match(refresh, /DSH_STORE_DOMAIN/)
  assert.match(governance, /does not require a human\s+confirmation for each scheduled run/)
  assert.match(governance, /Real DSH Profile\/package\/restart/)
})
