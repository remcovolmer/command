---
title: "feat: Make file explorer worktree-aware with auto-refresh"
type: feat
status: completed
date: 2026-03-17
origin: docs/brainstorms/2026-03-17-file-explorer-worktree-brainstorm.md
---

# feat: Make file explorer worktree-aware with auto-refresh

## Overview

The file explorer always shows project root files, even when the active terminal is scoped to a worktree. Manual refresh doesn't reload expanded folders. This plan fixes three issues: worktree-aware file listing, reliable refresh, and per-worktree expanded state.

## Problem Statement

1. **Wrong files shown** — `FileTree` hardcodes `project.path` as root. Worktree context from `activeWorktree` in `FileExplorer` is never passed down.
2. **Refresh broken** — `clearDirectoryCache` clears the cache, but expanded folders don't re-fetch on next render because they only load when first expanded.
3. **Shared expanded state** — `expandedPaths` keyed by `projectId` means all worktrees share the same expanded folders.

## Proposed Solution

Thread `rootPath` and `contextKey` from `FileExplorer` through `FileTree` and `FileTreeNode`. Fix cache invalidation to trigger re-fetches. Key expanded state per worktree context.

**Key simplification:** Worktrees live at `<projectPath>/.worktrees/<name>/`, which is inside the project directory. The chokidar watcher already covers these paths. No watcher changes needed — auto-refresh works out of the box once FileTree uses the correct root path.

## Implementation Phases

### Phase 1: Thread worktree root path through FileTree

**Files:** `FileExplorer.tsx`, `FileTree.tsx`, `FileTreeNode.tsx`

1. **`FileExplorer.tsx`** — Compute `rootPath` and `contextKey`:
   ```typescript
   const rootPath = activeWorktree?.path ?? activeProject.path
   const contextKey = activeWorktree?.id ?? activeProject.id
   ```
   Pass both to `<FileTree rootPath={rootPath} contextKey={contextKey} project={activeProject} />`

2. **`FileTree.tsx`** — Accept `rootPath` and `contextKey` props. Replace all `project.path` references with `rootPath` and all `project.id` references for expanded state with `contextKey`:
   - Line 29: `directoryCache[rootPath]` instead of `directoryCache[project.path]`
   - Line 30: `expandedPaths[contextKey]` instead of `expandedPaths[project.id]`
   - Line 92: `api.fs.readDirectory(rootPath)` instead of `api.fs.readDirectory(project.path)`
   - Line 87: `loadedRef` tracks `rootPath`

3. **`FileTreeNode.tsx`** — Accept `contextKey` prop. Use it for `expandedPaths` lookups and `toggleExpandedPath` calls instead of `projectId`.

4. **Context menu / RootCreateEntry** — Use `rootPath` for new file/folder creation instead of `project.path`.

### Phase 2: Fix manual refresh for expanded folders

**Files:** `projectStore.ts`, `FileTree.tsx`

1. **`projectStore.ts`** — Update `clearDirectoryCache` to accept a `rootPath` parameter:
   ```typescript
   clearDirectoryCache: (projectId: string, rootPath?: string) => {
     const path = rootPath ?? projects[projectId]?.path
     // Clear entries starting with path
     // Increment a cacheVersion counter to trigger re-renders
   }
   ```
   Add a `cacheVersion: number` field that increments on clear. FileTree subscribes to this to know when to re-fetch.

2. **`FileTree.tsx`** — When `cacheVersion` changes, re-fetch ALL currently expanded directories (not just the root). Use `expandedPaths[contextKey]` to know which dirs to reload:
   ```typescript
   useEffect(() => {
     // Re-fetch root
     loadDirectory(rootPath)
     // Re-fetch all expanded paths
     expandedPaths.forEach(p => loadDirectory(p))
   }, [cacheVersion])
   ```

3. **`FileExplorer.tsx`** — Pass `rootPath` to `clearDirectoryCache`:
   ```typescript
   const handleFilesRefresh = () => {
     if (activeProjectId) {
       clearDirectoryCache(activeProjectId, rootPath)
     }
   }
   ```

### Phase 3: Per-worktree expanded state

**Files:** `projectStore.ts`, `FileTreeNode.tsx`

1. **`expandedPaths`** already keyed by string — just use `contextKey` (worktreeId or projectId) instead of `projectId`. No schema migration needed since the key format doesn't change, just the key value.

2. **`toggleExpandedPath`** — Already takes `(key, path)`. Callers just need to pass `contextKey` instead of `projectId`. No store changes needed.

3. **Cleanup** — When a worktree is deleted, remove its `expandedPaths[worktreeId]` entry. Add to existing worktree removal logic in store.

### Phase 4: Visual indicator

**Files:** `FileExplorer.tsx`

1. Show worktree name/branch in the file explorer header when viewing a worktree. Small breadcrumb or label next to the "Files" tab header:
   ```
   Files · feature/login-flow
   ```

## Acceptance Criteria

- [x] File explorer shows worktree files when active terminal is scoped to a worktree
- [x] File explorer switches back to project root when selecting a non-worktree terminal
- [x] Refresh button reloads all expanded folders (not just root)
- [x] Each worktree has independent expanded folder state
- [x] Switching between worktrees restores previous expanded state
- [x] File creation via context menu creates files in the correct root (worktree or project)
- [x] Worktree name visible in file explorer when viewing worktree files
- [x] Auto-refresh works for file changes in worktree directories

## Edge Cases

- **No active terminal** — Fall back to `project.path` (current behavior)
- **Worktree deleted externally** — Terminal loses worktree reference → falls back to project root
- **Rapid terminal switching** — `rootPath` change triggers re-render; stale in-flight loads are guarded by `loadedRef` tracking current `rootPath`
- **Existing persisted expandedPaths** — Still works: entries keyed by `projectId` apply when no worktree is active

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-17-file-explorer-worktree-brainstorm.md](docs/brainstorms/2026-03-17-file-explorer-worktree-brainstorm.md) — auto-switch, real-time refresh, per-worktree expanded state
- Key files: `FileExplorer.tsx:29-34`, `FileTree.tsx:29,92`, `FileTreeNode.tsx:31`, `projectStore.ts:726`
- Pattern: `contextKey = worktreeId ?? projectId` (matches existing `sidecarContextKey` and `gitContextId` patterns)
