---
status: pending
priority: p2
issue_id: "052"
tags: [code-review, architecture, type-duplication, automations]
dependencies: []
---

# Import GitEvent in AutomationPersistence instead of redeclaring

## Problem Statement

`AutomationPersistence.ts` redeclares `type GitEvent = 'pr-merged' | 'pr-opened' | 'checks-passed' | 'merge-conflict'` with a "keep in sync" comment, but it runs in the same main process as `GitHubService.ts` where the canonical definition lives. This duplication is unnecessary — unlike the renderer/preload boundary, there is no process isolation between these two files.

## Findings

**Source:** TypeScript Reviewer, Architecture Strategist, Pattern Recognition
**Location:** `electron/main/services/AutomationPersistence.ts` line 10

## Proposed Solutions

### Option A: Import from GitHubService (Recommended)

```typescript
import type { GitEvent } from './GitHubService'
```

Remove the local `type GitEvent = ...` declaration.

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `GitEvent` imported from `GitHubService.ts` in `AutomationPersistence.ts`
- [ ] Local declaration removed
- [ ] Build passes

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-26 | Created | From PR #52 code review |
