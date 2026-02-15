---
title: "fix: Merge button fails to remove worktree due to open terminals"
type: fix
status: active
date: 2026-02-15
---

# fix: Merge button fails to remove worktree due to open terminals

## Overview

The merge button in `WorktreeItem.tsx` merges the PR successfully but then fails to remove the worktree because terminals are still open with file handles in the worktree directory (EBUSY on Windows). The fix is to close terminals before removing the worktree, matching the existing pattern in `Sidebar.tsx`.

## Problem Statement

When clicking "Merge" on a worktree's PR:
1. PR merges via `gh pr merge --squash` (works)
2. `api.worktree.remove()` is called immediately (fails — terminals still hold file handles)
3. User sees "Merge Failed" notification despite the PR being successfully merged on GitHub

This leaves the system in an inconsistent state: PR is merged but worktree still exists locally.

## Root Cause

`handleMerge` in `WorktreeItem.tsx:104-121` skips critical cleanup steps that `handleRemoveWorktree` in `Sidebar.tsx:190-220` correctly performs:

| Step | Sidebar (correct) | Merge button (broken) |
|------|-------------------|----------------------|
| Close terminals | Yes (line 202-206) | **Missing** |
| Remove terminals from store | Yes (line 205) | **Missing** |
| Wait 500ms for file handles | Yes (line 209-211) | **Missing** |
| Remove worktree via IPC | Yes (line 213) | Yes (line 115) |
| Remove worktree from store | Yes (line 214) | **Missing** |
| Stop PR polling | N/A | **Missing** |

Additionally, the `useCallback` dependency array at line 121 lists `worktree.path` but the callback body uses `worktree.id` — a stale closure bug.

## Proposed Solution

Align `handleMerge` with `Sidebar.tsx`'s cleanup pattern. Single file change in `WorktreeItem.tsx`.

### Updated `handleMerge` flow:

```
1. Confirm with user
2. Merge PR via IPC (existing)
3. Close all terminals in worktree + remove from Zustand store (NEW)
4. Wait 500ms if terminals were closed (NEW)
5. Remove worktree via IPC (existing)
6. Remove worktree from Zustand store (NEW)
7. Stop PR polling (NEW)
8. Show success notification (existing)
```

### Error handling for partial success:

If merge succeeds (step 2) but worktree removal fails (step 5), show a specific message: "PR merged but worktree removal failed. Remove it manually." This is better than the current generic "Merge Failed" which misleads the user into thinking the PR wasn't merged.

## Acceptance Criteria

- [ ] Merge button successfully removes worktree after merging PR
- [ ] All terminals in the worktree are closed before removal
- [ ] Worktree disappears from sidebar immediately after merge
- [ ] PR polling stops for the removed worktree
- [ ] Partial success (PR merged, worktree removal failed) shows appropriate message
- [ ] Fix stale closure: dependency array includes `worktree.id`

## Implementation

### `src/components/Worktree/WorktreeItem.tsx`

**1. Add store actions** (near existing `useProjectStore` calls, ~line 59):

```typescript
const removeTerminal = useProjectStore((s) => s.removeTerminal)
const removeWorktree = useProjectStore((s) => s.removeWorktree)
```

**2. Replace `handleMerge`** (lines 104-121):

```typescript
const handleMerge = useCallback(async () => {
  if (!prStatus?.number) return
  const confirmed = window.confirm(`Merge & Squash PR #${prStatus.number}?\n\nThis will also remove the worktree.`)
  if (!confirmed) return

  const api = getElectronAPI()
  try {
    // Step 1: Merge PR from main project path
    await api.github.mergePR(projectPath, prStatus.number)

    // Step 2: Close all terminals in worktree (same pattern as Sidebar.tsx)
    const terminalsToClose = terminals.filter((t) => t.state !== 'stopped')
    terminalsToClose.forEach((t) => {
      api.terminal.close(t.id)
      removeTerminal(t.id)
    })

    // Step 3: Wait for Windows file handle release
    if (terminalsToClose.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Step 4: Remove worktree (also deletes local branch)
    try {
      await api.worktree.remove(worktree.id, true)
    } catch (removeErr) {
      // PR was merged but worktree removal failed
      api.notification.show('PR Merged', `PR #${prStatus.number} merged, but worktree removal failed. Remove it manually.`)
      return
    }

    // Step 5: Clean up store state
    removeWorktree(worktree.id)

    // Step 6: Stop PR polling
    api.github.stopPolling(worktree.id)

    api.notification.show('PR Merged', `PR #${prStatus.number} merged and worktree removed`)
  } catch (err) {
    api.notification.show('Merge Failed', err instanceof Error ? err.message : 'Unknown error')
  }
}, [prStatus, projectPath, worktree.id, terminals, removeTerminal, removeWorktree])
```

**Key changes:**
- Close terminals before worktree removal (from `terminals` prop already scoped to this worktree)
- 500ms delay for Windows file handles
- Separate error handling for merge vs worktree removal
- Update Zustand store after removal
- Stop PR polling
- Fix dependency array: `worktree.id` instead of `worktree.path`, add `terminals`, `removeTerminal`, `removeWorktree`

## References

- Correct pattern: `src/components/Sidebar/Sidebar.tsx:190-220` (`handleRemoveWorktree`)
- Broken handler: `src/components/Worktree/WorktreeItem.tsx:104-121` (`handleMerge`)
- IPC handler: `electron/main/index.ts:807-841` (`worktree:remove`)
- Merge service: `electron/main/services/GitHubService.ts:115-168` (`mergePR`)
