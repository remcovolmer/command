---
status: complete
priority: p2
issue_id: "045"
tags: [code-review, robustness, terminal-pool]
dependencies: []
---

# Wrap evict() cleanup callback in try-catch

## Problem Statement

If the cleanup callback throws during `TerminalPool.evict()`, the exception propagates up through the eviction while-loop in `useTerminalPool`, potentially leaving the pool in an inconsistent state (serialized buffer stored and evictedSet updated, but xterm instance still alive).

## Findings

**File:** `src/utils/terminalPool.ts:141-159` (evict method)

The serializer is protected (returns null on failure), but `cleanupFn?.()` has no error isolation.

**Source:** Architecture-strategist (concern 4), learnings-researcher (callback guarantee pattern).

## Proposed Solutions

### Option A: Try-catch around cleanup (Recommended)

```typescript
try {
  const cleanupFn = this.cleanups.get(terminalId)
  cleanupFn?.()
} catch (err) {
  console.error(`[TerminalPool] Cleanup failed for ${terminalId}:`, err)
}
```

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] Cleanup failure does not break the eviction loop
- [ ] Error is logged for debugging

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | Always isolate third-party/callback invocations in lifecycle methods |
| 2026-02-23 | Wrapped cleanupFn invocation in try-catch in evict() method | Trivial change, all 26 terminalPool tests pass |
