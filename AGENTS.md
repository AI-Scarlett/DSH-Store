# Repository instructions

This repository implements a DeepSeek Harness plugin. Preserve these rules in
every change:

1. The default runtime mode is read-only.
2. Never modify the DeepSeek Harness source tree or any `@deepseek-ai/*` package.
3. Never disable or shadow the official plugin inventory.
4. Do not call Loader/Fiber mutation APIs from the read-only milestones.
5. Do not execute package-manager or shell commands from Host routes before the
   write-path milestone has been explicitly approved.
6. Tests must use disposable fixtures. They must not write to `~/.dsh` or a
   real profile.
7. A future mutation must have a typed plan, exact file scope, precondition
   hashes, backup, atomic commit, health check, and rollback.
8. Fail closed on malformed profiles, ambiguous paths, concurrent changes, or
   unknown official components.
9. Never log or return credentials, environment secrets, or full user files.
10. Keep verified, partial, blocked, and unverified states distinct in docs.

Run `npm run check` before committing. Real DSH installation and UI verification
are separate acceptance gates and must never be inferred from unit tests.

