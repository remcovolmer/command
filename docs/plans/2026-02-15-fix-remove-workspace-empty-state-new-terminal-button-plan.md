---
title: Remove workspace empty state "+ New Terminal" button
type: fix
status: completed
date: 2026-02-15
---

# Remove workspace empty state "+ New Terminal" button

When a workspace has no chats open, the sidebar shows a redundant "+ New Terminal" button as an empty state. This button is unnecessary because the workspace row already has a hover-visible "+" button for creating new terminals.

## Acceptance Criteria

- [x] Remove the empty state block in `src/components/Sidebar/Sidebar.tsx:329-340` (the `workspaceTerminals.length === 0` section)
- [x] Verify the hover "+" button on the workspace name row still works for creating terminals

## Context

The workspace section in `Sidebar.tsx` renders two ways to create a terminal:
1. **Hover "+" button** on the workspace name row (line 297-306) — always available on hover
2. **Empty state "+ New Terminal"** button below workspace name (line 329-340) — shown when no terminals exist

Option 2 is redundant and clutters the UI. Removing it keeps the sidebar clean while maintaining full functionality via option 1.

## MVP

Remove lines 329-340 in `src/components/Sidebar/Sidebar.tsx`:

```tsx
// DELETE this block:
{/* Empty state for workspace with no terminals */}
{workspaceTerminals.length === 0 && (
  <div className="ml-6 pl-3 py-2 border-l border-border/30">
    <button
      onClick={() => handleCreateTerminal(workspace.id)}
      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
    >
      <Plus className="w-3 h-3" />
      New Terminal
    </button>
  </div>
)}
```
