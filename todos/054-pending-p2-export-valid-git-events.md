---
status: pending
priority: p2
issue_id: "054"
tags: [code-review, architecture, type-duplication, automations]
dependencies: ["052"]
---

# Export VALID_GIT_EVENTS from GitHubService

## Problem Statement

`VALID_GIT_EVENTS` array is declared in `electron/main/index.ts` as a fourth sync point for git event values. Since `index.ts` already imports `GitEvent` from `GitHubService.ts`, the array should be co-located with and exported from `GitHubService.ts` to reduce manual sync locations.

## Findings

**Source:** Architecture Strategist, TypeScript Reviewer
**Location:** `electron/main/index.ts` line 39

## Proposed Solutions

### Option A: Export from GitHubService (Recommended)

In `GitHubService.ts`:
```typescript
export const VALID_GIT_EVENTS: GitEvent[] = ['pr-merged', 'pr-opened', 'checks-passed', 'merge-conflict']
```

In `index.ts`:
```typescript
import { GitHubService, type GitEvent, VALID_GIT_EVENTS } from './services/GitHubService'
```

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `VALID_GIT_EVENTS` defined in `GitHubService.ts` next to `GitEvent`
- [ ] `index.ts` imports it instead of redeclaring
- [ ] Build passes

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-26 | Created | From PR #52 code review |
