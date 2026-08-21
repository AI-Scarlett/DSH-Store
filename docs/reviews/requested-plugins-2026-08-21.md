# Requested plugin review — 2026-08-21

Plan: `STORE-REQUESTED-PLUGINS-RC8-GITHUB-05`

This review is limited to fixed-source static inspection. No third-party dependency installation, build, test, plugin installation, real DSH Profile mutation, or runtime execution was performed. Catalog presence is not a security audit, and an unknown compatibility state is not treated as verified.

## `xmanrui/dsh-im`

- Decision: retain as `approved`, update to `0.14.0`, and keep `user-reviewed` update policy.
- Pinned source: `832bd539a2bca2518cbf575d9b61606f868290e4`.
- GitHub archive SHA-256: `39c857a4edb738b16569003b371162a9f060bb3abaf5e3f5d8ec6dd76c5d58ae`.
- Source evidence: MIT license, unique `xmanrui-dsh-im` Bundle patch, declared host and client runtime files, and no package lifecycle scripts at the pinned commit.
- Risk: high. The plugin can write integration state, access arbitrary IM endpoints and user credentials, and invoke declared host commands or external CLIs.
- Compatibility: rc.5, rc.6, rc.7, and rc.8 are all `unknown`; install, start, uninstall, and rollback are also `unknown` because no disposable runtime matrix was executed.
- Security evidence: manual static review only. Automated matches against the client build script and Feishu API source were adjudicated as pattern false positives; this is not an independent security audit.

## `ZSeven-W/dsh-ios`

- Decision: record as `rejected` / `blocked` in the non-installable candidate registry; do not promote to the trusted catalog.
- Pinned source: `e8d94c39d348e2c38b10d0b4ae24bfe005515c97`.
- GitHub archive SHA-256: `b538d2955c9a8ef5d6a3e07102c0c05b02582aef35151c24d20d8cd8d49089ad`.
- Blocking evidence: `package.json` declares `lib/index.js` and `lib/client.js`, but neither file exists in the pinned GitHub tree, and the package has no `prepare` lifecycle script that could produce them during installation.
- Boundary: the npm package contains built runtime files, but an npm artifact cannot substitute for the catalog's pinned GitHub source and reproducible-install contract.
- Risk if reconsidered: high. The plugin controls simulators or USB-connected iPhones and depends on Xcode, device tooling, filesystem/process access, and local device state.

## Preserved state

- `dsh-wecom-cli` remains `unlisted`.
- No DSH core files, official packages, real Profiles, or independent `dsh.store` deployment were changed.
