# DSH 0.2.1-rc.4, Desktop boundary, plugin discovery, and author replies

## Official DSH window

The official release resolver was run on 2026-10-27. It returned the newest three published DSH packages as `0.2.1-rc.2`, `0.2.1-rc.3`, and `0.2.1-rc.4`; `0.2.1-rc.4` is the current npm `latest` and there is no newer `next` version. GitHub Releases currently has notes through RC.3; no RC.4 release entry or Desktop-specific RC.4 notes were found.

npm publishes `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-settings`, and `@deepseek-ai/dsh-client-ui-slots` at RC.4. npm does not publish `@deepseek-ai/dsh-client-runtime` at RC.4; its newest published version is `0.1.1-rc.2`. The Store therefore adds exact RC.4 support to the DSH host and the three published UI peers, while keeping the runtime peer range on versions that exist.

## Disposable official CLI evidence

The official `@deepseek-ai/dsh@0.2.1-rc.4` package was installed with lifecycle scripts disabled in a disposable directory. The Store's existing disposable harness then used fixed CLI argument arrays and a temporary `DSH_HOME`/`DSH_AGENTS_HOME` to verify:

- install and `--dump-config` composition passed;
- clean Web host startup passed;
- unauthenticated API returned `401`, authenticated API returned `200`, and cross-origin access returned `403`;
- inventory, operation journal, and activation requests passed;
- uninstall restored the exact baseline Profile composition;
- the CLI identified itself as `0.2.1-rc.4`; the real user Profile was unchanged.

This test does not establish rollback acceptance. `dshOperations["0.2.1-rc.4"].rollback` remains `unknown`.

Repository verification also passed: `node scripts/verify-dsh-upgrade-plan.mjs docs/ops/dsh-native-market-rc4-desktop-20261027.json`, `npm run check` (`545/545` tests), and `npm run build:marketplace` (`STATIC_MARKETPLACE_OK entries=851`). The static build reads the current public Catalog pin as Store `0.9.8`; it does not publish or update that Catalog.

## Desktop boundary

The latest available official Desktop release notes are for RC.3. They add plugin browse/create “More” menus to the left sidebar, conversation view, and right sidebar. The Store keeps Desktop mode read-only and hands install, update, enable/disable, and restart actions to the official Desktop plugin page and app update flow. Its `dsh-app://` route does not call Web Host APIs.

The current computer inventory has no DSH Desktop app available for interaction. Source checks and the Web CLI run therefore do not prove packaged Desktop navigation or installation; Desktop UI acceptance remains `unverified`.

## Full plugin discovery-index scan

The read-only `dsh.so` plugin-index snapshot was generated at `2026-10-26T00:14:18.434Z` and re-read on 2026-10-27. Its SHA-256 is `07959cdd35ead9aa415a603bb6734b2fd432eec479e686935fb64193de22ce34`. It contains 25,527 index rows and 4,630 unique DSH plugin GitHub repositories: 4,197 fixed-GitHub source URLs and 433 other package specifications. No record supplied `verification.installTest`.

Cross-reference against `main` at scan baseline `c18c8486b96edb8d48f9e840a1298de90461d929` found:

- Catalog: 851 entries (`33 approved`, `722 blocked`, `96 unlisted`); 45 index matches (`37 blocked`, `8 unlisted`, `0 approved`).
- Candidate registry: 719 entries (`528 reviewing`, `191 rejected`); 54 index matches (`19 reviewing`, `35 rejected`).
- Eight repositories occur in both registries; 4,539 index repositories occur in neither.

After this scan snapshot, `main` advanced through automated Catalog PR #1595 to `2353385eb9b0b70ea1a0c157358c4d1186838cf0`. The current Catalog has 852 entries (`33 approved`, `723 blocked`, `96 unlisted`), and the candidate registry has 723 entries (`532 reviewing`, `191 rejected`). The newly added Catalog detail is `dsh-fatfish-level`. The scan-time index cross-reference figures above remain bound to their stated base; the raw 25,527-row scan snapshot is not bundled in this repository, so I have not recomputed its repository intersections against the newer registries.

The index is a discovery source, not a fixed-Commit source review. The 4,539 unmatched repositories have not thereby passed manifest, license, Bundle Patch, permissions, dependency, or lifecycle review. No new Catalog entry was admitted from the index alone, and no third-party install, prepare, build, test, or runtime code was executed.

