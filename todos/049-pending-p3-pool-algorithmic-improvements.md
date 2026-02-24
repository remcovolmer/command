---
status: pending
priority: p3
issue_id: "049"
tags: [code-review, performance, terminal-pool]
dependencies: []
---

# Pool algorithmic improvements: O(1) active count + position map for sort

## Problem Statement

Two O(n) operations in `TerminalPool` could be O(1) with maintained counters:

1. `getActiveCount()` filters entire `lruOrder` array on every call — called inside `needsEviction()` which runs in a while loop
2. `getEvictionCandidate()` sort comparator calls `indexOf()` twice per comparison — O(m * log(m) * n)

At n=20 max these are negligible, but they're easy to fix.

## Findings

**File:** `src/utils/terminalPool.ts:93-95` (getActiveCount) and `126-132` (sort comparator)

**Source:** Performance-oracle (2.1 and 2.3).

## Proposed Solutions

### Active count: maintain a counter

Increment on `touch()` (new entry), decrement on `evict()` and `remove()`.

### Sort: pre-compute position map

```typescript
const posMap = new Map<string, number>()
this.lruOrder.forEach((id, i) => posMap.set(id, i))
```

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `getActiveCount()` is O(1)
- [ ] Sort comparator does not use `indexOf()`
- [ ] Existing tests still pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | Even at small n, maintaining counters is cheaper than recomputing |
