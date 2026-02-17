---
status: pending
priority: p2
issue_id: "032"
tags: [code-review, bug, file-explorer, file-watcher]
dependencies: []
---

# FileTree Cache Refresh After Invalidation Is Dead Code

## Problem Statement

In FileTree.tsx, after invalidating a directory from the cache, the code checks if the directory was in the cache to decide whether to refresh it. But since `invalidateDirectory` synchronously removes the entry via Zustand `set()`, the subsequent `getState()` call always returns a cache without that entry. The "refresh if visible" logic never executes.

## Findings

**File:** `src/components/FileExplorer/FileTree.tsx:57-67`

```typescript
for (const dir of invalidatedDirs) {
  invalidateDirectory(dir)                              // removes from cache (sync)
  invalidateDirectory(dir.replace(/\//g, '\\'))
  const { directoryCache } = useProjectStore.getState() // always missing the entry
  if (directoryCache[dir] || ...)                       // always false
    refreshDirectory(refreshPath)                        // never called
}
```

This means visible directories are invalidated but never re-fetched until the user manually collapses and re-expands them.

## Proposed Solutions

### Option A: Check cache BEFORE invalidating (Recommended)
Capture the set of visible directories first, then invalidate, then refresh the ones that were visible.

```typescript
const { directoryCache } = useProjectStore.getState()
const visibleDirs = new Set<string>()
for (const dir of invalidatedDirs) {
  if (directoryCache[dir] || directoryCache[dir.replace(/\//g, '\\')]) {
    visibleDirs.add(directoryCache[dir] ? dir : dir.replace(/\//g, '\\'))
  }
  invalidateDirectory(dir)
  invalidateDirectory(dir.replace(/\//g, '\\'))
}
for (const dir of visibleDirs) {
  refreshDirectory(dir)
}
```

**Pros:** Fixes the bug, visible directories auto-refresh
**Cons:** None
**Effort:** Small

## Acceptance Criteria
- [ ] Visible directories refresh automatically when files are added/removed
- [ ] File tree updates without manual collapse/expand after external changes
