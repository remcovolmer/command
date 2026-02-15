---
status: complete
priority: p2
issue_id: "021"
tags: [code-review, quality, error-handling]
dependencies: []
---

# Silenced error in worktree removal catch block

## Problem Statement

In `handleMerge`, the inner try/catch for `api.worktree.remove()` discards the error without logging it. This makes debugging production issues harder when worktree removal fails after a successful merge.

## Findings

**File:** `src/components/Worktree/WorktreeItem.tsx:129-134`

```typescript
try {
  await api.worktree.remove(worktree.id, true)
} catch {
  api.notification.show('PR Merged', `PR #${prStatus.number} merged, but worktree removal failed. Remove it manually.`)
  return
}
```

The `catch` block doesn't capture or log the error. The user sees a helpful notification, but developers have no way to diagnose why the removal failed (EBUSY? permission? missing path?).

Compare with Sidebar.tsx:215-218 which logs errors:
```typescript
} catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to remove worktree'
  console.error('Failed to remove worktree:', error)
```

## Proposed Solutions

### Option A: Add console.error + stopPolling (Recommended)
```typescript
} catch (err) {
  console.error('[WorktreeItem] Worktree removal failed after merge:', err)
  api.github.stopPolling(worktree.id)
  api.notification.show('PR Merged', `PR #${prStatus.number} merged, but worktree removal failed. Remove it manually.`)
  return
}
```
- **Pros:** Minimal change, consistent with codebase logging patterns, stops wasted polling
- **Cons:** None
- **Effort:** Small
- **Risk:** None

**Note:** The early `return` also skips `api.github.stopPolling()`. Since the PR is already merged, continued polling is a resource leak (harmless but wasteful).

## Acceptance Criteria
- [ ] Error is logged to console when worktree removal fails
- [ ] PR polling stops even on partial failure (PR merged, worktree removal failed)
- [ ] User-facing notification still shows the helpful partial-success message
