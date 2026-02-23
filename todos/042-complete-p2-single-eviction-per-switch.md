---
status: complete
priority: p2
issue_id: "042"
tags: [code-review, terminal-pool, logic]
dependencies: []
---

# Pool Only Evicts One Terminal Per Switch — Needs While-Loop

## Problem Statement

When pool size is reduced (e.g., from 10 to 3 via settings), `useTerminalPool` only evicts one terminal per active terminal switch. With 8 active terminals and a pool of 3, it takes 5 separate terminal switches to reach the target.

## Findings

**File:** `src/hooks/useTerminalPool.ts:28-39`

```typescript
if (!terminalPool.needsEviction()) return
const candidate = terminalPool.getEvictionCandidate(...)
if (candidate) {
  terminalPool.evict(candidate, apiRef.current)
}
```

This evicts exactly one terminal per effect run. Should be a while-loop to evict all excess terminals at once.

## Proposed Solutions

### Option A: While-loop eviction (Recommended)

```typescript
while (terminalPool.needsEviction()) {
  const candidate = terminalPool.getEvictionCandidate(terminals, activeTerminalId, splitTerminalIds)
  if (!candidate) break
  terminalPool.evict(candidate, apiRef.current)
}
```

**Pros:** Immediately reaches target pool size
**Cons:** Multiple synchronous serializations could cause brief UI stutter
**Effort:** Small (1 line change)
**Risk:** Low — eviction is synchronous and serialization is fast (~5-20ms per terminal)

## Acceptance Criteria

- [ ] Reducing pool size from 10 to 3 evicts 7 terminals immediately
- [ ] No UI stutter during batch eviction

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified by TypeScript reviewer | Settings changes need batch eviction, not single-step |
