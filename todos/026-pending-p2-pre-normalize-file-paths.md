---
status: pending
priority: p2
issue_id: "026"
tags: [code-review, performance, file-watcher]
dependencies: []
---

# Pre-Normalize File Paths to Eliminate Hot-Path Allocations

## Problem Statement

`pathsMatch()` creates two new strings via `replace()` + `toLowerCase()` on every call. In editor and task callbacks, this runs for every event in a batch against each subscriber's file path - creating O(E * subscribers) string allocations per batch (where E = events, up to MAX_BATCH_SIZE=100).

## Findings

**Files:**
- `src/utils/paths.ts:10-13` - `pathsMatch()` allocates 2 strings per call
- `src/components/Editor/CodeEditor.tsx:78` - Called per event per editor tab
- `src/components/FileExplorer/TasksPanel.tsx:52-54` - Called O(E*T) in nested `.some()`

With 20 open editor tabs and a 100-event batch, this creates ~4000 temporary strings.

The watcher already normalizes to forward slashes in `FileWatcherService.ts:44`. Adding `.toLowerCase()` there means renderer can do simple `===` comparison.

## Proposed Solutions

### Option A: Pre-normalize at mount + normalize in watcher (Recommended)
1. Add `.toLowerCase()` to `normalizePath()` in FileWatcherService
2. Pre-normalize `filePath` with `useMemo` in each subscriber
3. Compare with simple `===` instead of `pathsMatch()`

**Pros:** Eliminates all hot-path allocations, simple change
**Cons:** Slight behavior change (all paths lowercase in events)
**Effort:** Small

### Option B: Cache normalized paths in pathsMatch
Memoize last N comparisons in `pathsMatch()`.

**Pros:** No API change
**Cons:** Added complexity, cache management
**Effort:** Medium

## Acceptance Criteria
- [ ] Watcher emits lowercase paths
- [ ] Subscribers pre-normalize their paths once at mount
- [ ] No `pathsMatch()` calls in event handlers (replaced by `===`)
- [ ] TasksPanel uses a `Set` of normalized paths for O(1) lookup
