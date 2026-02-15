---
status: complete
priority: p3
issue_id: "022"
tags: [code-review, architecture, dry]
dependencies: []
---

# Duplicate worktree cleanup pattern across components

## Problem Statement

The terminal-close + wait + worktree-remove cleanup sequence is now duplicated between two components. If the cleanup logic changes (e.g., different delay, additional steps), both locations must be updated.

## Findings

**Location 1:** `src/components/Sidebar/Sidebar.tsx:201-214` (handleRemoveWorktree)
**Location 2:** `src/components/Worktree/WorktreeItem.tsx:116-138` (handleMerge)

Both follow the same pattern:
1. Filter terminals to close
2. Close each terminal via IPC + remove from store
3. Wait 500ms if terminals were closed
4. Remove worktree via IPC
5. Remove worktree from store

Minor differences:
- Sidebar filters by `worktreeId`, WorktreeItem filters by `state !== 'stopped'` (already scoped)
- Sidebar checks for uncommitted changes first
- WorktreeItem handles partial success (merge succeeded, removal failed)
- WorktreeItem also stops PR polling

## Proposed Solutions

### Option A: Accept duplication (Recommended for now)
The two call sites have different contexts (remove-only vs. merge-then-remove) with different error handling needs. Extracting a shared utility would add abstraction complexity for only 2 call sites.
- **Effort:** None
- **Risk:** Low (divergence risk is manageable)

### Option B: Extract shared cleanup utility
Create a `cleanupWorktree(worktreeId, terminals)` utility function in a shared module.
- **Effort:** Medium
- **Risk:** Low, but may over-abstract given different error handling needs

## Acceptance Criteria
- [ ] Document this pattern so future worktree removal code paths follow the same sequence
