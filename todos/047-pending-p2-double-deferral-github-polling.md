---
status: complete
priority: p2
issue_id: "047"
tags: [code-review, simplicity, github]
dependencies: []
---

# Remove double deferral in GitHub polling

## Problem Statement

GitHub polling has two stacked deferral mechanisms: a fixed 3-second delay in `WorktreeItem.tsx` AND a 1-4 second random jitter in `GitHubService.startPolling()`. The first poll happens 4-7 seconds after mount. Either mechanism alone is sufficient.

## Findings

**Files:**
- `src/components/Worktree/WorktreeItem.tsx:81` — `setTimeout(..., 3000)`
- `electron/main/services/GitHubService.ts:175` — `Math.floor(Math.random() * 4000) + 1000`

**Source:** Code-simplicity-reviewer (only actionable finding).

## Proposed Solutions

### Option A: Keep only the jitter in GitHubService (Recommended)

Remove the 3s setTimeout from WorktreeItem and let GitHubService handle deferral with its 1-5s jitter. The jitter alone prevents thundering herd and defers past PTY startup.

**Pros:** Single mechanism, simpler code, jitter provides better spread
**Cons:** First poll slightly earlier (1-5s instead of 4-8s)
**Effort:** Small
**Risk:** Low

### Option B: Keep only the WorktreeItem delay

Remove jitter from GitHubService, keep fixed 3s delay. Revert GitHubService to immediate `pollOnce()`.

**Pros:** Deterministic timing
**Cons:** All worktrees still poll simultaneously (thundering herd returns)
**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [ ] Only one deferral mechanism exists
- [ ] First GitHub poll happens 1-5 seconds after mount
- [ ] Multiple worktrees don't spawn `gh` processes simultaneously

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | When adding deferral at two layers, pick one |
| 2026-02-23 | Implemented Option A: removed 3s setTimeout from WorktreeItem, kept GitHubService jitter | Single deferral mechanism is sufficient |
