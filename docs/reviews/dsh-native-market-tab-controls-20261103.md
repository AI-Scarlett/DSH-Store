# DSH STORE 0.9.36 tab controls review

## Scope

This source change improves the marketplace view tabs in `src/client.js`: inactive tabs gain a visible border and surface background, the selected tab retains its high contrast style, and tab labels remain readable while directory or ranking counts load. It does not change filtering, ranking data, install behavior, Catalog contents, or the DSH Profile.

## User-visible issue

The supplied DSH Desktop screenshot showed the inactive view tabs as low-contrast text and the recommendation and essential tabs as `…` while ranking counts were loading. The live accessibility tree confirmed the tabs are buttons with `role="tab"`, but their inactive style used a transparent border and background.

## Planned fix

- Give each view tab a visible outline, filled surface, primary label color, and pointer cursor.
- Keep the active tab on the existing high-contrast primary fill.
- Show fixed tab names while counts are loading; append counts only after the data is ready.
- Extend the disposable Desktop fixture to check button affordance, active-state distinction, and loading labels.

## Verification

The isolated Desktop compatibility suite passed 47/47. `npm run check` passed with `REGISTRY_OK entries=875` and 594/594 tests. `npm pack --dry-run --json` reported 1,075 files for `dsh-safe-plugin-manager@0.9.36`; `node --check src/client.js` and `git diff --check` passed. Typed-plan verification passed with `DSH_UPGRADE_PLAN_OK base=bfed2434c5c1b4915833d6384be38fda7cd17046 changed=9`. Exact-head PR CI remains pending.

The disposable Desktop fixture verified the inactive-tab outline/surface, active-tab contrast, and absence of ellipses while ranking counts load. The supplied screenshot and live accessibility tree were used as the baseline: tab controls had transparent inactive styling and the ranking labels showed `…`. Real DSH Desktop package/Profile update and visual acceptance are separate gates. The change must not be reported as visible in the user's installed app until DSH Desktop loads the new package.

## Rollback

Revert this source change through a new CI-checked PR. No real Profile, Catalog, or DSH restart is changed by this source PR.
