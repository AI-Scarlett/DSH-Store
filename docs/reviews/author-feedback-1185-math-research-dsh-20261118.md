# Issue #1185 — fixed-source admission review

- Request: [#1185 comment 6736970862](https://github.com/AI-Scarlett/DSH-Store/issues/1185#issuecomment-6736970862), GitHub user ID 175226580.
- Fixed source: [math-research-dsh 2.0.5, bd08ad3f71e394bd5aa4f38c4d9cf3ddc89459b2](https://github.com/xsoc1/math-research-dsh/commit/bd08ad3f71e394bd5aa4f38c4d9cf3ddc89459b2).
- Store policy: `bounded-source-v3`; exact admission binding `5d054ed571df64cb967d17c4b4fee4ea8e0863e07c337bd1dfe0a1c3782e8df2`; source digest `02fa2ab567c6d06801c992ab51673eb575f1e2853712e4e1bbf0514626b18dd8`; policy digest `3578986fe56466165ea24abf5ec522dc5a97086296653349ddcb9e20b8dd89f3`.

## Decision

Admit this fixed source through the guarded `user-reviewed` path. The decision covers its disclosed elevated capabilities and is tied only to this full Commit. The Bundle has one additive entry, `math-research-dsh`, and its load entry only registers four packaged skill documents. It does not change DSH core, use protected components, run install hooks, or load modules dynamically.

This is not a claim that Store has independently installed the package or completed a runtime or security audit. The author reported disposable Profile checks for older releases; those remain author evidence. The fixed Commit declares exact compatibility for `0.1.7-rc.2`, `0.2.0-rc.1`, `0.2.0-rc.2`, and `0.2.1-alpha.1`. Current official latest releases `0.2.2-rc.2`, `0.2.2-rc.3`, and `0.2.2-rc.4` remain `unknown`, so this review does not establish compatibility with them.

## Fixed-source evidence

The official analyzer re-read the fixed manifest, repository metadata, recursive Git tree, and package files. It covered 70/70 bounded code/text files in the 150-file distributable surface: scan complete, zero unsupported files, zero budget findings, zero heuristic security findings, and no observed credentials, protected DSH mutation, dynamic loading, native/executable artifact, or runtime dependency. Both GitHub and manifest license metadata are MIT; install lifecycle scripts are absent.

The root entry reads and registers the four packaged `SKILL.md` files. The manifest and Patch add only the package-owned ID. Resource notes bind the newly covered Lean, CSV, TeX, checksum-manifest, placeholder, and Mermaid files to the package and their call sites. Templates/data are not executed at Bundle load.

## Permission decision

| Capability | Reviewed scope | Catalog classification |
|---|---|---|
| Files | Reads/writes the project selected for research or verification; Blueprint path handling is root-confined. | `write` |
| Network | Optional Git sync can push to user-configured remotes; selected Lean/Lake environments can obtain their own dependencies. | `any` |
| Commands | Explicit workflows can invoke Git, Lean/Lake, Python helpers, and code imported by a selected research project. There is no sandbox claim. | `shell` |
| Credentials | The Bundle does not collect/store credentials; user-invoked Git or external tools may use existing local credentials. | `none` collected by the Bundle |

The requested `user-reviewed` decision is appropriate only with these capabilities visible to the user at install/update time. No third-party package code was executed during this review.

## Acceptance boundaries

- Catalog admission is updated by the dedicated automation after this reviewed registry record reaches main.
- Store installability, desktop UI acceptance, real Profile acceptance, Lean/Lake workflow behavior, and independent security review remain unverified by Store.
- Do not infer support for DSH 0.2.2-rc.2 through rc.4 from a range or from author-run older Profile checks.
