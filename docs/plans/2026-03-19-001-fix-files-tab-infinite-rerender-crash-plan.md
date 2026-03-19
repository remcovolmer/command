---
title: "fix: Files tab crash from infinite re-render loop"
type: fix
status: completed
date: 2026-03-19
---

# fix: Files tab crash from infinite re-render loop

## Overview

Clicking the "files" tab in the file explorer causes the app to freeze and become unresponsive. The root cause is an infinite re-render loop in `FileTree.tsx` introduced in commit `17d70b2`.

## Problem Statement

The Zustand selector on `FileTree.tsx:45` returns a new empty object `{}` on every render when `expandedPaths[contextKey]` is `undefined`:

```ts
const expandedPathsMap = useProjectStore((s) => s.expandedPaths[contextKey] ?? {})
```

Because `{} !== {}` (referential inequality), Zustand sees the value as "changed" on every render cycle. This triggers:

1. Re-render → new `{}` → Zustand detects "change" → re-render (loop)
2. The `useEffect` on line ~139 has `expandedPathsMap` in its dependency array, compounding the loop by triggering directory fetches

This only manifests on the files tab because `FileTree` is only mounted when `activeTab === 'files'`.

## Proposed Solution

Define a stable empty object outside the component as a fallback:

```ts
// src/components/FileExplorer/FileTree.tsx
const EMPTY_EXPANDED: Record<string, true> = {}

// Inside component:
const expandedPathsMap = useProjectStore(
  (s) => s.expandedPaths[contextKey] ?? EMPTY_EXPANDED
)
```

This returns the same reference every time the map is empty, so Zustand's default `Object.is` check passes. No re-render triggered.

**Why not `useShallow`?** A stable fallback is simpler, zero-overhead, and the standard Zustand pattern for this exact scenario. `useShallow` adds unnecessary comparison cost.

## Acceptance Criteria

- [ ] Clicking the files tab no longer freezes the app
- [ ] Projects/worktrees that have never expanded a folder work correctly
- [ ] Previously expanded folders still show as expanded after switching tabs
- [ ] File watcher refresh still works for expanded directories

## Files to Change

| File | Change |
|------|--------|
| `src/components/FileExplorer/FileTree.tsx:45` | Replace `?? {}` with `?? EMPTY_EXPANDED` using a module-level constant |

## Sources

- **Introduced by:** commit `17d70b2` — feat(file-explorer): show worktree files and fix refresh for expanded folders (#84)
- **Related learning:** `docs/solutions/ui-bugs/file-explorer-worktree-awareness.md` — documents the `expandedPaths` type change from `string[]` to `Record<string, true>` that set up this bug
- **Related learning:** `docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md` — previous app freeze caused by file watchers (different root cause)
