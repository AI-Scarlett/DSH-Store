# Catalog bridge capacity fix review

## Decision

Keep the legacy bridge below its existing 2 MiB response limit by omitting a per-release declaration only when the legacy fallback derives the same effective compatibility status. The full v2 detail continues to carry every declaration.

The fixed-directory stress fixture contains 861 entries. It measured 2,241,152 bytes before compaction and 1,942,872 bytes after compaction. This leaves 154,280 bytes below the existing 2 MiB limit without changing that limit or dropping Catalog entries.

## Compatibility review

- A declared `compatible` result remains explicit in the legacy bridge.
- An `unknown` declaration remains when the range would otherwise yield `incompatible`.
- A declaration can be omitted when the old client fallback returns the same `unknown` or `incompatible` status.
- The full v2 details retain the original `dshReleases` map, including declarations compacted out of the legacy bridge.
- The stress fixture checks effective status equivalence for each declared release and runs the result through the historical Catalog validators.

## Scope and alternatives

The change is limited to `src/catalog.mjs`, Catalog and package-version contract tests, package version metadata, README release-state wording, and this plan/review record. The self-pinning contract allows the current public `0.9.12` Catalog pin while package `0.9.14` awaits its separate Catalog policy update. It does not raise the response ceiling, truncate descriptions, remove plugin entries, alter compatibility ranges, or touch DSH source, `@deepseek-ai/*`, a real Profile, or author-contact state.

Raising the 2 MiB ceiling would leave older clients with an oversized response and was rejected. Dropping declarations without comparing effective status could change user-visible compatibility and was rejected. Compressing only redundant declarations preserves the existing fallback contract while retaining the complete v2 evidence.

## Verification and rollout

Passed on this exact working tree: `npm run check` (`REGISTRY_OK entries=861`, 553/553 tests), `npm pack --dry-run` (`dsh-safe-plugin-manager@0.9.14`, 1,061 files), and `git diff --check`. The source change still requires an exact-head CI-checked PR. After merge, Catalog publication remains a separate fresh policy run bound to the then-current `main` Commit and Registry hashes; verify GitHub Raw, Pages, `dsh.store`, and `dsh-store.cn` independently. The policy workflow also invokes the author-notification workflow, so no Catalog run is dispatched in this source change.

Rollback by reverting only the exact source PR through a CI-checked change. Catalog and production surfaces are not modified by this source PR. Real Desktop UI acceptance and installation of the new Store version remain separate gates.
