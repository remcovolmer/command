---
status: pending
priority: p3
issue_id: "030"
tags: [code-review, simplicity, cleanup, file-watcher]
dependencies: []
---

# File Watcher Code Simplifications

## Problem Statement

Three quick simplification opportunities identified by code simplicity review. All are minor but improve readability and reduce ~25 LOC.

## Findings

### 1. `FILE_WATCH_EVENT_TYPES` const array is dead code
**File:** `src/types/index.ts:89-95`

The const array is exported but never imported anywhere. Only the derived type `FileWatchEventType` is used. Replace with a simple type union:

```typescript
// Before (7 lines):
export const FILE_WATCH_EVENT_TYPES = ['file-added', ...] as const
export type FileWatchEventType = typeof FILE_WATCH_EVENT_TYPES[number]

// After (1 line):
export type FileWatchEventType = 'file-added' | 'file-changed' | 'file-removed' | 'dir-added' | 'dir-removed'
```

### 2. CodeEditor duplicated reload logic
**File:** `src/components/Editor/CodeEditor.tsx:80-121`

The `file-changed` and `file-added` handlers both do: readFile, setValue, preserveCursor, resetDirty. ~30 lines of near-identical code. Extract a `reloadFile()` helper.

### 3. FileTree path separator juggling at call site
**File:** `src/components/FileExplorer/FileTree.tsx:57-66`

The code invalidates with both `/` and `\` separators and does double cache lookups. Move normalization into `invalidateDirectory` in the store instead.

## Acceptance Criteria
- [ ] `FILE_WATCH_EVENT_TYPES` const array removed, replaced with type union
- [ ] CodeEditor has extracted `reloadFile()` helper
- [ ] `invalidateDirectory` normalizes paths internally
