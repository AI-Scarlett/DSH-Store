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

Inventory, market search, health inspection, permission-review choices, and operation planning do not write
the selected Profile. HTTP endpoints accept same-origin JSON `POST` requests,
limit request size, validate Profile names, and disable caches. The registry is
GitHub-only; install/update re-fetches manifests and Bundle Patches from the
pinned commit and fails closed when source evidence is unavailable.

Health permission choices are review decisions, not runtime enforcement. The
report covers catalogued and uncatalogued Profile plugins, keeps source drift,
unknown permissions, and missing per-plugin runtime probes visible, and never
turns user acceptance into a security-audit claim.

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

The health gate does not prove every plugin business function or live Fiber is
healthy unless a dedicated probe provides that evidence. Package operations
therefore report `restartRequired`; the official DSH inventory remains the
runtime authority after restart.

Host restart is a separate single-use operation requiring the exact
`RESTART DSH <profile>` confirmation. It launches only the current Node/DSH CLI
with fixed argument arrays and `shell=false`. A detached helper waits for the
old PID to exit, escalates only that exact PID if graceful termination times
out, and refuses to launch a duplicate when the loopback web port is already
restored by an external supervisor.

## Store management authentication and operation recovery

All exact manager HTTP routes delegate to the public DSH Connection requestRejection authority, including read-only inventory and progress. Missing/throwing authorities fail closed. Host/Origin and intent checks remain CSRF controls, not identity. The owned Guardian exchanges its child's official launch URL and retains the cookie only in memory. Never expose this cookie or token through diagnostics.

Version 0.8.18 introduces bounded operation journals and truthful recovery-required status. A new boot cannot replay unfinished operations. Read progress through GET; never resubmit a mutation after uncertain delivery. Windows file locks, failed rollback or corrupted journals require explicit recovery. Upgrade the bundled Guardian before a real Profile starts the authenticated runtime endpoint.
