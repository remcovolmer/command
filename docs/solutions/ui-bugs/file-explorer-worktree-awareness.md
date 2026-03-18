---
title: Fix file explorer to show worktree-scoped files with independent folder expansion state
category: ui-bugs
date: 2026-03-18
tags: [file-explorer, worktree, state-management, performance, zustand, persist-migration]
components: [FileExplorer.tsx, FileTree.tsx, FileTreeNode.tsx, FileExplorerTabBar.tsx, DeleteConfirmDialog.tsx, projectStore.ts]
severity: medium
pr: 84
branch: fix/files-shown
---

# File Explorer Worktree Awareness

## Problem

The file explorer in Command Center exhibited three interconnected issues:

1. **Wrong files shown**: File tree always displayed project root files, even when a worktree terminal was active. Users expected to see files from the worktree directory.
2. **Broken refresh**: The refresh button only reloaded the root directory. Expanded subdirectories kept stale cached content.
3. **Shared expanded state**: `expandedPaths` was keyed by project ID only. Switching between worktrees reset folder expansion, forcing users to re-expand folders.

A fourth issue was discovered during code review:

4. **O(n) selector lookups**: `expandedPaths` stored as `string[]` meant `Array.includes()` ran inside Zustand selectors on every state change — O(n) per node per render.

## Root Cause

- `FileTree` was hardcoded to use `project.path` as root, ignoring worktree context derived from the active terminal.
- `clearDirectoryCache` only knew about project paths, not worktree paths.
- No mechanism existed to re-fetch expanded directories after a manual refresh — only root was reloaded.
- `expandedPaths: Record<string, string[]>` used `.includes()` for membership checks in render-hot selectors.

## Solution

### 1. Worktree-aware context threading

`FileExplorer` derives the active worktree from the active terminal's `worktreeId`, then computes:

```typescript
const fileTreeRootPath = activeWorktree?.path ?? activeProject?.path
const fileTreeContextKey = activeWorktree?.id ?? activeProjectId
```

These flow as props to `FileTree`, `FileTreeNode`, and `DeleteConfirmDialog`. The `contextKey` pattern (`worktreeId ?? projectId`) ensures all state is scoped correctly.

### 2. O(1) expanded path lookups

Changed store type from array to object-as-set:

```typescript
// Before
expandedPaths: Record<string, string[]>
// Selector: s.expandedPaths[contextKey]?.includes(entry.path)

// After
expandedPaths: Record<string, Record<string, true>>
// Selector: !!(s.expandedPaths[contextKey]?.[entry.path])
```

All consumers updated: `toggleExpandedPath`, `updateExpandedPathsAfterRename`, `cleanupAfterDelete`.

### 3. Parallel directory refresh

Added `directoryCacheVersion` counter. `FileTree` watches this and re-fetches root + all expanded dirs in parallel:

```typescript
// Before: sequential
for (const dir of expandedPaths) {
  const entries = await api.fs.readDirectory(dir)
  setDirectoryContents(dir, entries)
}

// After: parallel
await Promise.all(Object.keys(expandedPathsMap).map(async (dir) => {
  try {
    const dirEntries = await api.fs.readDirectory(dir)
    setDirectoryContents(dir, dirEntries)
  } catch { /* directory may no longer exist */ }
}))
```

### 4. Persist migration guard

Old persisted `string[]` format auto-converts on rehydration:

```typescript
onRehydrateStorage: () => (state, error) => {
  if (state?.expandedPaths) {
    for (const [key, val] of Object.entries(state.expandedPaths)) {
      if (Array.isArray(val)) {
        const migrated: Record<string, true> = {}
        for (const p of val) migrated[p] = true
        state.expandedPaths[key] = migrated
      }
    }
  }
}
```

### 5. Tab bar branch indicator

`FileExplorerTabBar` shows `Files · feature/login-flow` when viewing a worktree, providing visual confirmation of context.

### 6. Cleanup on worktree removal

When a worktree is removed, its `expandedPaths[worktreeId]` entry is deleted along with related `directoryCache` entries.

## Prevention Strategies

### Use O(1) data structures in hot selectors

If a Zustand selector checks membership ("is X in this collection?"), use `Record<string, true>` instead of `string[]`. Selectors re-run on every state change — O(n) compounds silently.

### Thread context from context-aware parents

When a feature works in multiple contexts (project root vs worktree), derive context at the top-level component and pass `rootPath`/`contextKey` down. Don't compute context in leaf components.

### Refresh all visible state, not just root

When implementing refresh, audit what's loaded and visible. Expanded subdirectories, open tabs, and cached sub-resources all need refreshing — not just the top-level entry.

### Always migrate persisted store shapes

When changing Zustand persist shapes, add migration guards in `onRehydrateStorage`. Check for old formats and transform in-place. Five lines of migration prevent broken UI after updates.

### Parallelize independent IPC calls

Use `Promise.all()` for independent IPC calls. Sequential `await` in loops adds `latency x count` overhead. Parallel reduces to ~single-call latency.

## Related Documentation

- [Brainstorm: File Explorer Worktree](../../brainstorms/2026-03-17-file-explorer-worktree-brainstorm.md) — Original problem analysis and design decisions
- [Plan: Worktree-Aware File Explorer](../../plans/2026-03-17-001-feat-file-explorer-worktree-aware-plan.md) — Four-phase implementation plan
- [FileWatcher Memory Optimization](../performance-issues/filewatcher-memory-leak-chokidar-startup.md) — File watcher patterns that auto-refresh depends on
- [EBUSY Worktree Removal](../runtime-errors/ebusy-worktree-removal-terminal-handles.md) — Worktree lifecycle management
