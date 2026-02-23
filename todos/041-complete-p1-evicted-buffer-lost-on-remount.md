---
status: complete
priority: p1
issue_id: "041"
tags: [code-review, bug, terminal-pool, react]
dependencies: []
---

# Evicted Terminal Buffer Lost on Component Remount

## Problem Statement

If a terminal component unmounts while the terminal is evicted (due to React key change or parent re-render), `terminalPool.remove(id)` on the unmount cleanup wipes the serialized buffer — even though the terminal still exists in the main process. The scrollback data is permanently lost.

## Findings

**File:** `src/hooks/useXtermInstance.ts:318-325`

The unmount-only effect calls:
1. `cleanupRef.current?.()` — destroys xterm, resets hasInitializedRef
2. `terminalPool.remove(id)` — **deletes serialized buffer, eviction state, and callbacks**

The eviction path (via pool callback) also calls `cleanupRef.current?.()`. So the sequence for a remount during eviction is:

1. Pool evicts terminal → serializes buffer → marks evicted → calls cleanup
2. Component unmounts (React re-render) → calls cleanup again (no-op, already null) → **calls remove(id) which deletes the serialized buffer**
3. Component remounts → terminal has no buffer to restore

**When this can happen:**
- Parent `TerminalViewport` re-renders with different key props
- React concurrent mode re-mounts
- Project switching that causes viewport unmount/remount

## Proposed Solutions

### Option A: Guard remove() — only call when terminal is actually closing (Recommended)

```typescript
// On unmount, only remove from pool if terminal is being closed, not just remounting
useEffect(() => {
  return () => {
    cleanupRef.current?.()
    cleanupRef.current = null
    // Only remove if terminal no longer exists in store
    const terminals = useProjectStore.getState().terminals
    if (!terminals[id]) {
      terminalPool.remove(id)
    }
  }
}, [])
```

**Pros:** Preserves buffer across remounts, only cleans up on actual close
**Cons:** Relies on store state being updated before unmount effect runs
**Effort:** Small
**Risk:** Low

### Option B: Move remove() to terminal close handler instead of unmount

Remove `terminalPool.remove(id)` from the useEffect cleanup entirely. Instead, call it from the terminal close action in the Zustand store.

**Pros:** Clean separation — unmount handles xterm, close handles pool
**Cons:** Need to verify all close paths call the store action
**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [ ] Evicted terminal survives component remount with buffer intact
- [ ] Terminal close still properly cleans up pool state
- [ ] No orphaned entries in pool after terminal close

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified by TypeScript reviewer | unmount cleanup ≠ terminal close — pool cleanup belongs in close handler |
