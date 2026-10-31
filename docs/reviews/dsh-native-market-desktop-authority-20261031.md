# DSH Desktop installation authority correction — 2026-10-31

## Request

An entry that does not declare DSH Desktop adaptation must still be offered for installation. DSH Desktop's official Plugin Manager owns the final installation checks.

## Official contract reviewed

Reviewed the public DSH source at `deepseek-ai/deepseek-harness` commit `ce7073d51254c26cd63b22a60835b8f948deb447`:

- `PluginManager.inspect()` returns `accepted` for a Git spec after parsing its source and host. It does not claim the remote Git package is compatible.
- `installBundle()` performs the actual Git package operation. DSH evaluates the installed package's `engines.dsh` and DSH peer requirements after retrieval; a refusal returns a structured `incompatible-version` result and restores `package.json` and `pnpm-lock.yaml`.
- DSH's `ChangeResult.error.incompatible` identifies the package, installed version, active DSH version, and unmet requirements. Install-script approval is a separate explicit operation and is not passed by DSH-Store.

Sources: `packages/boot/plugin-manager/src/types.ts`, `packages/boot/plugin-manager/src/index.ts`, and `packages/boot/plugin-manager/README.zh.md` at the fixed source commit above.

## Change

Store `0.9.21` removes Catalog `compatibility.profiles` and `compatibility.dshReleases` as Desktop install gates. Those fields remain visible as informational Catalog records. An approved Catalog entry still needs its canonical GitHub repository, full fixed Commit, valid package identity, and explicit package/Commit confirmation before the client calls the official manager.

The Desktop UI calls `pluginManager.inspect()` first and shows the official problem and reason if DSH refuses the source. If inspection accepts a Git source, it calls `pluginManager.installBundle()` without build approvals. The official manager's DSH compatibility refusal is rendered from its structured error; the Store does not repeat the install. A missing Desktop runtime version in the Store's display snapshot no longer blocks the official manager from checking the running version itself.

Start/close/remove remain bound to the official Desktop `pluginManager` and the matching installed GitHub repository. DSH-Store and `@deepseek-ai/*` packages remain protected. Catalog compatibility is not used to disable Start; the official manager receives the request and its result is shown.

## Verification

- `node --check src/client.js`: passed.
- `node --test test/desktop-compat.test.mjs`: passed, including unadapted/unknown Catalog metadata, missing displayed runtime version, official `incompatible-version` detail rendering, and official `inspect` refusal with no subsequent install call.
- `npm run check`: passed; Registry validation reported 865 entries and the full suite passed 559/559 tests.
- Focused Desktop verification: passed all 12 `test/desktop-compat.test.mjs` cases.
- `npm pack --dry-run --json`: passed; package `dsh-safe-plugin-manager-0.9.21.tgz`, 1,065 files.
- Final plan gate: passed (`DSH_UPGRADE_PLAN_OK`, base `3c101b713d9acaf1698b15f94fa3ddd8a75f434d`, 10 scoped changes); `git diff --check`: passed.
- Real Desktop Profile installation and UI acceptance: not performed by fixture tests; require the separate DSH Desktop operation plan.
- Catalog currently pins Store `0.9.20` at Commit `11ccb0249d80758bf44c3cf9bf9d471f0aefc72c`; after this source change merges, a fresh Catalog plan must pin `0.9.21`. This source change alone is not a Catalog or storefront release.

## Rollback

Revert the source PR through a CI-checked PR. No real Desktop Profile or package was changed by this source review.
