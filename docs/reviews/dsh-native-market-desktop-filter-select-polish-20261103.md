# DSH Store Desktop Filter Select Polish Review (0.9.38)

- Plan ID: dsh-native-market-desktop-filter-select-polish-20261103
- Date: 2026-11-03
- Scope: Fix vertical baseline text clipping on Desktop select dropdowns

## Changes
1. **Desktop Facet & Filter Selects**:
   - Fixed text baseline truncation where bottom half of option glyphs were cut off inside fixed-height `<select>` elements.
   - Cleared excessive top/bottom padding in `styles.select`, standardizing `padding: '0 26px 0 10px'`.
   - Set explicit `fontSize: '12px'`, `lineHeight: 'normal'`, and `height: '34px'` with `borderRadius: '8px'`.
   - Ensured ample 26px right padding so text never collides with native dropdown arrow icon.

2. **Verification**:
   - All 47 Desktop compatibility unit tests pass.
   - Full test suite and registry validation pass.
