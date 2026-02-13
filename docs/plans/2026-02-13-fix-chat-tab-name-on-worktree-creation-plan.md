---
title: "Fix chat tab showing 'Chat 1' instead of worktree name on creation"
type: fix
date: 2026-02-13
---

# Fix chat tab showing "Chat 1" instead of worktree name on creation

## Overview

When a user creates a new worktree, the automatically created chat tab shows "Chat 1" instead of the worktree name. Closing the tab and opening a new chat for the same worktree correctly shows the worktree name.

## Problem Statement

The bug is a **stale React closure** in `useCreateTerminal.ts`. When `handleWorktreeCreated` in `Sidebar.tsx` calls `addWorktree(worktree)` followed immediately by `createTerminal(projectId, { worktreeId })`, the `createTerminal` callback still references the **pre-update** `worktrees` state from the previous render cycle.

**Flow:**

```
handleWorktreeCreated(worktree)
  ├── addWorktree(worktree)           // Updates Zustand store
  └── createTerminal(projectId, ...)  // Still has STALE worktrees closure
        ├── worktrees.find(w.id === worktreeId) → undefined (stale!)
        └── title = "Chat 1"  ← WRONG
```

The main process also sends a correct `terminal:title` event, but it may arrive before the xterm component has mounted and subscribed, so the correction is lost.

## Root Cause Analysis

**File:** `src/hooks/useCreateTerminal.ts:57-63`

```typescript
// worktrees is captured via closure at line 24:
const worktrees = useProjectStore((s) => s.worktrees)

// Later inside createTerminal callback:
const worktree = worktreeId
    ? Object.values(worktrees).find((w) => w.id === worktreeId)
    : null

const title = worktree
    ? worktree.name
    : `Chat ${...length + 1}`  // Falls through to this because worktree is undefined
```

**Trigger:** `src/components/Sidebar/Sidebar.tsx:184-188`

```typescript
const handleWorktreeCreated = (worktree: Worktree) => {
    addWorktree(worktree)
    createTerminal(worktree.projectId, { worktreeId: worktree.id })
}
```

## Proposed Solution

**Approach B (pass worktree name from caller)** - avoids the lookup entirely, simplest and most robust.

Add an optional `title` parameter to `createTerminal`. The caller (`handleWorktreeCreated`) already has the worktree object with the correct name, so it passes it directly.

This eliminates both the stale closure issue and the need for any worktree lookup in the hook.

## Acceptance Criteria

- [x] Creating a new worktree immediately shows the worktree name on the chat tab
- [x] Existing terminal creation flows (non-worktree) are unaffected
- [x] The main process `terminal:title` event still works as a fallback

## MVP

### `src/hooks/useCreateTerminal.ts`

Add `title` to the options parameter and use it when provided:

```typescript
interface CreateTerminalOptions {
    worktreeId?: string
    title?: string  // NEW: allow caller to pass explicit title
}

// Inside createTerminal callback:
const title = options?.title
    ?? (worktree ? worktree.name : `Chat ${...}`)
```

### `src/components/Sidebar/Sidebar.tsx`

Pass the worktree name when creating the terminal:

```typescript
const handleWorktreeCreated = (worktree: Worktree) => {
    addWorktree(worktree)
    createTerminal(worktree.projectId, {
        worktreeId: worktree.id,
        title: worktree.name,  // NEW: pass name directly
    })
}
```

## Files to Change

| File | Change |
|------|--------|
| `src/hooks/useCreateTerminal.ts` | Add `title` option, use it when provided |
| `src/components/Sidebar/Sidebar.tsx` | Pass `worktree.name` as `title` option |

## References

- `src/hooks/useCreateTerminal.ts:24,57-63` - Stale closure location
- `src/components/Sidebar/Sidebar.tsx:184-188` - Trigger location
- `electron/main/index.ts:298-306` - Main process correctly sets `initialTitle`
- `electron/main/services/TerminalManager.ts:128-132` - Sends `terminal:title` IPC event
