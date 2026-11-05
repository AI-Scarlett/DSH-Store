# DSH Store Desktop Confirmation Command Font and Copy Review

- Plan ID: `dsh-native-market-desktop-confirm-command-font-20261105`
- Date: 2026-11-05
- Base: DSH Store `0.9.40` at `548e639db359f629d5c817ae40c765c0e98ddf2e`
- Scope: Desktop install/update confirmation dialog

## Changes

- Reduce the install spec, instruction label, command, and input text to 10px so the command fits the narrow Desktop dialog more comfortably.
- Keep the complete command in a read-only, wrapping text box. Clicking or focusing it selects the complete confirmation command for copying.
- Replace the full command in the empty input placeholder with `粘贴上方完整命令`, avoiding a second clipped copy of the command.
- Bump the package source version to 0.9.41. Catalog pin changes remain a separate release gate.

## Verification

- Plan binds the change to the current main Commit and exact precondition hashes.
- Source syntax and diff checks are recorded separately from CI and public Catalog acceptance.
- Real DSH Desktop installation and visual acceptance remain unverified.
