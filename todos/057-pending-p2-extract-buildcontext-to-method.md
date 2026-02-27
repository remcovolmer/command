---
status: pending
priority: p2
issue_id: "057"
tags: [code-review, quality, readability, github-service]
dependencies: []
---

# Extract buildContext from pollOnce closure to class method

## Problem Statement

`buildContext()` is defined as a const arrow function inside `pollOnce()`, recreated every poll cycle (every 60s per project). It is a pure function with no closure dependencies — it only uses its parameter. Should be a private method on the class for cleaner separation.

## Findings

**Source:** Architecture Strategist, Code Simplicity Reviewer
**Location:** `electron/main/services/GitHubService.ts` lines 286-296

## Proposed Solutions

### Option A: Private method (Recommended)

```typescript
private buildPREventContext(status: PRStatus): PREventContext | null {
  if (status.number == null) return null
  return {
    number: status.number,
    title: status.title ?? '',
    branch: status.headRefName ?? '',
    url: status.url ?? '',
    mergeable: status.mergeable ?? 'UNKNOWN',
    state: status.state ?? 'OPEN',
  }
}
```

**Effort:** Small | **Risk:** Low

### Option B: Use `clamp()` for cooldown (additional)

In `validateTrigger()`, replace `Math.max(10, Math.min(3600, ...))` with `clamp(obj.cooldownSeconds, 10, 3600)` for consistency.

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `buildContext` extracted to `private buildPREventContext()`
- [ ] `pollOnce` calls `this.buildPREventContext()` instead
- [ ] Build passes

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-26 | Created | From PR #52 code review |
