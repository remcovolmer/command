---
status: complete
priority: p2
issue_id: "036"
tags: [code-review, architecture, simplicity, terminal-pool]
dependencies: ["035"]
---

# Consolidate Three Eviction State Maps into One in TerminalManager

## Problem Statement

`TerminalManager` uses three separate data structures for eviction state that are always modified together, creating synchronization risk and unnecessary complexity.

## Findings

**File:** `electron/main/services/TerminalManager.ts:47-50`

```typescript
private evictedTerminals: Set<string> = new Set()
private evictedBuffers: Map<string, string[]> = new Map()
private evictedBufferSizes: Map<string, number> = new Map()
```

These are always set/deleted together (in `evictTerminal`, `restoreTerminal`, `closeTerminal`). The `evictedTerminals` Set is redundant — a terminal is evicted if and only if it has an entry in the buffer map.

## Proposed Solutions

### Option A: Single Map with composite value (Recommended)

**Pros:** Eliminates synchronization risk, fewer Map lookups, cleaner code
**Cons:** Minor structural change
**Effort:** Small
**Risk:** Low

```typescript
private evictedBuffers: Map<string, { chunks: string[], size: number }> = new Map()

// Check if evicted:
this.evictedBuffers.has(terminalId)

// Evict:
this.evictedBuffers.set(terminalId, { chunks: [], size: 0 })

// Clean up:
this.evictedBuffers.delete(terminalId)
```

## Acceptance Criteria

- [ ] Single Map replaces three data structures
- [ ] All eviction/restore/close paths updated
- [ ] No behavioral change

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | Multiple structures tracking same lifecycle = synchronization risk |
