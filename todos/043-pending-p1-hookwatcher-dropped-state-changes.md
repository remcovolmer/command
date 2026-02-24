---
status: complete
priority: p1
issue_id: "043"
tags: [code-review, bug, async, claude-state]
dependencies: []
---

# ClaudeHookWatcher async guard silently drops state changes

## Problem Statement

The `isReading` boolean guard in `onStateChange()` silently discards `watchFile` callbacks that fire while an async read is in flight. If the file changes during a read, that state change is permanently lost — there is no re-check after the current read completes.

With 250ms polling this is less frequent than at 100ms, but the fundamental problem remains: Claude state transitions (`busy` -> `permission`, `permission` -> `done`) can be missed.

## Findings

**File:** `electron/main/services/ClaudeHookWatcher.ts:170-187`

```typescript
private async onStateChange(): Promise<void> {
  if (this.isReading) return  // <-- silently drops the notification
  this.isReading = true
  try {
    const content = await readFile(this.stateFilePath, 'utf-8')
    // ...
  } finally {
    this.isReading = false
  }
}
```

**Source:** TypeScript reviewer (critical), learnings-researcher (flagged as pattern from FileWatcherService serialization lock).

## Proposed Solutions

### Option A: Pending-read flag with re-check loop (Recommended)

Set a `pendingRead` flag instead of dropping. After the current read completes, re-read if the flag was set.

**Pros:** Guarantees last state change is always picked up, minimal code change
**Cons:** Slightly more complex control flow
**Effort:** Small
**Risk:** Low

```typescript
private pendingRead = false

private async onStateChange(): Promise<void> {
  if (this.isReading) {
    this.pendingRead = true
    return
  }
  this.isReading = true
  try {
    do {
      this.pendingRead = false
      const content = await readFile(this.stateFilePath, 'utf-8')
      // ... process content
    } while (this.pendingRead)
  } catch {
    // ignore
  } finally {
    this.isReading = false
  }
}
```

### Option B: Debounced re-read after current read completes

Schedule a follow-up read with a small delay (50ms) after each read, only if a notification arrived during the read.

**Pros:** Avoids tight loop, handles burst of changes
**Cons:** Adds latency
**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [ ] State change that arrives during an in-flight read is not lost
- [ ] No concurrent reads (isReading guard preserved)
- [ ] Claude state indicator in UI always reflects current state within polling interval

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-23 | Identified during code review | Boolean guard without re-check is a common async anti-pattern |
| 2026-02-23 | Implemented Option A: pendingRead flag with do-while re-check loop | Preserves existing normalizeStateFile flow; no concurrent reads; guaranteed last state is picked up |
