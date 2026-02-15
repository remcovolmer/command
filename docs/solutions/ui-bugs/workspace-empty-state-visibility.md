---
title: "Workspace sidebar showed empty state button for inactive workspaces"
date: 2026-02-15
category: ui-bugs
tags:
  - sidebar
  - workspace
  - empty-state
  - consistency
  - react
severity: low
component:
  - src/components/Sidebar/Sidebar.tsx
  - src/components/Sidebar/SortableProjectItem.tsx
symptoms: |
  The workspace sidebar section displayed a "+ New Terminal" empty state button
  for workspaces with 0 terminals, even when the workspace was not selected.
  Regular projects only show their empty state when selected.
root_cause: |
  Empty state rendering for workspaces lacked an `isActive` guard condition
  that regular projects had via `SortableProjectItem.tsx`.
---

# Workspace Empty State Visible When Inactive

## Problem Statement

The workspace sidebar empty state button ("+ New Terminal") was always visible when a workspace had 0 terminals, regardless of whether the workspace was actively selected. This created an inconsistency with regular projects, which only show their empty state when selected (`isActive`).

The issue was discovered during code review of PR #35, which had initially removed the button entirely -- an overly broad fix that masked the real problem.

## Investigation Steps

1. **Initial PR (ef54338)**: Removed the entire empty state block (12 lines) from the workspace section in `Sidebar.tsx`
2. **Code review**: 6 automated review agents approved the removal
3. **Manual review**: Identified that regular projects in `SortableProjectItem.tsx` conditionally show empty state based on `isActive`
4. **Pattern comparison**:
   - Projects: `const showEmptyState = isActive && terminals.length === 0 && ...`
   - Workspaces: `{workspaceTerminals.length === 0 && ( ... )}` (missing `isActive`)
5. **Label inconsistency**: Workspace used "New Terminal" while projects used "New Chat"

## Root Cause

The workspace empty state was missing the `isActive` conditional guard present in the regular project implementation:

```tsx
// Before (always visible for empty workspaces)
{workspaceTerminals.length === 0 && (
  <div className="ml-6 pl-3 py-2 border-l border-border/30">
    <button onClick={() => handleCreateTerminal(workspace.id)}>
      <Plus className="w-3 h-3" />
      New Terminal
    </button>
  </div>
)}
```

## Solution

Added the `isActive` guard and renamed label for consistency:

```tsx
{isActive && workspaceTerminals.length === 0 && (
  <div className="ml-6 pl-3 py-2 border-l border-border/30">
    <button
      onClick={() => handleCreateTerminal(workspace.id)}
      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
    >
      <Plus className="w-3 h-3" />
      New Chat
    </button>
  </div>
)}
```

**Changes:**
- Added `isActive &&` condition to gate empty state visibility
- Changed label from "New Terminal" to "New Chat" (matches project terminology)

**Commits:** ef54338, 8146c26

## Key Insight

When fixing UI inconsistencies, align behavior across sibling components rather than removing functionality. The initial fix (complete removal) was overly broad. The correct fix was to match the established pattern from the sibling component (`SortableProjectItem`).

## Prevention

### Before modifying any sidebar component:
- [ ] Search for sibling components with the same responsibility
- [ ] Compare conditional rendering guards across all variants
- [ ] Verify feature parity (workspace vs project) after the change
- [ ] Check label/terminology consistency

### Pattern to follow
Both workspace and project empty states should use the same guard pattern:
```
isActive && items.length === 0 → show empty state CTA
```

## Related

- PR #35: https://github.com/remcovolmer/command/pull/35
- `src/components/Sidebar/SortableProjectItem.tsx:98-101` (project empty state pattern)
- `docs/plans/2026-02-15-fix-remove-workspace-empty-state-new-terminal-button-plan.md`
