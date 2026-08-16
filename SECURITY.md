# Security model

## Permanent invariants

- No writes to the DeepSeek Harness source tree or global installation.
- No replacement, update, disable, or duplicate installation of
  `@deepseek-ai/*` packages.
- No monkey patching of official modules and no direct Loader/Fiber mutation.
- No arbitrary shell strings, background auto-update, or install-on-start.
- No whole-file rewrite of a user's `cordis.patch.yml`.
- No secret, credential, environment dump, or absolute user-file content in
  HTTP responses or logs.

## Read-only surfaces

Inventory, market search, health inspection, and operation planning do not write
the selected Profile. HTTP endpoints accept same-origin JSON `POST` requests,
limit request size, validate Profile names, and disable caches. The registry is
GitHub-only; install/update re-fetches manifests and Bundle Patches from the
pinned commit and fails closed when source evidence is unavailable.

## Guarded mutations

Every write operation implements all of the following:

1. Show the exact target Profile, files, current version, target version, and
   command plan before confirmation.
2. Reject official packages and critical DSH rows using an allowlist/denylist
   maintained from authoritative DSH data.
3. Acquire a Profile lock and verify precondition hashes immediately before
   execution.
4. Back up only the exact affected files, with owner-only permissions.
5. Invoke only the current DSH CLI with fixed argument arrays and `shell=false`.
6. Restrict enable/disable edits to the delimited manager-owned Patch block.
7. Commit manager Patch changes with atomic rename; never overwrite concurrent changes.
8. Run dependency and DSH configuration-composition health checks.
9. Restore exact Profile files and reconcile dependencies offline on failure.
10. Retain a secret-free JSONL audit result in the manager's own data directory.

The current health gate does not prove every plugin business function or live
Fiber is healthy. Package operations therefore report `restartRequired`; the
official DSH inventory remains the runtime authority after restart.
