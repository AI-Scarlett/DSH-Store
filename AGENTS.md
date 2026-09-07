# Repository instructions

This repository implements a DeepSeek Harness plugin. Preserve these rules in
every change:

1. The default interaction is read-only inspection and planning. Repository and
   Catalog automation may mutate only through the dedicated policy workflow: it
   must create a fresh machine-readable plan, bind the current base Commit and
   file hashes, pass every deterministic gate, use a short-lived GitHub token,
   and commit through an auditable pull request. It does not require a human
   confirmation for each scheduled run. Real DSH Profile/package/restart
   mutations remain separately planned and explicitly confirmed.
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
   hashes, backup or recoverable Git history, atomic commit, health check, and
   rollback. For scheduled Catalog and storefront operations, the deterministic
   policy verdict is the authorization record; unknown or ambiguous evidence
   must fail closed instead of waiting for a rubber-stamp approval.
8. Fail closed on malformed profiles, ambiguous paths, concurrent changes, or
   unknown official components.
9. Never log or return credentials, environment secrets, or full user files.
10. Keep verified, partial, blocked, and unverified states distinct in docs.
11. Automated Catalog admission may approve only a canonical public GitHub
    repository pinned to a full Commit whose complete bounded runtime surface,
    manifest, license, Bundle Patch, entry IDs, lifecycle scripts, dependencies,
    and permission signals satisfy the automation policy. Everything else is
    rejected, quarantined, or listed as blocked and is never made installable.
12. Automation must never execute third-party install, prepare, build, test, or
    runtime code. It may read bounded GitHub metadata and fixed-Commit source.
    It must update through CI-checked PRs and verify GitHub, Pages, and both
    production storefronts every three hours, retrying recoverable failures.


13. 作者联系规则（2026-09-07 用户明确要求）：对于所有项目，先核实对应的人，
    按 GitHub 不变的用户 ID 全局去重。一个人仅允许一次主动消息；无论以后新增
    多少项目、改名、升级、修改代码、关闭或重开 Issue、任务重试，都不能再次主动联系。
    历史消息也占用这一次名额。致谢、表情、沉默、代码修改和新的上架申请不算继续沟通授权。
    唯一例外是对方明确给出正向回复，并提出需要继续沟通的具体请求：先核验原文、身份、
    时间与当前撤回状态，再仅针对该请求回复一次；不能把一次请求视为永久授权。
    “不要再联系”等撤回要求优先于更早的同意，且适用于其所有项目。
14. All automated and manual outreach (Issues, comments, reviews, PR invitations,
    and any other channel) shares the central immutable-person contact ledger in
    AI-Scarlett/DSH-Store, branch author-contact-state, contacts.json. Never create
    a per-project ledger, bypass the gate with gh/API/browser, or contact another
    account to evade a recorded person's limit. Unknown people or ambiguous
    historical identities receive no outreach. A known person using another
    account remains the same person; add the verified alias before any contact.
15. Load the complete imported history and atomically reserve the person's slot
    through the Contents API SHA precondition BEFORE any notification-producing
    request. A timeout, failure, uncertain readback or cancelled run consumes
    the reservation permanently. Do not retry POST/PATCH messages. Old Issue
    edits, reopening, baseline refreshes and closure notices are also messages.
    Use scripts/reply-author-contact.mjs only with a main-reviewed, request-specific
    registry/author-replies/*.json plan for continuing an Issue/PR comment thread.
    Review-only requests and new communication channels need an equivalent
    verified request and the SAME central reservation gate before sending.
16. The operational state branch is the narrow exception to source/Catalog PR
    writes: it may only append contact reservations/aliases and preserve history
    and stops using compare-and-swap. Policy/source/history-seed changes still
    require CI-checked PRs. Missing/corrupt history fails closed. Rollback disables
    senders; it must NEVER reset the ledger, delete a reservation, replay an old
    sender version, or restore the old per-repository notification behavior.

Run `npm run check` before committing. Real DSH installation and UI verification
are separate acceptance gates and must never be inferred from unit tests.
