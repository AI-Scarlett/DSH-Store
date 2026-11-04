# DSH Store Desktop Confirm Command Layout Polish Review (0.9.39)

- Plan ID: dsh-native-market-desktop-confirm-command-polish-20261104
- Date: 2026-11-04
- Scope: Fix action confirmation command overflow and input truncation on Desktop

## Changes
1. **Desktop Action Confirmation Command & Input**:
   - Fixed confirmation command overflow where long commands (such as `UPDATE dsh-safe-plugin-manager <40-char-sha>`) extended beyond modal boundaries and horizontal bounds.
   - Separated the instructional prompt (`确认在当前 Desktop Profile 执行[操作]，请输入以下命令：`) from the command text.
   - Rendered the complete confirmation command into a dedicated monospace container (`styles.actionConfirmCode`) with `wordBreak: 'break-all'`, `overflowWrap: 'anywhere'`, `userSelect: 'all'`, and full width bounding.
   - Styled input box (`styles.actionConfirmInput`) with `boxSizing: 'border-box'`, `width: '100%'`, `height: '34px'`, `fontSize: '11.5px'`, and added `title` attribute for accessibility.
   - Injected `DETAIL_MODAL_CSS` into `DesktopStorePanel` and ensured `overflow-x: hidden` on modal content container.

2. **Verification**:
   - All 47 Desktop compatibility unit tests pass (`node --test test/desktop-compat.test.mjs`).
   - Package version bumped to `0.9.39`.
   - Upgrade plan verified via `scripts/verify-dsh-upgrade-plan.mjs`.
   - Full test suite, contracts, and registry validations pass.

