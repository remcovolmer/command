---
title: Merge button fails to remove worktree due to open terminals (EBUSY on Windows)
date: 2026-02-15
status: solved
category: runtime-errors
severity: high
components:
  - WorktreeItem.tsx
  - Sidebar.tsx
  - worktreeCleanup.ts
tags:
  - windows
  - ebusy
  - electron
  - git-worktree
  - terminal-cleanup
  - pty-file-handles
  - dry
related_issues: []
---

# Merge button fails to remove worktree due to open terminals (EBUSY on Windows)

## Problem

Clicking the "Merge" button on a worktree's PR successfully merged the PR on GitHub, but then failed to remove the local worktree with `EBUSY: resource busy, unlink` on Windows. The user saw "Merge Failed" despite the PR being merged, leaving the system in an inconsistent state.

### Symptoms

- Merge button shows "Merge Failed" notification
- PR is actually merged on GitHub (irreversible)
- Worktree remains in the sidebar
- PR polling continues running (resource leak)

## Root Cause

`handleMerge` in `WorktreeItem.tsx` called `api.worktree.remove()` without first closing terminals. Active PTY processes held file handles in the worktree directory. Windows cannot delete directories with open file handles, causing `EBUSY`.

The existing `handleRemoveWorktree` in `Sidebar.tsx` had the correct pattern but it wasn't replicated in the merge flow.

### Gap Analysis

| Step | Sidebar (correct) | Merge button (broken) |
|------|-------------------|----------------------|
| Check uncommitted changes | Yes | **Missing** |
| Close terminals | Yes | **Missing** |
| Wait for file handle release | Yes | **Missing** |
| Remove worktree via IPC | Yes | Yes |
| Remove from Zustand store | Yes | **Missing** |
| Stop PR polling | N/A | **Missing** |
| Log errors | Yes | **Missing** |

## Solution

### 1. Extracted shared utility: `src/utils/worktreeCleanup.ts`

```typescript
import type { TerminalSession } from '../types'
import { getElectronAPI } from './electron'

export async function closeWorktreeTerminals(
  terminals: TerminalSession[],
  removeTerminal: (id: string) => void
): Promise<void> {
  const api = getElectronAPI()
  const active = terminals.filter((t) => t.state !== 'stopped')
  active.forEach((t) => {
    api.terminal.close(t.id)
    removeTerminal(t.id)
  })
  if (active.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}
```

### 2. Fixed merge handler: `WorktreeItem.tsx`

```typescript
const handleMerge = useCallback(async () => {
  if (!prStatus?.number) return

  const api = getElectronAPI()
  try {
    // Check for uncommitted changes before merging
    const hasChanges = await api.worktree.hasChanges(worktree.id)
    const message = hasChanges
      ? `Merge & Squash PR #${prStatus.number}?\n\nWARNING: uncommitted changes will be lost.\n\nThis will also remove the worktree.`
      : `Merge & Squash PR #${prStatus.number}?\n\nThis will also remove the worktree.`
    const confirmed = window.confirm(message)
    if (!confirmed) return

    await api.github.mergePR(projectPath, prStatus.number)
    await closeWorktreeTerminals(terminals, removeTerminal)

    try {
      await api.worktree.remove(worktree.id, hasChanges)
    } catch (err) {
      console.error('[WorktreeItem] Worktree removal failed after merge:', err)
      api.github.stopPolling(worktree.id)
      api.notification.show('PR Merged', `PR #${prStatus.number} merged, but worktree removal failed. Remove it manually.`)
      return
    }

    removeWorktree(worktree.id)
    api.github.stopPolling(worktree.id)
    api.notification.show('PR Merged', `PR #${prStatus.number} merged and worktree removed`)
  } catch (err) {
    api.notification.show('Merge Failed', err instanceof Error ? err.message : 'Unknown error')
  }
}, [prStatus, projectPath, worktree.id, terminals, removeTerminal, removeWorktree])
```

### 3. Refactored Sidebar handler

Replaced 10 lines of inline terminal cleanup with:

```typescript
const worktreeTerminals = Object.values(terminals).filter((t) => t.worktreeId === worktreeId)
await closeWorktreeTerminals(worktreeTerminals, removeTerminal)
```

## Key Design Decisions

**Why 500ms delay?** Windows needs time to release file handles after PTY process termination. 500ms is empirically sufficient and matches the existing pattern. Only applied when terminals were actually closed.

**Why filter `state !== 'stopped'`?** Stopped terminals already released file handles. Sending IPC close to a stopped terminal is a no-op. Skipping them avoids unnecessary IPC calls and prevents the 500ms wait when no handles need releasing.

**Why conditional `force`?** `api.worktree.remove(id, hasChanges)` passes force only when the user confirmed loss of uncommitted changes, preserving git's built-in safety checks otherwise.

**Why `stopPolling` in catch block?** The early `return` on partial failure would skip normal cleanup. Since the PR is already merged, continued polling is wasted. Calling `stopPolling` ensures cleanup happens regardless of worktree removal outcome.

## Prevention Strategies

### For this codebase

1. **Shared utilities for multi-step operations**: Any operation with 3+ sequential steps (check state, modify, cleanup) should be a single utility function, not duplicated across handlers.
2. **Code review checklist**: When reviewing destructive operations, ask: "Does this operation exist elsewhere? Are the implementations identical?"
3. **Partial failure handling**: Always distinguish "fully failed" vs "partially succeeded" and report specifically which steps succeeded.

### For Electron apps on Windows

1. **Close PTY handles before filesystem operations**: Windows has stricter file locking than Unix. Always close terminal processes before deleting their working directories.
2. **Add delay after process termination**: 500ms is a reasonable heuristic for Windows handle release.
3. **Implement retry logic for EBUSY**: For critical paths, retry with exponential backoff rather than a fixed delay.

### Detection patterns for code review

- **Parallel code paths for same operation**: Search for duplicated removal/cleanup sequences.
- **Async operations without synchronization**: Look for filesystem operations that don't wait for process termination.
- **Silent catch blocks**: Flag `catch {}` blocks that discard errors without logging.

## Related Documents

- Plan: `docs/plans/2026-02-15-fix-merge-button-worktree-removal-plan.md`
- Original feature: `plans/feat-sidebar-pr-status-and-merge.md`
- Todos: `todos/021-complete-p2-silenced-worktree-removal-error.md`, `todos/022-complete-p3-duplicate-worktree-cleanup-pattern.md`, `todos/023-complete-p2-no-uncommitted-changes-check-before-merge.md`
- Prior fix: Commit `b34fadb` - "fix: merge PR from main repo path to avoid branch-in-use error (#22)"

## Files Modified

| File | Change |
|------|--------|
| `src/utils/worktreeCleanup.ts` | New shared utility (21 lines) |
| `src/components/Worktree/WorktreeItem.tsx` | Fixed handleMerge: hasChanges check, shared utility, error logging, stopPolling |
| `src/components/Sidebar/Sidebar.tsx` | Refactored handleRemoveWorktree to use shared utility (-10 lines) |
