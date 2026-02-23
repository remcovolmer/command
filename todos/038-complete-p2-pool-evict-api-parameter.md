---
status: complete
priority: p2
issue_id: "038"
tags: [code-review, architecture, simplicity, terminal-pool]
dependencies: []
---

# Remove api Parameter from TerminalPool.evict() — Clarify Pool as Pure State Manager

## Problem Statement

`TerminalPool.evict()` takes an `api` parameter to call IPC directly, but the pool is documented as a "pure state manager." This mixes concerns: the pool stores serializers/cleanups as callbacks (good decoupling) but then directly invokes IPC (coupling to Electron).

## Findings

**File:** `src/utils/terminalPool.ts:141`

```typescript
evict(terminalId: string, api: { terminal: { evict: (id: string) => void } }): boolean {
  // ... serializes, stores buffer, calls api.terminal.evict(), calls cleanup
}
```

The only caller is `useTerminalPool.ts:38`. The caller already has `apiRef.current`, so the IPC call can be made by the caller after the pool returns success.

Also, `touch()` is called from both `useTerminalPool` (line 26) and `useXtermInstance` (line 338), creating redundant O(n) operations per terminal switch. One hook should own the touch lifecycle.

## Proposed Solutions

### Option A: Split evict into state + caller orchestration (Recommended)

Pool handles: serialize → store buffer → mark evicted → call cleanup → return true
Caller handles: `api.terminal.evict(id)`

**Pros:** Pool becomes truly pure, no Electron API dependency
**Cons:** Slightly more code in caller
**Effort:** Small
**Risk:** Low

### Option B: Accept current design

The type narrowing `{ terminal: { evict: ... } }` is already well-contained. The coupling is minimal.

**Pros:** No change needed
**Cons:** Design doc says "pure state manager" but it isn't quite

## Acceptance Criteria

- [ ] Pool class has no reference to Electron API
- [ ] Eviction behavior unchanged
- [ ] Single `touch()` call per terminal switch

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | Callback pattern + direct IPC call = mixed abstraction levels |
