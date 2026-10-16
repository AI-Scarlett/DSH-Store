# Store 0.9.5 fixed-source release

Publish only `dsh-safe-plugin-manager` from https://github.com/AI-Scarlett/DSH-Store/commit/503ed0df8df0492ec24247c10b4c93644688d371 after source PR #1437 passed all required checks. Its merged tree equals the tested PR head. Other Catalog entries and all contact state remain unchanged.

The bounded scan covers 107 distributed source/data files, 1,534,248 runtime bytes, with complete coverage and no source-budget or unsupported-artifact gap. Canonical public repository, MIT license, manifest identity, single owned Bundle entry, absence of install lifecycle scripts and runtime dependencies were checked. This is the explicitly requested first-party Store release, retaining its owner-reviewed, high-permission control-plane status. It is not automatic low-risk admission.

The scanner's crypto-miner match is its own regex at `src/submission-security-scan.mjs:58`; its exact source hash, line and rationale are recorded in the machine review. All 12 findings have exact-file reviews. The executable signal is the existing Node CLI, and the tool-view signal is detection code. Existing planned file writes and fixed-array official CLI/Guardian commands retain authentication, confirmation, backups, health checks and rollback. Generic admission and third-party scanner rules are unchanged.

Official Alpha.4 install/start/authenticated API/uninstall/restore passed in a disposable Profile locally and in Linux/macOS/Windows CI with pnpm 10/11/12. Alpha.2 and Alpha.3 disposable CI passed too. Desktop UI, failure-induced rollback and third-party runtime acceptance remain unverified. The new Catalog records this isolated CLI evidence without claiming real-Profile/Desktop acceptance.

Rollback uses a new CI-checked Catalog revert PR to the prior 0.9.4 pin. Existing storefront atomic refresh preserves and restores its preceding artifact on health failure.
