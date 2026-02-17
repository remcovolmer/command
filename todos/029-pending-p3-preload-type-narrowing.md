---
status: pending
priority: p3
issue_id: "029"
tags: [code-review, typescript, types, ipc]
dependencies: []
---

# Preload Bridge Uses Loose Type for Watch Event Type Field

## Problem Statement

The preload bridge types the `type` field of watch events as `string` instead of the 5-value union type. The renderer-side `ElectronAPI` correctly uses `FileWatchEventType`, but the preload is the weak link in the type chain.

## Findings

**File:** `electron/preload/index.ts` (onWatchChanges callback)

```typescript
onWatchChanges: (callback: (events: Array<{ type: string; ... }>) => void)
```

Should be:
```typescript
type: 'file-added' | 'file-changed' | 'file-removed' | 'dir-added' | 'dir-removed'
```

Also, `sendToRenderer` in FileWatcherService uses `channel: string` and `...args: unknown[]` instead of typed overloads.

## Proposed Solutions

### Option A: Narrow the preload type (Recommended)
Use the literal union type in the preload bridge callback signature.

**Pros:** Compile-time safety across IPC boundary
**Cons:** None
**Effort:** Trivial

## Acceptance Criteria
- [ ] Preload event type uses literal union instead of string
- [ ] Optionally: sendToRenderer uses typed overloads
