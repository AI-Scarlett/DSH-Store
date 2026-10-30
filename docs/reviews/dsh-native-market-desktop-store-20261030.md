# DSH-Store Desktop settings and install adapter review

## Request

Move DSH-Store from the Built-in Plugins tab to its own Settings navigation entry, display the name `DSH-Store`, and make the trusted Catalog and installation flow work in official DSH Desktop.

## Architecture decision

Use the official `settings.section` Client slot for the dedicated Settings navigation entry. Add `locale/en.json` and `locale/zh.json` with `meta.title: DSH-Store`, retaining `dsh-safe-plugin-manager` as the internal package identity. The browser-only Desktop component reads the public Catalog through a 4 MiB, 12-second bounded stream and reads the Desktop Profile's installed bundle list from DSH's `pluginManager` Remote API. It displays every approved Catalog record so people can browse the reviewed marketplace, while showing whether each entry declares Desktop support. Installation requires both `compatibility.profiles` to include `desktop` and an exact `compatible` result for the Host-reported DSH runtime version. After the user types the package name and all 40 characters of the fixed Commit, the Client calls official `pluginManager.inspect` and `pluginManager.installBundle`; a lost response may be reconciled with `waitForInstall` without resending.

The web marketplace continues to use the existing guarded Store plan and execution workflow. Desktop does not call those Store endpoints and does not gain Store-managed Profile Patch, enable/disable, uninstall, Guardian, or restart paths. Lifecycle actions other than a new Catalog installation stay with the DSH plugin page.

## Rationale and tradeoffs

| Decision | Objective | Benefit | Cost | Evidence | Reconsider when |
| --- | --- | --- | --- | --- | --- |
| Dedicated `settings.section` plus `meta.title` | Put the marketplace directly in Settings navigation and show its product name in DSH plugin inventory | Separates Store from Built-in Plugins and keeps technical package identity stable | Adds one Settings row and two locale files | Published `dsh-v0.2.2-alpha.2` slot, package metadata and Plugin Manager presentation contracts; disposable Client tests | DSH changes its Settings or package metadata contract |
| DSH official Remote installer | Make Desktop installation use its owned package/Profile transaction | Reuses Host compatibility checks, locking, package-manager recovery and activation reporting | Git-source compatibility is checked after retrieval; pre-approved build-script side effects can remain | Published Remote types and disposable inspect/installBundle call test | DSH adds a fixed-Commit catalog operation with preflight compatibility |
| Desktop Profile and exact runtime gates | Avoid offering installation to entries that have not declared Desktop support or compatibility with the precise DSH runtime | Missing profile declarations and unknown releases fail closed before install | Some entries remain visible but not installable until Catalog evidence is updated | The Client checks `compatibility.profiles` and the exact DSH release from official `listBundles()` `installTarget.version` metadata | Official DSH exposes a stronger runtime-version Remote field or the Catalog adds a narrower per-profile compatibility contract |

## Risk and prohibited surfaces

- Risk class: `R3` for the user-confirmed Desktop package/Profile install. Listing and preparation are read-only.
- Candidate and non-approved records are not installable. The Desktop list requires a trusted Catalog record, canonical GitHub repository, full Commit and approved status. Installation also requires an explicit `desktop` profile declaration and exact runtime compatibility.
- Install confirmation shows the source identity, permissions and declared lifecycle scripts, and requires the full Commit in the confirmation text. The Store does not pass build-script approvals to DSH.
- The DSH official installer owns the actual package mutation. DSH restores the package manifest and lockfile on install refusal/failure; a Git-source compatibility refusal occurs after retrieval, and previously approved build-script side effects may remain.
- No real Desktop Profile is changed in this source review. Desktop UI and profile acceptance remain separate release gates.

## Verification

- Official API source review: passed against the published `dsh-v0.2.2-alpha.2` tag.
- Disposable Desktop Client contract tests: 26 passed, including the current 861-entry trusted Catalog, Desktop-only eligibility, installed-state display, fixed-Commit confirmation and official installer calls. The checked-in Catalog currently has 33 approved entries, 3 declare Desktop support, and none of those 3 declare compatibility with `0.2.2-alpha.2`; browsing is available while installation stays gated until evidence is updated.
- `npm run check`: passed: `REGISTRY_OK entries=861`, 552/552 tests.
- Exact-head CI: pending.
- Real Desktop inspection: live read-only inspection of `dsh-app://app/` still shows the previous Built-in Plugins tab and read-only handoff panel. This source has not been installed into the real Profile, so the new Settings section and packaged Catalog UI remain unverified.
- Catalog merge and public storefront readback: separate post-merge Catalog plan.

## Rollback

Revert only the source PR through a CI-checked PR. The source change itself does not install or modify a Desktop Profile. A separately user-confirmed install is owned by DSH's official plugin manager.
