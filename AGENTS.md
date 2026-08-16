# Repository instructions

This repository implements a DeepSeek Harness plugin. Preserve these rules in
every change:

1. The default interaction is read-only inspection and planning. A mutation may
   run only after a fresh, single-use plan and exact per-operation confirmation.
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
   hashes, backup, atomic commit, health check, and rollback.
8. Fail closed on malformed profiles, ambiguous paths, concurrent changes, or
   unknown official components.
9. Never log or return credentials, environment secrets, or full user files.
10. Keep verified, partial, blocked, and unverified states distinct in docs.

Run `npm run check` before committing. Real DSH installation and UI verification
are separate acceptance gates and must never be inferred from unit tests.
