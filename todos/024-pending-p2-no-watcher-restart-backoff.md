---
status: pending
priority: p2
issue_id: "024"
tags: [code-review, performance, reliability, file-watcher]
dependencies: []
---

# No Exponential Backoff on Watcher Restart

## Problem Statement

When `FileWatcherService` encounters a chokidar error, it attempts to restart the watcher after a fixed 5-second delay. If the underlying cause persists (e.g., permission denied, disk issues), this creates an infinite restart loop with no backoff or retry limit.

## Findings

**File:** `electron/main/services/FileWatcherService.ts:97-116`

The error handler schedules a restart after `RESTART_DELAY` (5000ms) with no:
- Exponential backoff
- Maximum retry count
- Cooldown period after repeated failures

**Also:** `stopWatching()` (line 125-139) does not clean up `projectPaths` map entry. This means after a project is removed, its path stays in `projectPaths` and the restart logic could attempt to restart a stale watcher. Add `this.projectPaths.delete(projectId)` to `stopWatching()`.

## Proposed Solutions

### Option A: Add exponential backoff with max retries (Recommended)
Track retry count per project. Double the delay each attempt. Stop after N retries and emit a permanent error.

**Pros:** Prevents resource waste, self-healing for transient errors
**Cons:** Slightly more complexity
**Effort:** Small

### Option B: Add max retry count only
Keep fixed delay but cap at 3 retries before giving up.

**Pros:** Simplest fix
**Cons:** Fixed delay may be too aggressive for persistent issues
**Effort:** Small

## Acceptance Criteria
- [ ] Watcher restart uses exponential backoff (e.g., 5s, 10s, 20s)
- [ ] Maximum retry limit prevents infinite restarts
- [ ] Error sent to renderer when max retries exceeded
- [ ] Retry count resets on successful watcher start
- [ ] `stopWatching()` cleans up `projectPaths` entry
