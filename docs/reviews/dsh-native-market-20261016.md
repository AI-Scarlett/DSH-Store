# DSH 0.2.1-alpha.4 / Store 0.9.5

Official release: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.4

Fixed official source: `86a402200d95fecef4529d969836f1fe13c6cb0d`.
Reviewed `docs/user/guide/plugin-market.zh.md`, `packages/util/plugin-market-index/src/index.ts`, and `packages/boot/app-boot/src/plugin-compatibility.ts` at that Commit.

## Resulting behavior

- Builds `marketplace/plugin-market.json` in official format 1 from the hydrated authoritative Catalog. The broader dsh.so discovery snapshot is never an installation authority.
- Only approved entries with fixed Git Commits, matching safe package/manifest directories, Git Commit publication times, and exact compatible release declarations are exposed. Approved entries without any exact compatible release are omitted. Unknown versions are never broadened by a range. No third-party package is executed.
- `publishTimestamp` records the publication time of the listed fixed Git source, using `source.updatedAt` with `github-commit` provenance; it is not the mutable default-branch timestamp or build time.
- Store 0.9.5 declares `engines.dsh`, including Alpha.4. Intake prioritizes this own field and masks conflicting exact declarations; missing engine declarations fall back to all official DSH peers. Legacy metadata remains separately recorded. Bounded range parsing fails closed on unsupported syntax.
- Official `@deepseek-ai/dsh-plugin-market-index@0.2.1-alpha.4` validates generated indexes and derives exact pinned install arguments in CI. Dependencies are installed with scripts disabled; no listed plugin code is run.
- Native Discover setup instructions are available on the home page, FAQ and README. The experimental market remains opt-in, per Profile, with DSH's own installation confirmation.
- The Pages artifact manifest covers the new index. Existing permanent production refresh validates every file, preserves recovery history, switches atomically and health-checks. The public watchdog compares three native indexes to GitHub's hydrated Catalog alongside existing four-surface checks.

## Acceptance boundaries

Local focused tests, complete check, official parser validation, and the exact-head disposable DSH CI matrix are required before merge. Real Desktop UI and a user's actual Profile are not modified or inferred from these tests. Third-party runtime safety remains unverified. The source PR leaves the existing installable Store pin unchanged until a separate fixed-source policy review pins the merged release.

## Rollback

Revert the source through a new CI-checked PR. Existing production refresh restores the prior release when health checks fail. Users can remove the index source or disable the experimental custom plugin market. No contact state or historical reservation is changed.
