---
title: "fix: Parse file paths correctly from git status --porcelain=v2 -z output"
type: fix
status: completed
date: 2026-03-31
---

# fix: Parse file paths correctly from git status --porcelain=v2 -z output

## Overview

The Git tab shows raw `git status --porcelain=v2` metadata lines (e.g., `1 .M N... 100644 100644 100644 bfcdef9cb5...`) instead of actual file names for modified, staged, renamed, and conflicted files. Untracked files display correctly.

## Problem Frame

`GitService.parseStatusV2Output()` splits output by NUL bytes and assumes that for ordinary (`1`), rename (`2`), and unmerged (`u`) entries, the file path lives in the **next** NUL-separated part. In reality, with `--porcelain=v2 -z`, the file path is the **last space-separated field within the same NUL-terminated entry**. The `parts[++i]` call grabs the next entry entirely, which is displayed as the "file name."

**Entry formats with `-z`:**

| Type | Format (NUL-terminated) | Path field index |
|------|------------------------|-----------------|
| `1` (ordinary) | `1 XY sub mH mI mW hH hI <path>\0` | 8+ (join for spaces) |
| `2` (rename) | `2 XY sub mH mI mW hH hI Xscore <path>\0<origPath>\0` | 9+ (origPath is next NUL part) |
| `u` (unmerged) | `u XY sub m1 m2 m3 mW h1 h2 h3 <path>\0` | 10+ (join for spaces) |
| `?` (untracked) | `? <path>\0` | Already correct via `part.slice(2)` |

Paths can contain spaces, so we must join all fields from the path index onward.

## Requirements Trace

- R1. Modified, staged, renamed, and conflicted files must show their actual file name in the Git tab
- R2. Files with spaces in their paths must display correctly
- R3. Untracked file parsing must remain correct (it already works)

## Scope Boundaries

- Only fixing the `parseStatusV2Output()` method in `GitService.ts`
- Not changing the git command flags or the UI display layer

## Context & Research

### Relevant Code and Patterns

- `electron/main/services/GitService.ts:parseStatusV2Output()` (lines 171-278) — the parser
- `electron/main/services/GitService.ts:getStatus()` (lines 116-169) — calls `git status --porcelain=v2 --branch -z`
- Untracked parsing at line 218 (`part.slice(2)`) is correct and should stay as-is

## Key Technical Decisions

- **Extract path by field index, not by NUL part increment**: For each entry type, split by space and join fields from the known path index onward. This handles paths with spaces correctly.
- **Remove `parts[++i]` for types 1 and u**: These types don't have a second NUL-separated part — the path is embedded in the current part.
- **Keep `parts[++i]` for type 2 only**: Rename entries have the original path as a separate NUL part, so one `++i` is still needed — but only to skip the origPath, not to get the new path.

## Implementation Units

- [x] **Unit 1: Fix path extraction in parseStatusV2Output()**

**Goal:** Extract file paths from the correct position within each NUL-terminated entry

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `electron/main/services/GitService.ts`
- Test: `test/gitService.test.ts` (create if absent, or add to existing test file)

**Approach:**
- For type `1` entries: split part by spaces, join fields from index 8+ as the path. Remove `parts[++i]`.
- For type `2` entries: split part by spaces, join fields from index 9+ as the path. Keep one `parts[++i]` to skip the origPath.
- For type `u` entries: split part by spaces, join fields from index 10+ as the path. Remove `parts[++i]`.
- Leave type `?` parsing unchanged.

**Patterns to follow:**
- The existing `part.slice(2)` pattern for untracked files is a simpler version of the same idea

**Test scenarios:**
- Happy path: Ordinary modified file (`1 .M N... 100644 100644 100644 <hash> <hash> src/file.ts`) → path = `src/file.ts`
- Happy path: Staged added file (`1 A. N... 000000 100644 100644 <hash> <hash> new-file.ts`) → path = `new-file.ts`, in staged array
- Happy path: Renamed file — NUL-split parts: [`2 R. N... 100644 100644 100644 <hash> <hash> R100 new.ts`, `old.ts`] → path = `new.ts` (field 9+ of first part), origPath `old.ts` consumed via `++i`
- Happy path: Unmerged file (`u UU N... 100644 100644 100644 100644 <hashes> conflicted.ts`) → path = `conflicted.ts`
- Edge case: File path with spaces (`1 .M N... 100644 100644 100644 <hash> <hash> path/to my/file name.ts`) → path = `path/to my/file name.ts`
- Happy path: Untracked file parsing still works (`? untracked.ts`) → path = `untracked.ts`
- Integration: Full multi-entry output with mixed types parses all entries correctly and doesn't consume adjacent entries

**Verification:**
- `npm run test` passes
- Git tab in the app shows actual file names for all change types

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Paths with spaces could break naive splitting | Join all fields from path index onward, not just take the last field |
| Rename entry has two NUL parts (new + orig) | Keep one `++i` for type 2 to consume origPath |
