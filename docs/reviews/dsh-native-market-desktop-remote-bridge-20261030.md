# DSH Desktop remote plugin-manager injection repair

## Finding

Read-only inspection of the installed DSH Desktop `0.2.1-rc.5` confirmed that the `DSH-Store` Settings section is present. The installed `dsh-safe-plugin-manager@0.9.14` is running, but its Settings panel reports `DESKTOP_PLUGIN_MANAGER_UNAVAILABLE`, so no Catalog entries are shown.

The Desktop plugin manager exposes `ctx.remote.pluginManager` to Client modules that declare both `remote` and `remote.pluginManager` in their module dependency list. DSH-Store's Client declared only `slots`; its later dynamic injection request therefore did not receive the service in the packaged Desktop. The failure occurs before Catalog rendering and does not indicate a Catalog parsing or compatibility error.

## Change

The `0.9.15` source declares `slots`, `remote`, and `remote.pluginManager` as Client module dependencies. Desktop compatibility tests now model the official loader rule: a service is available only when that module dependency is declared. They cover the Settings section, Catalog loading, installed state, exact DSH compatibility, and the typed full-Commit installer confirmation.

The package identity, Patch entry ID, official plugin inventory, Catalog contents, and DSH core remain untouched. The supported installation path continues to use the official Desktop plugin manager's `listBundles`, `inspect`, `installBundle`, and `waitForInstall` APIs.

## Evidence and remaining gates

- The live UI showed `DSH-Store` as a separate Settings item and reproduced `DESKTOP_PLUGIN_MANAGER_UNAVAILABLE` on `0.9.14`.
- `node --test test/desktop-compat.test.mjs` passed 8/8 cases after the dependency fix.
- The complete `npm run check` passed with `REGISTRY_OK entries=861` and 553/553 tests on this worktree.
- `npm pack --dry-run --json` resolved to `dsh-safe-plugin-manager-0.9.15.tgz` with 1,061 files and 8,431,789 bytes.
- The new machine-readable plan binds the exact source/test file scope and base hashes; its CI verifier must pass on the PR head.
- Real Desktop package update and restart were not performed. The live Desktop still runs `0.9.14`, so post-fix UI acceptance remains pending.
- Catalog changes, author notifications, and production storefront writes are out of scope for this source PR. They require their own fresh policy run and public readback.

## Recovery

Revert this exact source change through a CI-checked PR if the Desktop integration fails. The real Desktop Profile has not been modified by this plan.
