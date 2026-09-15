# DSH Store lifecycle upgrade evidence

Authorized scope: DSH Store upgrade based on dsh-market and build-dsh-plugin 0.5.0; standard additive DSH Bundle, R3 lifecycle manager. Source implementation and source publication are authorized. Real Profile/package/restart has not been performed.

Source authority: dsh-market 92b4caf614e07f54b47f40ec36cd6a5cf683e42d (MIT), Store base and exact file hashes in the machine-readable plan. No third-party source was executed or copied into the manager.

Public seams inspected: DSH dsh-v0.1.5-rc.2 packages/client/connection/src/rpc-host.ts requestRejection; host/webserver exact route precedence; vendor/loader EntryTree.entries read-only enumeration; tool-cordis FiberState mapping ACTIVE=2 FAILED=3. No Loader/Fiber mutation.

Changes: official Connection authentication for every Store HTTP route; Guardian-owned launch token exchange (302/303) with memory-only cookies; truthful failed/rolled-back/recovery-required results; bounded durable operations and GET polling; source-bound activation; controlled pnpm error diagnostics; candidate-only fixed-Commit external feed; locally stored notes/favorites and hash-verified fixed-source raster previews. Existing permissions/change previews and central author-contact ledger remain authoritative.

Authentication is unavailable until Connection loads. Unsupported Connection contracts fail closed. Existing Guardians must be upgraded using the bundled daemon before restarting into this manager, otherwise their anonymous runtime probes will be denied. A real Profile migration must include this sequencing in its separately confirmed plan.

## Evidence

- E2: npm run check: 308 tests passed on the local macOS checkout before publication.
- E3 DSH 0.1.5-rc.1 and 0.1.5-rc.2: official CLI file-source install of both own bundles, dump-config, boot, Store unauthenticated 401/authenticated 200, forged Origin 403, inventory, operation GET, activation route, Store uninstall and subsequent dump-config passed in disposable DSH_HOME. build adapter present in dump-config; interactive Skill use remains unverified.
- 0.1.6-alpha.1: npm bootstrap failed ETARGET for @deepseek-ai/dsh-client-ui-sidebar-documentpreview@^0.1.6-alpha.1. No corresponding GitHub Release. Compatibility remains unknown.
- Windows/Linux/macOS × pnpm 10/11/12: 9/9 passed in GitHub Actions run 34929045500. The Windows pnpm 10 cross-drive file-source fixture returned ENOENT; keeping source and disposable home on the same drive resolved it. This does not establish support for cross-drive file installs.
- Browser E3 on DSH rc2: marketplace, details, persisted notes/favorites after reopening, and server compatibility filter passed; no page errors. The official first-run dialogs were dismissed only inside the disposable fixture.
- build-dsh-plugin 0.5.0 is published at merge e0c2b5e23040a5dfebd4fb2c29bab40b34d21b2e; local Skill bytes matched its public ZIP. Interactive Skill execution remains unverified.
- Store E4 real Profile and E5 public distribution remain unverified until separately read back.

## Decisions

| Decision | Objective/benefit | Cost | Evidence/reconsider |
| --- | --- | --- | --- |
| Official requestRejection | Apply same browser authority to exact routes | Requires Connection | Negative HTTP tests and real CLI smoke; revisit on public API change |
| Durable IDs, no replay | Prevent duplicate package writes after timeout | Persistent bounded state; interrupted operations need recovery | Corruption/replay/rollback tests; never infer completion from HTTP acceptance |
| Error codes only | Diagnose pnpm without exposing private stderr | Less raw debugging detail | Secret fixture tests |
| Candidate-only feeds | Expand discovery with provenance | Independent review before install | Fixed commit/hash/owner tests; no external code execution |
| Loader read projection | Explain activation without mutating official inventory | Unknown states stay unknown | Enum contract and ambiguity tests |

Rollback: revert source via a reviewed PR to the base commit or disable senders. Keep contact reservations permanently. Never downgrade a running manager/Guardian pair without a fresh Profile plan. Operations interrupted by a new boot are displayed as recovery-required, never replayed.
