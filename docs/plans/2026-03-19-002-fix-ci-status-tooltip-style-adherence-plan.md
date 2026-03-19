---
title: "fix: Replace native CI status tooltip with styled popover"
type: fix
status: active
date: 2026-03-19
---

# fix: Replace native CI status tooltip with styled popover

## Overview

The `CIStatusIcon` component in `WorktreeItem.tsx` uses a native HTML `title` attribute to show CI check statuses. This renders as an OS-default tooltip (white/yellow background, system font) that completely clashes with the app's dark theme and custom-styled UI.

## Problem

- `CIStatusIcon` (line 19-33 in `src/components/Worktree/WorktreeItem.tsx`) builds a multi-line string of check names with status symbols and passes it as `title={tooltip}`
- The browser renders this as a native OS tooltip — unstyled, wrong colors, wrong font, delayed appearance
- The app's other floating elements (context menus, branch dropdown, dialogs) all use `bg-popover border border-border rounded-md shadow-lg` — this tooltip is the outlier

## Proposed Solution

Replace the native `title` tooltip on `CIStatusIcon` with a hover-triggered custom popover that matches the app's existing popover style. Use React state + relative positioning (no portal needed for this small element).

### Implementation

**1. Replace `CIStatusIcon` with a hover popover** (`src/components/Worktree/WorktreeItem.tsx`)

- Add `useState<boolean>` for hover visibility
- Wrap icon in a `relative` container with `onMouseEnter`/`onMouseLeave`
- Render a positioned popover div when hovered:
  - Style: `absolute z-50 bg-popover border border-border rounded-md shadow-lg py-1.5 px-2 text-xs`
  - Position: below-right of the icon, with `whitespace-nowrap`
  - Content: list of checks with colored status icons (green ✓, red ✗, yellow ○) matching the icon colors already used in the component
- Remove the `title` attribute from the icon `<span>`

**2. Style each check line consistently**

Each check row should show:
- `text-green-500` for pass (✓), `text-red-500` for fail (✗), `text-yellow-500` for pending (○)
- Check name in `text-popover-foreground`
- `gap-1.5` between icon and name
- `py-0.5` per row for comfortable density

## Acceptance Criteria

- [ ] CI status tooltip renders with app's popover styling (`bg-popover border-border rounded-md shadow-lg`)
- [ ] Check statuses show colored symbols matching the existing icon color scheme
- [ ] Tooltip appears on hover without native browser delay
- [ ] Tooltip does not overflow the viewport (basic positioning)
- [ ] No regressions to `ReviewBadge` or `MergeButton` tooltips (those are single-line hints, acceptable as native `title`)

## Scope

**In scope:** Only the `CIStatusIcon` multi-line tooltip — this is the visually jarring one.

**Out of scope:** Other `title` attributes in the app. Most are single-line button hints (`"Disable"`, `"Copy hash"`, etc.) that are fine as native tooltips. A shared Tooltip component is possible future work but not needed for this fix.

## Files to Change

| File | Change |
|------|--------|
| `src/components/Worktree/WorktreeItem.tsx` | Replace `CIStatusIcon` implementation: native `title` → hover popover with app styling |
