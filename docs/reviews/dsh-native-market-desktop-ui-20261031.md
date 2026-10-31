# DSH Desktop and Web Marketplace UI restoration — 2026-10-31

## Request

Make the DSH Store entry searchable in the DSH Desktop marketplace, restore the marketplace browsing controls and visual hierarchy, and bring the Desktop marketplace closer to the existing Web manager without creating a second installation policy.

## Change

- Store `0.9.22` keeps Catalog `approved` and `blocked` entries searchable. The search covers IDs, display names, package names, descriptions, aliases, repository/Commit, categories, permission labels, dependencies, license, and the Catalog block reason.
- The Desktop panel now has separate `插件目录` and `已安装` tabs, category/status/adapter filters, sort controls, result counts, clear-filter behavior, pagination, and a compact responsive card layout.
- The installed view reads state from DSH Desktop `pluginManager.listBundles()`. Catalog-matched plugins retain the existing fixed-Commit lifecycle actions. Third-party bundles without a Catalog match are shown with sanitized status/source details and no Store mutation controls.
- Catalog `blocked` items remain viewable with their reason and disabled install/start controls. Approved entries, including entries without a Desktop adaptation declaration, continue to reach DSH Desktop's official `inspect` and install manager path. Desktop adaptation remains a label/filter, not an install gate.
- The standard DSH Web manager keeps its candidate discovery and health-check views. The Desktop surface does not fabricate those data from `listBundles`; it links users to the public discovery directory.

## Safety boundaries

- No DSH core or `@deepseek-ai/*` package changes.
- No Catalog admission or third-party package changes.
- No Loader/Fiber mutation APIs and no writes to a real DSH Profile in this source change.
- Store lifecycle actions remain bounded by the Catalog fixed Commit, the installed repository match, explicit user confirmation, and DSH Desktop's official Plugin Manager.

## Verification

- `node --check src/client.js`: passed.
- `node --test test/desktop-compat.test.mjs`: passed, 13/13 disposable Desktop cases.
- `node --test test/contracts.test.mjs test/desktop-compat.test.mjs`: passed, 32/32 cases.
- `npm run check`: passed; Registry validation reports 867 entries and the full suite passes 560/560 tests.
- `npm pack --dry-run --json`: passed; package is `dsh-safe-plugin-manager-0.9.22.tgz`.
- `node scripts/verify-dsh-upgrade-plan.mjs docs/ops/dsh-native-market-desktop-ui-20261031.json`: passed against base `74012b1f9765b043773d5f5122428a4b9ccfab6d`.
- `git diff --check`: passed.

The live DSH Desktop app still reports Store `0.9.20`. Real package installation and visual UI acceptance have not been performed; this source change does not update a real Profile.

## Release sequence

Submit the source as an auditable CI-checked PR. After merge, create a fresh Catalog plan that pins the merged full Commit and updates the first-party Catalog. Verify GitHub Raw, Pages, `dsh.store`, and `dsh-store.cn` independently. Do not claim public listing or local installation from the source PR alone.
