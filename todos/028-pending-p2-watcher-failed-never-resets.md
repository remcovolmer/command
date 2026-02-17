---
status: pending
priority: p2
issue_id: "028"
tags: [code-review, reliability, file-watcher, git]
dependencies: []
---

# watcherFailed State Never Resets After Recovery

## Problem Statement

Once a file watcher error occurs, `watcherFailed` is set to `true` and the git status permanently degrades to 10-second polling for the rest of the session. Even if the watcher successfully restarts (which `FileWatcherService` attempts after `RESTART_DELAY`), the `watcherFailed` flag is never reset to `false`.

## Findings

**File:** `src/components/FileExplorer/FileExplorer.tsx:166, 180-182`

```typescript
const [watcherFailed, setWatcherFailed] = useState(false)
// ...
fileWatcherEvents.subscribeError(activeProjectId, 'git-status', () => {
  setWatcherFailed(true)
})
```

No corresponding path sets `watcherFailed` back to `false`. A single transient error permanently degrades to polling.

## Proposed Solutions

### Option A: Reset on receiving change events (Recommended)
If `watcherFailed` is true and change events start arriving again, reset to `false` to stop fallback polling.

```typescript
const handleWatchEvents = () => {
  if (watcherFailed) setWatcherFailed(false)  // Watcher recovered
  // ... existing debounce logic
}
```

**Pros:** Self-healing, simple
**Cons:** Slight coupling between change handler and error state
**Effort:** Small

### Option B: Reset on project switch
Clear `watcherFailed` when `activeProjectId` changes (already happens via useState reset on re-mount).

**Pros:** Simplest
**Cons:** Doesn't recover within same project session
**Effort:** Trivial

## Acceptance Criteria
- [ ] Transient watcher error followed by recovery stops fallback polling
- [ ] Persistent errors still fall back to polling correctly
