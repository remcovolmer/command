---
status: pending
priority: p2
issue_id: "027"
tags: [code-review, performance, editor, file-watcher]
dependencies: []
---

# Deduplicate File Events in Editor Before Reload

## Problem Statement

If a batch contains multiple `file-changed` events for the same file (common when save + format happens in quick succession), the editor fires multiple concurrent `readFile` IPC calls and multiple `editor.setValue()` calls. Each `setValue()` on Monaco is expensive - it rebuilds the text model, recomputes syntax highlighting, and triggers a full re-render.

## Findings

**File:** `src/components/Editor/CodeEditor.tsx:76-98`

The `handleWatchEvents` callback iterates all events and calls `api.fs.readFile` for each matching `file-changed` event. No deduplication or debounce. Under rapid saves (e.g., Claude Code writing a file in chunks), 3-5 change events can appear in a single 150ms batch for the same file.

Same issue exists in `src/components/Editor/MarkdownEditor.tsx:176-197`.

## Proposed Solutions

### Option A: Deduplicate events per path before processing (Recommended)
Keep only the last event per file path in the batch. Process the deduplicated set.

```typescript
const latestByPath = new Map<string, FileWatchEvent>()
for (const event of events) {
  if (normalizedPath === event.path) {
    latestByPath.set(event.path, event)
  }
}
for (const event of latestByPath.values()) { ... }
```

**Pros:** Simple, eliminates redundant reloads
**Cons:** None
**Effort:** Small

### Option B: Add per-editor debounce
Debounce the reload with a small delay (e.g., 100ms) to coalesce rapid changes.

**Pros:** Also handles events across batches
**Cons:** Adds perceived latency
**Effort:** Small

## Acceptance Criteria
- [ ] Multiple file-changed events for same file in one batch result in single readFile + setValue
- [ ] No visible UI flicker during rapid file saves
