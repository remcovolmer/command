---
title: Move Add Project button inline with Command header
type: feat
status: completed
date: 2026-03-12
---

# Move Add Project button inline with Command header

The "Add project" button currently occupies its own full-width row below the "Command" header in the sidebar. This wastes ~44px of vertical space that could show more projects/workspaces. Move it to be an inline `[+]` icon button right-aligned in the header row.

## Current Layout

```
┌──────────────────────────┐
│  [Logo] Command          │  ← header row
├──────────────────────────┤
│  [+ Add project -------] │  ← standalone button (wastes a full row)
├──────────────────────────┤
│  WORKSPACES / PROJECTS   │
```

## Proposed Layout

```
┌──────────────────────────┐
│  [Logo] Command      [+] │  ← header row with inline add button
├──────────────────────────┤
│  WORKSPACES / PROJECTS   │
```

## Acceptance Criteria

- [x] Remove the standalone "Add project" button row (Sidebar.tsx lines 296-305)
- [x] Add a compact `[+]` icon button right-aligned in the header row (Sidebar.tsx lines 291-294)
- [x] Button opens the same `AddProjectDialog` via `handleAddProject`
- [x] Add `title="Add project"` tooltip for discoverability
- [x] Click target at least 32×32px (`p-2` or `min-w-8 min-h-8`)
- [x] Style: muted by default, primary on hover (matches footer icon pattern for consistency)
- [x] Empty-state "Add your first project" link in scrollable area remains untouched
- [x] Verify no hotkey conflicts (no existing add-project hotkey exists)

## Implementation

**File:** `src/components/Sidebar/Sidebar.tsx`

1. Delete lines 296-305 (the `<div className="px-3 mb-2">` block with the full-width button)
2. Modify the header div (lines 291-294):
   - Add `justify-between` to the flex container
   - Add a compact icon button with `Plus` icon, `ml-auto`, hover styling, and tooltip

**Net diff:** ~5 lines changed, ~10 lines removed. No state/IPC/logic changes.

## Risks

None. Pure layout change in a single file. No tests to update. `handleAddProject` and `AddProjectDialog` untouched.
