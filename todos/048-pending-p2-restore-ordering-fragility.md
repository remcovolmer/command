---
status: complete
priority: p2
issue_id: "048"
tags: [code-review, robustness, terminal-pool]
dependencies: []
---

# Document or harden fragile restore ordering in useXtermInstance

## Problem Statement

The restoration flow depends on a critical ordering: event subscription must happen BEFORE `api.terminal.restore()` is called, otherwise the flushed PTY data is lost. This ordering is correct but has no compiler enforcement — a single line reorder breaks it silently.

## Findings

**File:** `src/hooks/useXtermInstance.ts:247-266`

- Line 247: `terminalEvents.subscribe(id, ...)` — must come first
- Line 265: `api.terminal.restore(id)` — triggers flush from main process

**Source:** TypeScript reviewer (critical #2), architecture-strategist (correct ordering noted), security-sentinel (informational).

## Proposed Solutions

### Option A: Add prominent comment + move lines adjacent (Recommended)

Add a `// CRITICAL:` comment explaining the dependency. Group the two operations together.

**Effort:** Trivial | **Risk:** None

### Option B: Use setImmediate in TerminalManager.restoreTerminal

Defer the flush to next tick, guaranteeing the renderer listener is registered:

```typescript
if (buffer.length > 0) {
  setImmediate(() => {
    this.sendToRenderer('terminal:data', terminalId, buffer)
  })
}
```

**Pros:** Removes ordering dependency entirely
**Cons:** Adds tick of latency, slightly more complex
**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] Restore ordering is either enforced architecturally or clearly documented
- [ ] PTY data flushed during restore is never lost

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | Order-dependent IPC should be enforced, not assumed |
| 2026-02-23 | Fixed via Option B: setImmediate in restoreTerminal | Deferred flush removes ordering dependency entirely; renderer handlers guaranteed registered before data arrives |
