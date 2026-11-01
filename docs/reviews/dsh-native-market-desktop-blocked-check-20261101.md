# DSH Desktop final-check path for Catalog review entries

## Finding

The screenshot is the DSH Desktop Store panel for `build-dsh-plugin` 0.6.1 at fixed Commit `c71903bffd9098aecbca4b1cf60b0d7602c51f33`. The Catalog keeps it `blocked` because its fixed-source permission and security signals need review. The user reports that installing the GitHub address directly through DSH Desktop succeeded; that report is treated as user-provided runtime evidence, not as a Store security review.

At base Commit `0f2d945e30097b24a4ecf742ff792fdd61484e6b`, the Catalog had 872 entries: 33 approved, 743 blocked, and 96 unlisted. Of the blocked records, 702 carried an automatic-policy reason. A bounded metadata check found 740 blocked records with canonical GitHub URLs, full Commits, valid package identities, valid entry IDs, and safe package paths, excluding protected package and entry identities. Catalog provenance labels, publication timestamps, and safe Unicode path segments do not gate DSH inspection. This only proves the source can be submitted to DSH, not that a plugin is approved or secure.

The three blocked records that still do not get a Store handoff are `dsh-tui` and `dsh-explorer`, which lack the bounded entry identities needed to guard protected DSH components and single-bundle operations, and `dsh-plugin-hub`, which declares the protected `@deepseek-ai/*` namespace.

The Desktop panel already had the official `pluginManager.inspect()` and `pluginManager.installBundle()` calls. It required `status === 'approved'` both when rendering the install action and after refreshing the Catalog before execution. As a result, DSH never got the chance to decide for any `blocked` entry.

## Change decision

The DSH Desktop panel now shows a “交由 DSH 检查安装” action for a blocked entry only when its canonical fixed GitHub source, package identity, entry IDs, and install path pass basic structural checks. Catalog provenance labels and source timestamps no longer act as install gates, and safe Unicode path segments are accepted. Protected package namespaces, the Store itself, protected DSH entry IDs, malformed sources, floating Commits, unsafe paths, and unlisted records remain unavailable.

The action opens a confirmation that displays the Catalog reason, permission advice, lifecycle scripts, and `external-only` update policy. The user must enter a confirmation phrase bound to the package name and full Commit. The app refreshes the Catalog and verifies that the repository spec, version, status, review reason, and update policy have not changed. It calls the official DSH `inspect()` first; `installBundle()` runs only when DSH returns `accepted`. The UI shows DSH's applied, restart-required, rejected, or unknown result and never retries an uncertain operation.

The Catalog remains `blocked`; this change does not promote records or alter admission policy. It changes only the user-confirmed DSH Desktop handoff. Store-managed Web operations continue to reject `blocked` records. A DSH install result is not a Store security approval.

## Verification and release state

- Disposable Desktop fixtures cover a blocked fixed source, typed confirmation, DSH inspect acceptance, successful installation, inspect rejection, source changes between confirmation and execution, provenance-label independence, Unicode bundle paths, malformed URLs, floating Commits, unsafe paths, and protected targets.
- `npm run check` and `npm pack --dry-run --json` are required before the source PR.
- Source package version is 0.9.23. At this base Commit, the public Catalog still pins 0.9.22; a separate fresh Catalog plan must pin the merged 0.9.23 Commit and verify GitHub Raw, Pages, `dsh.store`, and `dsh-store.cn`.
- Real DSH Desktop installation and visible UI acceptance remain unverified until a user runs the updated Store. No real Profile or DSH package is changed by this source patch.
