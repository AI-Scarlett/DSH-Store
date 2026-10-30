# DSH 0.2.1-rc.5 and Desktop compatibility review

## Decision

Promote Store source `0.9.12` for the official DSH latest-three window after the disposable CLI smoke and exact-head CI pass. Keep the Store read-only in a Desktop Profile. Desktop plugin installation, updates, lifecycle actions, and restart remain with DSH's built-in plugin page.

## Fixed official evidence

- Official repository: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness).
- Highest supported release: [`dsh-v0.2.2-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2), published 2026-10-28T02:50:54Z.
- New npm release: [`@deepseek-ai/dsh@0.2.1-rc.5`](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.2.1-rc.5), published 2026-10-29T14:15:23Z and assigned to both the `next` and `latest` dist-tags. Its official [`dsh-v0.2.1-rc.5` GitHub Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.5) was published 2026-10-30T02:12:26Z.
- The official resolver returns the ordered latest-three window `0.2.1-rc.4`, `0.2.1-rc.5`, `0.2.2-alpha.2`. The npm `next` channel is `0.2.1-rc.5`; it is below the highest version, so there is no newer next-channel matrix target.
- All three injected UI packages are published at `0.2.1-rc.5`. `@deepseek-ai/dsh-client-runtime` remains at `0.1.1-rc.2`; no `0.2.1-rc.5` runtime package exists.
- The DSH `0.2.2-alpha.2` manifest requires Node `>=24.9.0`. The `0.2.1-rc.5` npm manifest does not declare a Node engine.
- DSH `0.2.2-alpha.2` release notes describe rich-text plugin details and third-party plugin updates, with a rollback attempt after failed hot updates.

## Source changes

- Bump the Store bundle to `0.9.12`.
- Add exact `0.2.1-rc.5` host and published UI peer declarations, without inventing a runtime package version.
- Add the new release to the exact compatibility and install/start/uninstall record; keep rollback `unknown` because no versioned downgrade transaction is performed.
- Update the official-window contract tests and register this plan in the Registry workflow.
- Preserve Desktop read-only behavior; continue to route install and lifecycle operations through the official Desktop plugin page.

## Acceptance evidence

- Official npm package metadata and GitHub Release metadata: passed. Resolver result: `0.2.1-rc.4`, `0.2.1-rc.5`, `0.2.2-alpha.2`.
- Disposable official DSH CLI on `0.2.1-rc.5`: passed install, config composition, authenticated startup/API, activation, uninstall, and exact temporary Profile restoration using Node 26.8.1. The activation probe uses a bounded 60-second timeout because it hydrates the live multi-file Catalog. The real Profile remains unchanged.
- Local `npm run check`: passed, `REGISTRY_OK entries=861`, 548/548 tests. The plan verifier is run after all postcondition hashes are sealed.
- Exact-head PR CI must pass before merge. The workflow runs all nine Linux/Windows/macOS and pnpm 10/11/12 combinations plus both previous-release disposable checks.
- Read-only inspection of the installed Desktop's failure dialog confirmed DSH 0.2.1-rc.5 rejected source `0.9.11` from the official Git URL because `engines.dsh` omitted rc.5. DSH reported restoring `package.json`, `pnpm-lock.yaml`, and `node_modules`. This proves the failure path only; full real Profile state and a `0.9.12` Desktop install remain unverified.
- Live read-only UI inspection confirmed the installed Desktop is `0.2.1-rc.5`. Its Plugins page renders, and the Add third-party plugin modal accepts an npm package name, GitHub repository URL, or local directory and displays a warning that third-party plugins run with local permissions. The modal was closed without entering a source or installing anything. This verifies the real plugin-management entry flow only; Store rendering, installation, activation, restart, hot update, and rollback remain unverified.
- Desktop `dsh-app://` read-only boundary remains covered by existing automation. Real packaged Desktop UI and in-app plugin installation are unverified; Catalog profiles remain `web` only.
- Catalog pin and production storefronts are a separate post-merge plan and are not yet verified.

## Rollback

Revert only the exact source PR through a CI-checked commit. After source merge, use a separate fixed-Commit Catalog PR; if its public health check fails, restore the prior verified storefront artifact atomically. This source change does not alter a real Profile. The failed Desktop install reported restoring its package artifacts; complete real Profile state readback remains unverified.
