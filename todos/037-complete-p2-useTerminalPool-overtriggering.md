---
status: complete
priority: p2
issue_id: "037"
tags: [code-review, performance, react, terminal-pool]
dependencies: []
---

# useTerminalPool Re-renders on Every Terminal State Change

## Problem Statement

The `useTerminalPool` hook's effect depends on the full `terminals` record from Zustand, which gets a new reference on every terminal state change (e.g., Claude toggling between `busy`/`done`). This causes unnecessary effect re-evaluations dozens of times per minute during active usage.

## Findings

**File:** `src/components/Terminal/TerminalViewport.tsx:43`

```typescript
const allTerminals = useProjectStore(s => s.terminals)
useTerminalPool(allTerminals, activeTerminalId, splitTerminalIds)
```

**File:** `src/hooks/useTerminalPool.ts:19-40`

The `useEffect` depends on `[activeTerminalId, terminals, splitTerminalIds]`. The `terminals` reference changes on every state update because Zustand spreads the object.

Eviction only needs to run when `activeTerminalId` changes (user switches terminals), not when terminal states change. The `terminals` data is only needed inside `getEvictionCandidate()` to check states — it can be read at call time.

## Proposed Solutions

### Option A: Read terminals at call time instead of as dependency (Recommended)

**Pros:** Eliminates dozens of unnecessary effect runs per minute
**Cons:** None — getState() is synchronous and always fresh
**Effort:** Small
**Risk:** Low

```typescript
useEffect(() => {
  if (!activeTerminalId) return
  terminalPool.touch(activeTerminalId)
  if (!terminalPool.needsEviction()) return

  const currentTerminals = useProjectStore.getState().terminals
  const candidate = terminalPool.getEvictionCandidate(
    currentTerminals, activeTerminalId, splitTerminalIds
  )
  if (candidate) {
    terminalPool.evict(candidate, apiRef.current)
  }
}, [activeTerminalId, splitTerminalIds])
```

## Acceptance Criteria

- [ ] Effect only fires on `activeTerminalId` or `splitTerminalIds` change
- [ ] Eviction still works correctly when switching terminals
- [ ] No performance regression

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | Zustand selectors return new refs on spreads — effect deps must be stable |
