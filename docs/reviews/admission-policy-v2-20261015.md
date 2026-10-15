# DSH STORE admission policy v2 review

This source change addresses verified author feedback without promoting any Catalog entry, executing a third-party plugin, changing a real Profile, or contacting an author. Source, coverage, capability review and per-version compatibility remain separate decisions.

## Verified triggers

- [Dream Skin #1411](https://github.com/AI-Scarlett/DSH-Store/issues/1411#issuecomment-6176686104): its 442,975-byte client bundle exceeded the old 256 KiB per-file scanner budget. That is a Store resource limitation. A complete pinned-tree locale export pattern is not inherently invalid.
- [Web Search #1415](https://github.com/AI-Scarlett/DSH-Store/issues/1415#issuecomment-6168384347): `web` is a configuration override target while `web-search-fetch` is inserted. Regex ownership over every nested `id` is incorrect. A config layer replaces its entire config and still needs review.
- Qwen Paint #1390 / PDF Reader #1336: known filesystem, network and command capabilities require exact-source review rather than a permanent generic external-only diagnosis.
- Auto Paste #934 / Coding Delegate #1374: noncredential environment paths and synthetic secret fixtures need precise classification. Test directories are never blanket exclusions.
- CC Studio #1173 / Portable Tavern #1071: package and license changes require explicit identity migration and fresh source validation. Migration is not admission.

Official Patch composition was checked read-only against `packages/boot/app-boot/src/profile.ts` and `packages/boot/plugin-manager/src/patch.ts` in deepseek-ai/deepseek-harness. Only explicit insertion rows acquire ownership. Unsupported YAML, name-qualified operations, disable/remove operations, tags and aliases remain blocked for separate review.

## Final behavior

1. Submission, automatic admission and local source-update coverage use the same bounded fixed-source reviewer. The common budget is 512 source files, 4 MiB/file, 8 MiB total and 1,200 package tree entries. The manager previously had this budget; applying it uniformly removes the former size disparity. These are bounded review resources, not plugin functionality requirements.
2. Partial scans retain positive observations from readable files. File, count and total limits have distinct diagnostics with locations, actual values, thresholds and Store responsibility. Unobserved capabilities remain unknown. Git blob identities and byte sizes are checked when supplied.
3. Single-star export targets expand only against the complete pinned tree. Missing, unshipped, symlinked, escaping and ambiguous targets block complete coverage.
4. Structural Bundle inspection separates inserted IDs from configuration targets and ignores nested config IDs. Implementations must belong to the reviewed package. Protected IDs and official package identities remain protected.
5. Empty initial review and migration registries are introduced. A capability review binds exact Commit, full source digest, engine/policy, package contract, operations and findings. Permission declarations must match observed capabilities. Source/policy/record changes invalidate cached decisions. Critical synthetic-fixture dispositions bind file SHA256, rule and line; finding truncation cannot be overridden. Unknown dependencies, lifecycle execution, dynamic loading and incomplete coverage remain blocked.
6. Current-source rechecks apply the current verdict. A failed review of a newer upstream candidate preserves the last admitted pin; no old risk clearance is copied onto the candidate. Manual unlisting and unrelated manual blocks are preserved.
7. The official latest-three window marks recheck freshness and preserves historical exact compatibility. No exact compatible version means a visible blocked record. Package plans require an exact match for the actual local DSH version, re-read before mutation; host changes invalidate the plan. New source does not inherit prior compatibility/runtime acceptance.
8. Main-reviewed identity migrations bind prior identity, exact Commit pair and explicit new package/manifest/install/license values. Moved manifests can be resolved before reading the old path. Admission, collision and source gates rerun.
9. Public standards, details and suggested remediation explain these distinctions. No notices were sent; the central contact ledger and contact workflow are unchanged.

## Evidence and limitations

The JSON companion covers all 804 baseline Catalog entries. It is explicitly a metadata-only census, with separate live targeted source observations; categories overlap and do not constitute new source approval. The live checks show Dream Skin complete at 11 files, Qwen Paint complete at 7 and PDF Reader complete at 5, all with no budget exceedance. Qwen/PDF retain warnings. Web Search is correctly identified with one inserted ID and one config target, but source coverage remains incomplete for the recorded reasons. No target was installed or newly approved.

Regression tests cover the large bundle, locale globs, partial-budget evidence, malformed/conflicting/protected Patch operations, package identity, exact-source review invalidation, synthetic findings, migration preconditions, historical compatibility and host drift before writes. `npm run check` is required before source commit; the machine plan records the final result and exact output hashes.

Source publication uses the scoped source plan and CI-checked PR. Catalog changes must subsequently use a fresh policy workflow and be verified independently on GitHub Raw, Pages, dsh.store and dsh-store.cn. A source PR or an HTTP success is not real installation, Desktop UI acceptance or a security audit. Rollback is a new CI-checked source PR; contact reservations are never reset.


## Exact host follow-up: DSH 0.2.1-alpha.3

The source PR's Registry and CodeQL checks passed, and the 0.2.1-alpha.1 / alpha.2 disposable matrix passed. The new alpha.3 matrix failed before source execution: official CLI rejected the manager's peerDependencies, which explicitly ended at alpha.2. No risk exemption was used.

A separate local disposable candidate added only exact alpha.3 peer/range declarations. Official CLI installation, config composition, startup, anonymous 401, authenticated 200, cross-origin 403, operation journal, activation and uninstall then passed on alpha.3. The local activation request required a 30-second network budget rather than the original 10 seconds because that route loads the remote Catalog. This is local host/API acceptance, not cross-platform or Desktop UI acceptance.

The follow-up adds exact alpha.3 peer and compatibility metadata. Install/start/uninstall have disposable evidence; rollback remains unknown. The final fresh plan binds current main (`795795d6901f0a6853430f29bf850558b6882ffa`), the exact scoped precondition hashes and the prior PR head for a leased branch update. Concurrent Catalog-only PR #1425 is preserved. Both active source plans use this public ancestor so post-squash verification does not depend on a discarded draft commit. Remote CI must rerun on the follow-up before merge.
