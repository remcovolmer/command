# File Explorer: Worktree Support & Auto-Refresh

**Date:** 2026-03-17
**Status:** Brainstorm complete

## What We're Building

Three improvements to the file explorer to make it worktree-aware and reliably reactive:

1. **Worktree-aware file listing** — When the active terminal is scoped to a worktree, the file explorer shows that worktree's files instead of the project root.
2. **Real-time auto-refresh** — File changes are reflected immediately via chokidar watching, no manual refresh needed.
3. **Fix manual refresh** — When refresh is clicked, expanded folders actually reload their contents instead of requiring collapse/expand.

## Why This Approach

The file explorer already correctly determines the active worktree (via `activeTerminal.worktreeId`), but never passes that context to FileTree. The fix is surgical: thread the worktree path through to FileTree and the file watcher.

Auto-refresh via chokidar is already the pattern used by FileWatcherService — we extend it to watch the active context path (worktree or project root) and properly invalidate expanded directories.

## Key Decisions

### 1. Worktree switching: Automatic
File explorer follows the active terminal. If a worktree-scoped terminal is selected, files switch to that worktree's path. Normal terminal selected = project root files.

**Rationale:** The file explorer should always show what's relevant to the active context. No manual toggle needed.

### 2. Refresh mechanism: Real-time via file watcher
Chokidar watches the active root path (project or worktree). File changes trigger immediate cache invalidation and UI update for affected directories.

**Rationale:** Already the established pattern in the codebase. More responsive than polling.

### 3. Expanded state: Per worktree
Each worktree (and project root) maintains its own expanded folder state. Switching back restores the previous view.

**Rationale:** Avoids disorientation when switching contexts. The `expandedPaths` store key changes from `projectId` to `projectId:worktreeId` (or `projectId:root`).

## Current Architecture (Problems)

| Component | Current Behavior | Problem |
|-----------|-----------------|---------|
| `FileExplorer.tsx` | Derives `activeWorktree` correctly, but passes only `project` to FileTree | Worktree path never reaches file listing |
| `FileTree.tsx` | Always uses `project.path` for `fs.readDirectory` | Shows wrong files for worktree terminals |
| `FileWatcherService.ts` | Watches only `projectPath` | Worktree file changes not detected |
| `expandedPaths` store | Keyed by `projectId` | Same expanded state shared between root and all worktrees |
| Manual refresh | Clears `directoryCache` | Expanded folders don't re-fetch on next render |

## Proposed Changes (High Level)

1. **FileExplorer.tsx** — Pass `rootPath` (worktree path or project path) to FileTree
2. **FileTree.tsx** — Use `rootPath` instead of `project.path` for all file operations
3. **FileWatcherService.ts** — Accept worktree paths for watching; switch watched path when context changes
4. **projectStore.ts** — Key `expandedPaths` by `projectId:contextId`; fix cache invalidation to trigger re-fetch of expanded dirs
5. **Refresh handler** — After clearing cache, explicitly re-fetch all currently expanded directories

## Scope Boundaries

**In scope:**
- Worktree-aware file listing
- Auto-refresh via file watcher for active context
- Fix manual refresh for expanded folders
- Per-worktree expanded state

**Out of scope:**
- Multi-root file explorer (showing multiple worktrees simultaneously)
- File explorer search/filter improvements
- Drag-and-drop between worktrees
