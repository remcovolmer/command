---
status: complete
priority: p1
issue_id: "035"
tags: [code-review, performance, bug, terminal-pool]
dependencies: []
---

# Buffer Size Tracking Math Bug in TerminalManager.bufferEvictedData

## Problem Statement

The buffer size calculation after trimming in `TerminalManager.bufferEvictedData` always evaluates to `MAX_BUFFER_SIZE`, regardless of how much data was actually removed. This means the tracked size diverges from reality after the first trim, causing unnecessary trimming on subsequent writes and potential data loss.

## Findings

**File:** `electron/main/services/TerminalManager.ts:388`

```typescript
this.evictedBufferSizes.set(terminalId, Math.max(0, currentSize - (currentSize + dataSize - this.MAX_BUFFER_SIZE) + dataSize))
```

Algebraic simplification:
- `currentSize - (currentSize + dataSize - MAX_BUFFER_SIZE) + dataSize`
- = `currentSize - currentSize - dataSize + MAX_BUFFER_SIZE + dataSize`
- = `MAX_BUFFER_SIZE`

The `while` loop removes chunks via `shift()` but the actual removed bytes are never tracked. The size is always set to `MAX_BUFFER_SIZE` regardless of what was removed.

**Impact:** After the first trim event, every subsequent data write triggers unnecessary trimming because the tracked size is always at the maximum. This causes more scrollback loss than intended for chatty evicted terminals.

**Source:** Identified by architecture-strategist, performance-oracle, and code-simplicity-reviewer (all three independently flagged this).

## Proposed Solutions

### Option A: Track actual removed bytes (Recommended)

**Pros:** Minimal change, fixes the bug precisely
**Cons:** None
**Effort:** Small
**Risk:** Low

```typescript
private bufferEvictedData(terminalId: string, data: string): void {
  const buffer = this.evictedBuffers.get(terminalId)
  if (!buffer) return

  const currentSize = this.evictedBufferSizes.get(terminalId) || 0
  const dataSize = data.length

  if (currentSize + dataSize > this.MAX_BUFFER_SIZE) {
    let removedSize = 0
    const excess = (currentSize + dataSize) - this.MAX_BUFFER_SIZE
    while (removedSize < excess && buffer.length > 0) {
      const removed = buffer.shift()!
      removedSize += removed.length
    }
    this.evictedBufferSizes.set(terminalId, currentSize - removedSize + dataSize)
  } else {
    this.evictedBufferSizes.set(terminalId, currentSize + dataSize)
  }

  buffer.push(data)
}
```

### Option B: Consolidate to single-string buffer

Replace `string[]` with a single `string` buffer. Use string concatenation (V8-optimized) and simple `slice()` for trimming. Eliminates the `shift()` O(n) issue too.

**Pros:** Simpler, faster, eliminates both the math bug and the shift() performance issue
**Cons:** Slightly larger change, affects restoreTerminal too
**Effort:** Medium
**Risk:** Low

## Acceptance Criteria

- [ ] Buffer size tracking accurately reflects actual buffer contents after trimming
- [ ] Evicted terminal with continuous output does not lose more data than necessary
- [ ] Unit test: fill buffer to cap, verify size matches actual buffer length

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | Math simplifies to constant — classic algebraic reduction bug |
