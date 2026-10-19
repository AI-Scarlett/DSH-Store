# External author activity: terminal fixed-source review (2026-10-19)

Base Commit: `557bd165c864b4236eb897be3884661f242fce2b`. Review cutoff: `2026-10-18T01:05:14Z`. The five fixed Commit reviews cover every bounded runtime file and carry Git blob and SHA-256 evidence. No third-party plugin, install/build/test script, CLI, dependency code, or real DSH Profile was executed or changed.

Three decisions are admitted under manual source review; two remain rejected with complete blocker details. Catalog admission does not imply DSH STORE installation, runtime acceptance, or an independent security audit: those states remain **unknown**.

## #1464 — scclovez/dsh-tun-proxy 0.3.1

Request: [comment 6244757975](https://github.com/AI-Scarlett/DSH-Store/issues/1464#issuecomment-6244757975). Fixed Commit: [`64efd538bbbee3b00b6d303a44c40c7028469395`](https://github.com/scclovez/dsh-tun-proxy/commit/64efd538bbbee3b00b6d303a44c40c7028469395). Complete bounded scan: 65 files, 487,656 bytes; unsupported files: 0.

**Admitted.** AUTH001 is fixed: both state/action routes check strict Host/Origin/Fetch Metadata and the official request authorization before state reads, body parsing, or dispatch. Oversized bodies fail with 413. COMPAT001 is fixed with an exact 0.2.1-rc.2 declaration; other versions, rollback, other systems, and side-panel rendering remain unknown. The author supplied install/start/uninstall evidence, which Store did not reproduce.

Permission declarations remain high: file writes, any network, shell commands, and proxy credentials. yaml 2.9.1 is locked to the official npm tarball and SRI, ISC source, SHA-256 `4ef6c54cf559b8a207b7b518378230805a1c84af239b14960e8c67c7d59de5d3`, 233 archive entries, 686,297 unpacked bytes, no transitive runtime dependencies, and no install scripts. The package's standalone CLI has an explicit `--visit` dynamic import option; its complete bounded entry closure was separately reviewed. The DSH plugin imports the YAML library API and does not invoke that CLI.

## #1484 — AmethystLuna/dsh-model-everything 0.1.0

Submission and question: [comment 6245870100](https://github.com/AI-Scarlett/DSH-Store/issues/1484#issuecomment-6245870100). Fixed Commit: [`77ba449060adb6e80de554b52ec1e90845c9e780`](https://github.com/AmethystLuna/dsh-model-everything/commit/77ba449060adb6e80de554b52ec1e90845c9e780). Complete bounded scan: 108 files, 1,909,622 bytes; unsupported files: 0.

**Admitted.** The answer is option 1: retain both Patch rows. `dsh-model-everything/gate` is the package's exact `./gate` export, targets the shipped `./lib/gate.js`, and has a distinct entry ID. The Store contract now checks package identity separately from the subpath and refuses paths outside a safe explicit export. Permission declaration: file writes; no network, shell command, or credential surface. The package declares no runtime dependencies or install scripts. The author supplied published-artifact DSH evidence, not repeated by the Store; Store installability and runtime remain unknown. The fixed-Commit submission precheck now passes for this exact source: both entry IDs recognized, source verified, 108/108 files scanned, and zero static findings. No matching GitHub issue-event precheck run was found.

## #1466 — Joey-K-tsubame/dsh-skill-install 0.1.6

Request: [comment 6245946804](https://github.com/AI-Scarlett/DSH-Store/issues/1466#issuecomment-6245946804). Fixed Commit: [`c03b72d85a391d1f510df0e61d12836649a10abc`](https://github.com/Joey-K-tsubame/dsh-skill-install/commit/c03b72d85a391d1f510df0e61d12836649a10abc). Complete bounded scan: 7 files, 171,044 bytes; unsupported files: 0.

**Rejected: PATH002.** PATH001 and COMPAT001 are fixed. In `index.js:482-483`, the total expanded-byte limit is counted by `sanitizeTree`; `index.js:552` starts `tar -xzf` and `index.js:557` calls that check only after extraction. A compressed archive can consume disk before the limit is enforced.

Minimum change: check each archive member and the aggregate expanded-byte budget before writing it, or use a bounded extractor that aborts before crossing either cap. Acceptance: an over-budget compressed fixture is rejected before writes exceed the cap, staging is cleaned, the install target remains untouched, and valid archives still pass existing path/type checks. Catalog remains blocked.

## #1467 — Joey-K-tsubame/dsh-delete-archived 0.1.2

Request: [comment 6245952852](https://github.com/AI-Scarlett/DSH-Store/issues/1467#issuecomment-6245952852). Fixed Commit: [`437d935129368b7cdde68a862c6b47cb4e6c895d`](https://github.com/Joey-K-tsubame/dsh-delete-archived/commit/437d935129368b7cdde68a862c6b47cb4e6c895d). Complete bounded scan: 6 files, 26,152 bytes; unsupported files: 0.

**Rejected: DELETE002.** DELETE001 and COMPAT001 are fixed. In `lib/entry.js:116-120`, `readJournal` accepts any parsed object. At `lib/entry.js:283-292`, the journal's presence skips the archived-session check without validating schema or matching `sessionId`. A mismatched or arbitrary object at the expected path can therefore act as authorization for an unarchived session.

Minimum change: validate the exact journal schema and require its session ID to equal the requested session before resuming. Reject malformed, unexpected, or mismatched journals without bypassing the archived gate. Acceptance: disposable fixtures cover valid same-session recovery, mismatched session, arbitrary object, malformed JSON, and invalid timestamp; only the valid journal resumes and invalid cases leave persistence/registry untouched. Catalog remains blocked.

## #934 — sakuraqqq/dsh-auto-paste 0.3.1

Request: [comment 6247399388](https://github.com/AI-Scarlett/DSH-Store/issues/934#issuecomment-6247399388). Fixed Commit: [`83bebac32199ca5c015ad10bb475ce5baf7d4455`](https://github.com/sakuraqqq/dsh-auto-paste/commit/83bebac32199ca5c015ad10bb475ce5baf7d4455). Complete bounded scan: 8 files, 729,059 bytes; unsupported files: 0.

**Admitted.** SUPPLY001 is fixed: the manifest has no runtime `dependencies` field; zod 4.4.3 is inlined into `dist/typert.host.js`, and the fixed notice, package integrity, upstream Commit and distributed-file SHA are consistent. COMPAT001 is fixed for 0.2.1-alpha.5 and 0.2.1-rc.1; 0.2.1-rc.2 remains unknown. File writes are declared; network, shell commands, and credentials are not observed. Author runtime evidence is retained as author evidence, while Store installation/runtime remain unknown.

## Contact and publication gates

The central ledger identifies four authors with prior contact history. The exact re-review requests for #1464 and #934 qualify for one continuation reply each; Joey's #1466 and #1467 requests are bound together in one response. The #1484 submission alone does not restore a contact slot, but comment 6245870100 separately asks which Patch shape the Catalog prefers. After verifying immutable user ID 49059886 and that no stop is active, this exact question qualifies for one request-specific continuation reply. It does not grant future contact.

Four hash-bound request plans and one reviewed batch are prepared. They are not permission to retry: each request must still match its exact GitHub ID, body hash, update time, identity and no-withdrawal state at send time. GitHub Actions reserves the existing author's slot through the central Contents API SHA compare-and-swap before posting. A failed or uncertain send consumes the reservation and is never retried. All Issues remain open.

The scheduled automation refresh was checked, but it had not issued terminal admission conclusions or maintainer replies for these activities. Actual notification links and public readback are recorded from the completed workflow/production checks, not inferred from this review file.
