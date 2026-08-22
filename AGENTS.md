# Repository instructions

This repository implements a DeepSeek Harness plugin. Preserve these rules in
every change:

1. The default interaction is read-only inspection and planning. Repository and
   Catalog automation may mutate only through the dedicated policy workflow: it
   must create a fresh machine-readable plan, bind the current base Commit and
   file hashes, pass every deterministic gate, use a short-lived GitHub token,
   and commit through an auditable pull request. It does not require a human
   confirmation for each scheduled run. Real DSH Profile/package/restart
   mutations remain separately planned and explicitly confirmed.
2. Never modify the DeepSeek Harness source tree or any `@deepseek-ai/*` package.
3. Never disable or shadow the official plugin inventory.
4. Never call Loader/Fiber mutation APIs; enable/disable uses only the manager's
   delimited Profile Patch block.
5. The write-path milestone was explicitly approved on 2026-08-16. Package
   changes must still use the official DSH CLI with fixed argument arrays and
   no shell strings.
6. Tests must use disposable fixtures. They must not write to `~/.dsh` or a
   real profile.
7. Every mutation must have a typed plan, exact file scope, precondition
   hashes, backup or recoverable Git history, atomic commit, health check, and
   rollback. For scheduled Catalog and storefront operations, the deterministic
   policy verdict is the authorization record; unknown or ambiguous evidence
   must fail closed instead of waiting for a rubber-stamp approval.
8. Fail closed on malformed profiles, ambiguous paths, concurrent changes, or
   unknown official components.
9. Never log or return credentials, environment secrets, or full user files.
10. Keep verified, partial, blocked, and unverified states distinct in docs.
11. Automated Catalog admission may approve only a canonical public GitHub
    repository pinned to a full Commit whose complete bounded runtime surface,
    manifest, license, Bundle Patch, entry IDs, lifecycle scripts, dependencies,
    and permission signals satisfy the automation policy. Everything else is
    rejected, quarantined, or listed as blocked and is never made installable.
12. Automation must never execute third-party install, prepare, build, test, or
    runtime code. It may read bounded GitHub metadata and fixed-Commit source.
    It must update through CI-checked PRs and verify GitHub, Pages, and both
    production storefronts every three hours, retrying recoverable failures.

Run `npm run check` before committing. Real DSH installation and UI verification
are separate acceptance gates and must never be inferred from unit tests.
