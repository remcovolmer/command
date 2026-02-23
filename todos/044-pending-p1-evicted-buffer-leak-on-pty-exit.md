---
status: complete
priority: p1
issue_id: "044"
tags: [code-review, bug, memory-leak, terminal-pool]
dependencies: []
---

# Evicted buffer not cleaned up on PTY exit (memory leak)

## Problem Statement

When a PTY process exits on its own (user types `exit`, process crashes, etc.) while the terminal is evicted, the main-process eviction buffer leaks. The `onExit` handler cleans up `terminalInputBuffers` and `terminalTitled` but does NOT clean up `evictedBuffers`. The buffer (up to 1MB) persists until `closeTerminal()` is explicitly called, which may never happen if the PTY exited autonomously.

## Findings

**File:** `electron/main/services/TerminalManager.ts:120-133` (onExit handler)

The handler deletes from `terminals`, `terminalInputBuffers`, and `terminalTitled`, but `evictedBuffers` is missing.

**Source:** Pattern-recognition-specialist (medium), performance-oracle (P1 fix). Both independently identified this as a consistency gap.

## Proposed Solutions

### Option A: Add cleanup line to onExit (Recommended)

**Pros:** One line fix
**Cons:** None
**Effort:** Trivial
**Risk:** None

Add to `ptyProcess.onExit` handler:
```typescript
this.evictedBuffers.delete(id)
```

## Acceptance Criteria

- [ ] `evictedBuffers` is cleaned up when PTY exits while evicted
- [ ] No buffer references remain after terminal close or PTY exit

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | When adding new per-terminal Maps, check ALL cleanup paths (onExit + closeTerminal + destroy) |
| 2026-02-23 | Fixed: added `this.evictedBuffers.delete(id)` to `ptyProcess.onExit` handler | One-line fix, consistent with existing cleanup pattern |
