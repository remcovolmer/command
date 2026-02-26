---
status: pending
priority: p3
issue_id: "061"
tags: [code-review, testing, automations]
dependencies: []
---

# Add unit tests for template replacement and merge-conflict detection

## Problem Statement

The automation subsystem has zero unit tests. The new template replacement logic, merge-conflict detection, and worktree fallback behavior are all untested. This is inherited tech debt, but the new code paths would benefit significantly from coverage.

## Findings

**Source:** Architecture Strategist (Priority 3)
**Location:** Test files needed for:
- `electron/main/services/AutomationService.ts` (template replacement in `triggerRun`)
- `electron/main/services/GitHubService.ts` (merge-conflict transition detection in `pollOnce`)
- `electron/main/services/AutomationRunner.ts` (source branch worktree fallback)

## Proposed Solutions

### Option A: Unit tests for new code paths

Test cases:
1. Template replacement with full context
2. Template replacement with partial context (missing fields)
3. Template replacement without context (manual trigger)
4. Typo in template variable (`{{pr.titl}}`) — verify stripped
5. Merge-conflict detection: non-CONFLICTING → CONFLICTING fires event
6. Merge-conflict detection: CONFLICTING → CONFLICTING does NOT fire again
7. Source branch fallback when branch deleted

**Effort:** Medium | **Risk:** Low

## Acceptance Criteria

- [ ] Tests exist for template replacement (with/without/partial context)
- [ ] Tests exist for merge-conflict state transition detection
- [ ] All tests pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-26 | Created | From PR #52 code review |
