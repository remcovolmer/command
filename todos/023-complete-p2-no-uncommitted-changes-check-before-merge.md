---
status: complete
priority: p2
issue_id: "023"
tags: [code-review, security, data-loss, ux]
dependencies: []
---

# No uncommitted changes check before merge+removal

## Problem Statement

`handleMerge` in `WorktreeItem.tsx` merges the PR and force-removes the worktree without checking `api.worktree.hasChanges()` first. If a user has uncommitted local changes (WIP code, config tweaks, local-only files), those are silently destroyed after merge.

## Findings

**File:** `src/components/Worktree/WorktreeItem.tsx:106-144`

The merge flow:
1. Generic `window.confirm()` - no mention of uncommitted changes
2. `api.github.mergePR()` - merges PR (irreversible)
3. Close terminals
4. `api.worktree.remove(worktree.id, true)` - **always** force=true

Compare with `Sidebar.tsx:190-199` which properly checks:
```typescript
const hasChanges = await api.worktree.hasChanges(worktreeId)
if (hasChanges) {
  const confirmed = window.confirm('This worktree has uncommitted changes...')
  if (!confirmed) return
}
```

Additionally, `force=true` is hardcoded, bypassing git's built-in safety check. Sidebar.tsx passes `hasChanges` as the force flag.

## Proposed Solutions

### Option A: Add hasChanges check + conditional force (Recommended)
```typescript
const api = getElectronAPI()
const hasChanges = await api.worktree.hasChanges(worktree.id)
const message = hasChanges
  ? `Merge & Squash PR #${prStatus.number}?\n\nWARNING: This worktree has uncommitted changes that will be lost.\n\nThis will also remove the worktree.`
  : `Merge & Squash PR #${prStatus.number}?\n\nThis will also remove the worktree.`
const confirmed = window.confirm(message)
if (!confirmed) return

// ... merge, cleanup ...
await api.worktree.remove(worktree.id, hasChanges)  // force only when user confirmed
```
- **Pros:** Matches Sidebar.tsx pattern, warns user explicitly, preserves git safety
- **Cons:** Adds one IPC call before merge
- **Effort:** Small
- **Risk:** None

## Acceptance Criteria
- [ ] `hasChanges` check runs before merge confirmation dialog
- [ ] Confirm dialog warns explicitly if uncommitted changes exist
- [ ] `force` parameter is conditional (true only when hasChanges)
- [ ] No data loss when user cancels after seeing uncommitted changes warning
