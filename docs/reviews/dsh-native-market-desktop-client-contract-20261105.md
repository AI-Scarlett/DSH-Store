# DSH 0.2.2-rc.1 Desktop client contract review

## Decision

Correct the Store's declared client dependency for the official DSH `0.2.2-rc.1` release window. The bundle declared `@deepseek-ai/dsh-client-runtime`, a package that stopped publishing at `0.1.1-rc.2` and that exists in neither the CLI/Web runtime nor the Desktop application bundle. The package that actually provides the injected `remote` service and mounts the `pluginManager` Remote namespace is `@deepseek-ai/dsh-api-remotes`, which the bundle did not declare. Replace one with the other and keep every other declaration, permission, and boundary unchanged.

This is a contract-accuracy correction, not a crash fix. A disposable official-CLI run proved the stale declaration was tolerated: the browser module loader skips a declared package it cannot resolve, so the Store still loaded with the old manifest. The defect was that the declared dependency set named a package that provides nothing and omitted the one that provides the injected services.

## Fixed official evidence

- Official release window, resolved live from the official resolver: `0.2.2-alpha.2`, `0.2.2-alpha.3`, `0.2.2-rc.1`. The npm `next` channel is `0.2.2-rc.1`; the `latest` channel is `0.2.1-rc.5`.
- Official `@deepseek-ai/dsh@0.2.2-rc.1` dependency tree: `@deepseek-ai/dsh-api-remotes` ships `lib/client.js`; `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-ui-primitives` and `@deepseek-ai/dsh-client-ui-slots` are not part of the tree.
- Official DSH Desktop `0.2.2-rc.1` application bundle (`/dsh/node_modules`): the same set. `dsh-api-remotes`, `dsh-client-ui-settings`, `dsh-client-ui-layout` and `dsh-client-ui-sidebar` ship a client bundle; `dsh-client-runtime`, `dsh-client-ui-primitives` and `dsh-client-ui-slots` are absent.
- Official `@deepseek-ai/dsh-client-ui-plugin-manager@0.2.2-rc.1`, the reference client that uses the official plugin manager, declares `@deepseek-ai/dsh-api-remotes` in `dsh.client.inject` and injects the services `slots`, `remote` and `remote.pluginManager`.
- Official `@deepseek-ai/dsh-api-remotes@0.2.2-rc.1` `lib/client.js` declares `const inject = ["remote"]` and mounts the `pluginManager` Remote namespace.
- Official `@deepseek-ai/dsh-plugin-manager@0.2.2-rc.1` `lib/typert.remote-client.d.ts` publishes `pluginManager/listBundles`, `pluginManager/inspect`, `pluginManager/installBundle`, `pluginManager/waitForInstall`, `pluginManager/removeBundle`, `pluginManager/setBundleEnabled` and the remaining official methods. Every method the Store already calls exists unchanged.
- Official slot contracts in `0.2.2-rc.1`: `settings.section` (`dsh-client-ui-settings`), `sidebar.panellist` (`dsh-client-ui-sidebar`) and `main` (`dsh-client-ui-layout`) are all still declared, so the Store's three registrations remain valid.
- Official npm publication sets: `@deepseek-ai/dsh-api-remotes` publishes the same version set as the five injected UI packages, including every version in the live latest-three window. `@deepseek-ai/dsh-client-runtime` publishes nothing after `0.1.1-rc.2`.
- Official web frontend seed table (`dsh-web-frontend/dist/assets/index-*.js`): `react`, `react-dom`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives` and `@deepseek-ai/dsh-client-ui-dockkit` are platform seed modules. The CLI/Web tree and the Desktop application ship the identical frontend build, so both hosts resolve the same seed modules.

## Source changes

- Branch from the current `origin/main` (`0fb65296 Publish DSH Store 0.9.41 Catalog pin (#1768)`), which already released `0.9.41`; this change is therefore `0.9.42`, not a reuse of the released version.
- Bump the Store bundle to `0.9.42`.
- Replace `@deepseek-ai/dsh-client-runtime` with `@deepseek-ai/dsh-api-remotes` in `dsh.client.inject`, keeping the declaration order and every other entry.
- Replace the `dsh-client-runtime` peer with an `@deepseek-ai/dsh-api-remotes` peer that names exactly published versions and covers the live latest-three window.
- Record the official package publication sets, the host runtime inventory, the platform seed modules and the service-to-provider mapping in `test/fixtures/official-client-packages.json`.
- Add `test/client-host-contract.test.mjs`, which fails closed when a declared client dependency is neither an official host package nor a platform seed module, when a dropped package is still declared, when an injected service has no declared provider, when a peer range names an unpublished version, or when a hard client requirement is not a seed module.
- Update the existing peer and upgrade-matrix contract tests, which encoded the dropped runtime package as the remote provider.

## Acceptance evidence

- Official package, GitHub Release and Desktop application inventory: passed. The facts above were read from the published `@deepseek-ai/dsh@0.2.2-rc.1` tree and from the installed DSH Desktop `0.2.2-rc.1` application bundle.
- Disposable official DSH CLI on `0.2.2-rc.1`: the Store installs, composes its Profile, starts, answers the authenticated runtime, inventory and activation APIs, refuses an unauthenticated request with `401` and a cross-origin request with `403`, then uninstalls and restores the exact pre-install Profile composition. The real Profile remains unchanged.
- Disposable Host composition readback: the composed client boot graph contains `@deepseek-ai/dsh-api-remotes` and the three injected UI packages the Store registers slots through, and does not contain `@deepseek-ai/dsh-client-runtime` in either the old or the new manifest.
- Local `npm run check`: passed.
- Real DSH Desktop UI acceptance: unverified. This review proves the Desktop contract from official sources and a disposable Host composition; it does not prove that a packaged Desktop Profile loaded the Store panel.
- Catalog pin and production storefronts: unchanged. The Catalog pins `0.9.41`; a new pin is a separate plan.

## Rollback

Revert only the exact source PR through a CI-checked commit. This change alters no Profile, no Catalog entry and no public surface, so reverting the source PR restores the previous declaration set. The prior `dsh-client-runtime` declaration was tolerated by the loader and is therefore a safe rollback target.
