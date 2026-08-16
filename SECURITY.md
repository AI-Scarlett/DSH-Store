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

## Read-only milestone

The current implementation only reads a selected Profile manifest and installed
package manifests. Its HTTP endpoint accepts same-origin JSON `POST` requests,
limits request size, validates Profile names, and returns a narrow inventory
schema. It does not query the network or create a cache.

## Requirements before any mutation ships

Every write operation must be introduced behind an explicit management-mode
gate and implement all of the following:

1. Show the exact target Profile, files, current version, target version, and
   command plan before confirmation.
2. Reject official packages and critical DSH rows using an allowlist/denylist
   maintained from authoritative DSH data.
3. Acquire a Profile lock and verify precondition hashes immediately before
   execution.
4. Back up only the exact affected files, with owner-only permissions.
5. Stage and validate the result away from the live Profile when possible.
6. Commit with atomic rename; never overwrite concurrent user changes.
7. Run dependency, bundle-patch, boot, API, and UI health checks.
8. Roll back automatically on failure and retain an auditable local result.

Until those gates exist and pass, installation, deletion, enable/disable, and
update controls must remain absent from the UI and API.