The separate `skunpoj/dsh_setup` submission at `plugins/compaction-provenance-guard`, fixed to `963e63acddf4ba0ed2f95f2d44c938dc2e6528b1`, passed the bounded 5/5-file static scan without security warnings. GitHub repository license metadata is still `NOASSERTION`, and exact RC.4 compatibility remains unverified; it is not approved or added to the Catalog.

## GitHub author replies

GitHub issue and PR discussions were read through the latest results updated on 2026-10-26. Four author threads contain messages without a later Store response:

- [#1321 zgat/dsh-wechat](https://github.com/AI-Scarlett/DSH-Store/issues/1321): on Oct. 26 the author reported that periodic source updates change the pinned version/Commit without recalculating the old admission binding and status reason. The requested Commit `0776189bc200ddda2129a611ba6aeade44be380a` differs from the current Catalog pin `8213a830351753f128926b535693355b2f77763e` (`0.3.7`). The current reason still lists `commands` and `nativeOrExecutableArtifacts`; the later bounded scan of the current pin reported 27/27 files, no critical findings or warnings, and `files`/`network`/`credentials` capability signals. Exact RC.3 and RC.4 compatibility remain `unknown`. The report is unresolved; the two existing ledger reservations for user ID `23634926` include the already-used request-specific reply, so no further message was sent.
- [#1155 taxueseek/dsh-files](https://github.com/AI-Scarlett/DSH-Store/issues/1155): on Oct. 26 the author described the `0.6.3` changes and explicitly requested a fixed-Commit supply-chain/permissions review and a final `user-reviewed` admission result. No Store response follows. The ledger shows only the existing first-contact reservation; no reply was sent.
- [#1584 mllun/dsh-memory-layers](https://github.com/AI-Scarlett/DSH-Store/issues/1584): on Oct. 26 the author reported fixes at `243c2fc` (`v1.2.1`), including disclosed file writes and removal of network, command, and credential signals. No Store conclusion follows the update. This remains a recheck item, not an admission.
- [#1582 Sieuno/dsh-native-collab](https://github.com/AI-Scarlett/DSH-Store/issues/1582): on Oct. 26 the author asked whether a user-confirmed replacement of native collaboration components falls within the marketplace policy and requested an answer before preparing compatibility evidence. No Store response follows. The ledger shows a first-contact reservation; no reply was sent.

Eight earlier requests also still lack a Store conclusion:

- [#1565 skunpoj/dsh_setup](https://github.com/AI-Scarlett/DSH-Store/issues/1565): the author asks the Store to review the plugin subdirectory at its fixed Commit rather than treating the repository root as the package. The package-local source scan was 5/5 without warnings, but GitHub license metadata is `NOASSERTION`; the ledger has an existing first-contact reservation.
- [#535, #546, #547, #562, and #563](https://github.com/AI-Scarlett/DSH-Store/issues/535): the same author (GitHub user ID `90887123`) posted new fixed-Commit recheck requests across five repositories on Oct. 25. #535 remains closed despite the later comment; the other four are open. The imported contact history is shared across these projects. No contact or review outcome was added here.
- [#1463 star-Cosmo/dsh-model-tidy](https://github.com/AI-Scarlett/DSH-Store/issues/1463): the author requests review of the fixed source for `v1.2.2`; the issue remains open and the ledger has a first-contact reservation.
- [#697 hyqhyq3/dsh-mcp-manager](https://github.com/AI-Scarlett/DSH-Store/issues/697): the author requests a fixed-source conclusion and concrete remaining issues; the current Catalog still marks the 0.2.1 release compatibility unknown. The issue remains open and the ledger has a first-contact reservation.

Other recent comments do not need a manual response: #734 explicitly says to wait for automatic recheck; #757 is closed as requested; #358 has a bot confirmation of current marketplace removal and its contact-stop state remains active.

[#1585 LumiDesk/dsh-wallet-pill](https://github.com/AI-Scarlett/DSH-Store/issues/1585) is a new submission thread, not an author reply to a repair notice. The author reports that the current-branch precheck passed 8/8 files; that precheck alone is not an admission decision.

The four latest automated Catalog PR discussions (#1592, #1589, #1586, and #1583) contain no comments. The complete imported contact history and current `author-contact-state/contacts.json` were read. No Issue/PR message was created, the contact ledger was not changed, and no author thread was closed.

## Result boundaries

This change prepares Store source version `0.9.10`; the public Catalog still pins Store `0.9.8` at `8150c5ff43ca11b89aac4151c0f78e2c34777fb6`. Catalog admission, production storefront publication, real Profile state, and packaged Desktop UI state are unchanged. RC.4 disposable Web CLI acceptance passed; Desktop UI and rollback acceptance remain unverified.
