# GitHub author feedback review — 2026-10-16

Base: `c28d5dc2858c632345ac13cb5ee54918e3978d39`. Fixed-source, read-only review; no third-party code, install, build, test or real Profile was executed. This document is the pre-publication decision, not a receipt of comments sent or deployment.

- [#1390](https://github.com/AI-Scarlett/DSH-Store/issues/1390): Qwen Paint 0.17.2 at `04292b6c4f5388bd638ff72a7eb5e694248e1b9f`, 8 packaged text files, complete coverage. The ComfyUI guard, redirect rejection and filtered subprocess environment are present. Admission remains blocked: Hipfire's separately configurable endpoint bypasses the guard/opt-in, and the README's no-package-install claim conflicts with runInstallSource/pip and the Shell wrapper. Preserve the improvements and request specific enforcement/disclosure corrections.
- [#1376](https://github.com/AI-Scarlett/DSH-Store/issues/1376): Ledger Memory 1.2.1 at `c65d4be3efc617dff53365bc221c2cbc659edb4f`, 10 packaged text files, complete coverage. Refresh old diagnostics and exact compatibility declarations. Manual admission rejected pending a demonstrated server-side authorization boundary for settings read/write and broadcast. Same-origin fetch credentials alone are insufficient. DSH_HOME and a diagnostic environment flag are not evidence of an API key.
- [#1430](https://github.com/AI-Scarlett/DSH-Store/issues/1430): VRM Pet 3D at `85562e842b1d9c4a6d4381c6daa0710c5995e79c`. Confirmed both destructive-root-delete findings are the same speech-table comment and adjacent UI literals. Traced speechLines/pickSpeechLine to textContent in both renderers; the process launch is separate. Added two file-hash/rule/line-bound false-positive dispositions in admission-reviews.json. No global token whitelist. Asset/package ignore coverage, unresolved mixed-asset license metadata and missing explicit DSH compatibility still prevent admission. No installable entry was added.

## Contact and issue decisions

Two request-specific plans bind new concrete requests (#1390 comment 6196381251 and #1376 comment 6191648513), original body hashes and update timestamps. Send only after main review, through the first-party sender and central Contents API CAS. Complete imported history and stops were checked.

The VRM requester's immutable ID 26193937 is absent from complete central contact history; the existing continuation gate therefore provides no send permission. Do not bypass it. The exact appeal correction is public in this review and the admission registry. No new close request was found: leave unresolved Issues open; do not reuse #709's consumed grant to close #1427. The previous #1296 failed grant stays consumed.

An overlapping REST audit covered 40 Issue comments since October 14 and zero new inline review comments since the previous run. The new generic bounty comment under #148 supplies no concrete patch, reproducible bug or repository test evidence; it does not justify a code change, payment, reply or closure of the operational report.

## Publication gates

The machine plan binds exact base, scope, preconditions and final hashes. Run npm run check and CI before merge, then read back GitHub Raw, Pages and both production storefronts. Independent runtime acceptance remains unknown. Actual sends, reservations, closure counts and deployment readback belong in a separate final receipt.
