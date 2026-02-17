---
status: pending
priority: p2
issue_id: "031"
tags: [code-review, race-condition, editor, file-watcher]
dependencies: []
---

# Editor readFile Race Condition and Missing Unmount Cancellation

## Problem Statement

Two race conditions in CodeEditor and MarkdownEditor watcher callbacks:

1. **Out-of-order resolution**: Multiple `file-changed` events spawn independent `readFile` calls. If the second resolves before the first, the first then overwrites with potentially stale content.

2. **Unmount without cancellation**: When the effect cleans up, in-flight `readFile` promises still resolve and call `setValue()` on a potentially disposed Monaco editor or trigger state updates on unmounted components.

## Findings

**Files:**
- `src/components/Editor/CodeEditor.tsx:76-123`
- `src/components/Editor/MarkdownEditor.tsx:176-198`

The watcher callback has no:
- Sequence counter to discard stale responses
- Cancellation flag checked inside promise `.then()` callbacks

## Proposed Solutions

### Option A: Sequence counter + cancellation flag (Recommended)
Add a `readSeqRef` counter. Increment on each readFile call. In the `.then()`, check if the current seq matches. Also add a `cancelledRef` set to true on cleanup.

```typescript
const readSeqRef = useRef(0)
// In watcher callback:
const seq = ++readSeqRef.current
api.fs.readFile(filePath).then((text) => {
  if (seq !== readSeqRef.current) return  // stale
  if (cancelledRef.current) return  // unmounted
  // ... proceed with setValue
})
```

**Pros:** Correct, cheap, no behavior change
**Cons:** One more ref
**Effort:** Small

## Acceptance Criteria
- [ ] Only the latest readFile response is applied to the editor
- [ ] In-flight reads are discarded after component unmount
- [ ] No React state updates on unmounted components
