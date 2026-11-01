# DSH Desktop install authority handoff — 2026-11-01

## Decision

DSH STORE remains responsible for Catalog admission, immutable source checks, and compatibility advice. The native Discover index no longer turns missing or stale exact compatibility evidence into an unavailable install action. DSH Desktop owns the final compatibility check, confirmation, installation, and result shown to the user.

This uses DSH's supported Custom plugin indexes → Discover flow. The Discover tab sends the selected pinned Git spec to DSH's existing guided installation flow. DSH reads the plugin manifest, checks `engines.dsh` or the official DSH peer dependencies, presents its source confirmation, and reports the actual install result. DSH does not expose a general plugin-install IPC to third-party renderers, so STORE does not attempt to call an unsupported Desktop API.

## Store-side gates and advice

- Only `approved` entries are projected. Existing fixed-Commit, canonical GitHub source, package identity, safe path, manifest-path, and Git Commit publication-time checks remain hard failures.
- `blocked`, `unlisted`, and discovery-only candidates remain absent from the install index.
- Compatibility labels distinguish the DSH install check from a Store compatibility recheck recommendation. A recheck label does not disable the Install action.
- The index does not synthesize `engines.dsh` from Store test records. DSH reads the fixed plugin source and applies its own install-time checks for the running Desktop version.
- Store build and review code does not execute listed plugin code.

## Acceptance boundary

`npm run check` passed locally: registry validation reports 872 entries and the suite passes 562 tests. The static marketplace build passed and its native index is format 1 with all 33 approved entries, 30 Store compatibility recheck labels, and no Store-generated `engines.dsh` constraints. The official DSH parser remains a CI gate before merge.

A real packaged Desktop install, Profile mutation, restart, or runtime result is not inferred from source checks and is not part of this Store publication. Production storefronts remain unchanged until this authorized CI-checked PR merges and the publication workflow completes.

## Rollback

Revert the exact source change through a CI-checked PR. No user Profile, DSH source or packages are changed.
