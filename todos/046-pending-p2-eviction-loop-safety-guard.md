---
status: complete
priority: p2
issue_id: "046"
tags: [code-review, robustness, terminal-pool]
dependencies: []
---

# Add safety guard to eviction while-loop

## Problem Statement

The `while (terminalPool.needsEviction())` loop in `useTerminalPool` has no upper bound. If `evict()` succeeds but the candidate somehow remains in the active count (a bug), this would infinite-loop and freeze the UI.

## Findings

**File:** `src/hooks/useTerminalPool.ts:28`

**Source:** Code-simplicity-reviewer, performance-oracle (both suggested cap).

## Proposed Solutions

### Option A: Counter guard (Recommended)

```typescript
let iterations = 0
while (terminalPool.needsEviction() && iterations++ < 20) {
```

The `20` matches the pool's max size — you can never need more evictions than that.

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] Loop cannot execute more than maxSize iterations
- [ ] Normal eviction behavior unchanged

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | While loops over mutable state need safety bounds |
| 2026-02-23 | Added `evictionGuard` counter capped at 20 | Trivial one-line guard, no behavior change for normal operation |
