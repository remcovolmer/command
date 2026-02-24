---
status: complete
priority: p2
issue_id: "039"
tags: [code-review, testing, terminal-pool]
dependencies: []
---

# Add Unit Tests for TerminalPool

## Problem Statement

`TerminalPool` is a pure class with no DOM or IPC dependencies — highly testable — but has no tests. The pool manages critical eviction logic (LRU ordering, protected states, buffer caps) that should be covered.

## Findings

**File:** `src/utils/terminalPool.ts`

The class is pure logic: no imports from React, xterm, or Electron. All dependencies are injected via callbacks. This makes it trivially unit-testable.

## Proposed Solutions

### Option A: Add test/terminalPool.test.ts (Recommended)

Test cases:
- `touch()`: LRU ordering (most recent first), idempotent for idx=0
- `getEvictionCandidate()`: respects protected states, prefers stopped > done, excludes active/split
- `evict()`: serialization failure aborts eviction, successful eviction marks evicted
- `storeBuffer()`: respects 2MB cap, truncates at line boundary
- `needsEviction()`: correct active count after evictions
- `remove()`: cleans all internal state
- `setMaxSize()`: clamps to 2-20 range

**Effort:** Small (pure unit tests, no mocks needed for the class itself)
**Risk:** None

## Acceptance Criteria

- [ ] Tests cover all public methods
- [ ] Tests verify eviction candidate selection with various terminal states
- [ ] Tests verify buffer size cap and truncation
- [ ] All tests pass with `npm run test`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | Pure classes without tests = risk for future regressions |
