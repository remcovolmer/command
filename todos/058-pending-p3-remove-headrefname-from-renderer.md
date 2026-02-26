---
status: pending
priority: p3
issue_id: "058"
tags: [code-review, yagni, type-duplication]
dependencies: []
---

# Remove headRefName from renderer and preload PRStatus types

## Problem Statement

`headRefName` was added to `PRStatus` in 3 locations (GitHubService, preload, renderer types), but only `GitHubService.ts` consumes it (in `buildContext`). No renderer code reads `headRefName`. This is a YAGNI violation — exposing an internal detail to the renderer that nothing uses.

## Findings

**Source:** Code Simplicity Reviewer
**Locations:**
- `electron/preload/index.ts` line 185 — remove `headRefName?: string`
- `src/types/index.ts` line 189 — remove `headRefName?: string`

## Proposed Solutions

### Option A: Remove from preload and renderer (Recommended)

Keep `headRefName` only in `GitHubService.ts` where it is consumed. Remove from preload and renderer `PRStatus` types.

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `headRefName` removed from `electron/preload/index.ts` PRStatus
- [ ] `headRefName` removed from `src/types/index.ts` PRStatus
- [ ] Build passes

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-26 | Created | From PR #52 code review |
