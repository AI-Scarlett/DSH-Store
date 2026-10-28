# DSH 0.2.2-alpha.2 and Desktop compatibility review

## Decision

Promote Store source `0.9.11` for the current official DSH latest-three window after the disposable official-CLI smoke and exact-head CI pass. Keep the manager read-only in a Desktop Profile. Desktop plugin installation and lifecycle operations remain with DSH's built-in plugin page.

## Fixed official evidence

- Official repository: `deepseek-ai/deepseek-harness`.
- Release: [`dsh-v0.2.2-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2), published 2026-10-28T02:50:54Z.
- Published npm version: `@deepseek-ai/dsh@0.2.2-alpha.2`; Node requirement `>=24.9.0`.
- Exact official latest-three window resolved on 2026-10-28: `0.2.1-rc.3`, `0.2.1-rc.4`, `0.2.2-alpha.2`.
- All three injected UI client packages used by the Store are published at `0.2.2-alpha.2`. `@deepseek-ai/dsh-client-runtime` remains at `0.1.1-rc.2`; no alpha.2 runtime package was found, so its existing verified peer range is retained.
- Alpha.2 release notes say the Desktop plugin page renders rich-text details and updates third-party packages, attempting to restore the previous version after a failed hot update.

## Source changes

- Bump the Store bundle to `0.9.11`.
- Add exact DSH and published UI peer declarations for `0.2.2-alpha.2`.
- Retain `rollback: unknown` because the disposable smoke proves install, startup, and uninstall with exact Profile restoration, but does not perform a separately versioned downgrade transaction.
- Update package contract, resolver-window, desktop-safety, and fixed-plan checks.

## Delivery credential

The connected GitHub integration cannot write to this repository (HTTP 403). The owner explicitly instructed this task to use the available `AI-Scarlett` repository access. The existing-credential authorization is limited to this exact plan ID and the exact user request `你有权限啊 直接去弄`; the verifier test rejects the same credential for another plan ID or altered authorization text. No reusable general credential bypass was added.

## Acceptance evidence

- Official release resolver and npm package metadata: passed.
- Local `npm run check`: passed; registry has 856 entries and all 545 tests pass.
- Disposable official DSH CLI on `0.2.2-alpha.2`: passed install, configuration dump, authenticated startup/API, activation, uninstall, and exact Profile restoration using Node 26.8.1; fixture only, real Profiles unchanged.
- PR CI passed on exact source commit `fe224209d87db4e96e1867ef14360789bdb4a950`: nine Linux/Windows/macOS and pnpm 10/11/12 runtime combinations plus RC.3 and RC.4 regressions passed (run [40639167852](https://github.com/AI-Scarlett/DSH-Store/actions/runs/40639167852)); Registry validation passed (run [40639167712](https://github.com/AI-Scarlett/DSH-Store/actions/runs/40639167712)) and CodeQL passed (run [40639164037](https://github.com/AI-Scarlett/DSH-Store/actions/runs/40639164037)). Final PR head checks are required before merge.
- Desktop read-only source behavior and automated `dsh-app://` boundary checks: retained from the existing `0.9.10` implementation; rerun by `npm run check`.
- Real packaged Desktop UI and in-app plugin installation: unverified. The Catalog continues to declare only the `web` profile.
- Catalog pin and production storefronts: separate follow-up after source merge.
