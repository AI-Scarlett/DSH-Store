# DSH 0.1.3-alpha.1 compatibility audit — 2026-09-07

Status: source candidates prepared; public release and Catalog changes pending.

Official target: `deepseek-ai/deepseek-harness` tag `dsh-v0.1.3-alpha.1`, Commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`. The official GitHub release is ahead of npm (`0.1.2-rc.1`). The current three-version window is `0.1.2-alpha.5`, `0.1.2-rc.1`, `0.1.3-alpha.1`.

Validation used the built official source CLI, Node 26.8.1 on macOS arm64, a disposable DSH_HOME and synthetic project. The plugin was added with fixed argument arrays, included in `--dump-config`, loaded in a cold Web host, and removed with the official CLI. The final composed configuration contains none of the seven test plugin entries. Synthetic session files were retained. No real Profile was installed or restarted.

These checks establish source compatibility, isolated configuration composition and host startup. Browser interaction, Windows/Linux host runtime, real account/model calls, real Profile acceptance, source publication, Registry merge and public storefront readback are separate and unverified here. Removal is not a tested version rollback; rollback remains unknown. Historical compatibility keys describe earlier evidence, not a rerun of every old release with this candidate.

## Fixes

- Store host checks, catalog automation and the public storefront share one browser-compatible release authority. GitHub-only releases advance the exact compatibility window; unavailable npm artifacts do not produce an npm upgrade command. Drafts, foreign release URLs, unsupported future series, deprecated npm versions, oversized responses and incomplete authority fail closed. Optional GitHub tokens are sent only to GitHub.
- Catalog admission still requires an exact compatible result in at least one of the latest three releases. Lifecycle evidence remains separate. No third-party entry was approved or removed by this source repair. A read-only preview would hold dsh-wsl-workspace for missing compatibility in the new window; this was not applied.
- Registry CI now runs the complete repository check on runtime, storefront, test and automation changes. Earlier failed duplicate workflow runs with no jobs have no confirmed root cause and are not claimed fixed.
- Chat Import closes all handles, flushes writes, respects busy ownership, synthesizes format 2 imports without an unpublished migration dependency, checks project identity before body reads and omits reasoning from shared text. Official migration is used only as an optional differential test oracle.
- Token Monitor reads v2 embedded stream usage and failed attempts, keeps retry cost, attributes failover to the settled model and rebuilds its projection cache at stateVersion 2.
- CLIAPI carries its MIT license in its independently packed plugin directory.
- Build DSH Plugin uses the same dual-source release rules, adds current host guidance and verifies every distributed ZIP file against source, so matching file counts can no longer hide stale content.

## Candidate versions and automated checks

| Plugin | Candidate | Tests | Command |
| --- | --- | ---: | --- |
| DSH Store | 0.8.15 | 237 | npm run check |
| Chat Import | 0.4.2 | 427 | npm test; npm run check:linux; eslint; README sync; npm ci lock check |
| Token Monitor | 1.3.2 | 13 | npm run check |
| Settings Hub | 0.3.4 | 14 | npm run check |
| CLIAPI | 0.5.3 | 41 | npm test (plugin directory) |
| Build DSH Plugin | 0.4.3 | 18 | npm run check plus brief, marketplace, candidate and distribution checks |
| Agent Reach adapter | 0.1.2 | 3 | npm run check |

The total is 753 Node test cases, plus the three Skill script suites and distribution verification. Chat Import lint, Linux path discipline, bilingual README structure and npm lock installation checks also passed. The official format differential checks ran with the local official source available; standard installations can skip that oracle, while the dependency-free synthesis test always runs.

## Isolated business-path checks

The Store runtime route returned the exact web Profile and a fresh Boot ID after restart. Chat Import completed import, duplicate detection, incremental append, restart/reimport, and tool-call/result import. Three persisted zstd sessions were decoded with the zstd CLI (all concatenated frames), each had format 2, contiguous sequences and valid tool references. No model request was made. Browser control was unavailable, so no screenshots or visual acceptance are claimed.

## Release sequence

Review and merge each source candidate first. Then generate fresh Catalog proposals from immutable remote commits, preserving the bridge/index/details split and unknown rollback/browser evidence. Catalog contribution requires its own current-base/hash-bound plan. Verify GitHub Raw, Pages, dsh.store and dsh-store.cn independently after deployment. Real Profile upgrades need a separate installation plan.
