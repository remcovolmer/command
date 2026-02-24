---
title: "Automations system: scheduling, execution, and event-driven architecture"
date: 2026-02-24
category: integration-issues
tags:
  - automations
  - claude-cli
  - scheduling
  - croner
  - event-driven
  - worktrees
  - electron-ipc
  - child-process
  - crash-recovery
severity: enhancement
component:
  - electron/main/services/AutomationService.ts
  - electron/main/services/AutomationRunner.ts
  - electron/main/services/AutomationPersistence.ts
  - electron/main/services/ClaudeHookWatcher.ts
  - electron/main/services/GitHubService.ts
  - electron/main/services/FileWatcherService.ts
  - src/components/FileExplorer/AutomationsPanel.tsx
  - src/components/FileExplorer/AutomationCreateDialog.tsx
dependencies_added:
  - croner
origin: docs/brainstorms/2026-02-23-automations-brainstorm.md
---

# Automations System: Architecture Patterns

## Problem

Users had no way to automate repetitive Claude Code tasks without being physically present. Dependency audits, CI failure triage, release notes generation, and code review all required manually starting each session. There was no mechanism for "run this prompt on a schedule" or "when a PR merges, trigger this."

## Solution Overview

A three-layer architecture:

1. **Backend** (`AutomationService` + `AutomationRunner` + `AutomationPersistence`) - CRUD, scheduling, event triggers, run orchestration
2. **IPC layer** - typed channels following existing `service:kebab-case-action` convention
3. **UI layer** - "Automations" tab in FileExplorer with create/edit dialog and triage inbox

Each run: creates worktree -> spawns `claude -p` as child process -> captures JSON output -> stores result -> cleans up worktree.

## Key Architecture Decisions

### Why `claude -p` over Agent SDK

The runner spawns `claude` as a subprocess, not through the Agent SDK:

```typescript
const args = [
  '-p', prompt,
  '--output-format', 'json',
  '--dangerously-skip-permissions',
]
const child = spawn('claude', args, {
  cwd: worktreePath,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...process.env },
})
```

Rationale: consistent with how chats work (PTY-based `claude` invocations), avoids introducing an SDK dependency with its own auth surface, and makes output deterministic via `--output-format json`. The `--dangerously-skip-permissions` flag is deliberate: automations run headless with no human to answer permission prompts.

### Why croner over node-cron

`croner` exposes `previousRun()` which enables missed-run detection:

```typescript
const prevRun = cron.previousRun()
if (prevRun && prevRun.getTime() > lastRunTime && (now - prevRun.getTime()) < MISSED_RUN_MAX_AGE_MS) {
  this.triggerForAllProjects(automation)
}
```

Standard `node-cron` does not expose `previousRun()`. Without it, you'd have to compute the previous fire time by parsing the cron expression yourself.

### Why callback pattern over EventEmitter

Event triggers use direct callback/unsubscriber pattern:

```typescript
const unsubHook = hookWatcher.addStateChangeListener((_terminalId, state) => { ... })
const unsubPR = githubService.onPREvent((projectPath, event) => { ... })
const unsubFile = fileWatcherService.onFileChanges((events) => { ... })
this.eventUnsubscribers.push(unsubHook, unsubPR, unsubFile)
```

Advantages over EventEmitter: no shared event name strings that can silently mismatch, no risk of forgetting `removeListener` causing leaks, and the unsubscriber array gives a clean single-point teardown in `destroy()`.

## Key Implementation Patterns

### Process tree killing on Windows

`child.kill('SIGTERM')` only kills the parent on Windows, leaving child processes as zombies. Use `taskkill /T /F` instead:

```typescript
private killProcess(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
  } else {
    child.kill('SIGTERM')
    setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already dead */ }
    }, 5000)
  }
}
```

See also: `docs/solutions/runtime-errors/ebusy-worktree-removal-terminal-handles.md`

### Promise chain serialization for worktree creation

Multiple automations firing simultaneously for the same repo would race on `git worktree add`. The lock is a self-chaining promise:

```typescript
private worktreeLock: Promise<void> = Promise.resolve()

private async serializedWorktreeCreate(projectPath: string, branchName: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    this.worktreeLock = this.worktreeLock.then(async () => {
      const result = await this.worktreeService.createWorktree(projectPath, branchName)
      resolve(result.path)
    }).catch(reject)
  })
}
```

Each call appends to the end of the chain. Same pattern used in `FileWatcherService` for serialized watcher switching.

See also: `docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md`

### Atomic JSON writes

All persistence writes go through write-to-temp-then-rename:

```typescript
private atomicWrite(filePath: string, data: unknown): void {
  const tempPath = `${filePath}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tempPath, filePath)
}
```

On most filesystems, `rename` is atomic within the same directory. A crash between write and rename leaves the `.tmp` file, not a corrupt primary file. Follows the `ProjectPersistence` pattern.

### Crash recovery

On startup, `markRunningAsFailed()` patches any runs left in `running` state from a previous crash:

```typescript
markRunningAsFailed(): number {
  let count = 0
  for (const run of this.runState.runs) {
    if (run.status === 'running') {
      run.status = 'failed'
      run.error = 'App closed during execution'
      run.completedAt = new Date().toISOString()
      count++
    }
  }
  if (count > 0) this.saveRuns()
  return count
}
```

Called in constructor (crash recovery) and `destroy()` (graceful shutdown).

### Worktree auto-cleanup

Runs that produce no file changes have their worktree removed immediately:

```typescript
const hasChanges = await this.worktreeHasChanges(worktreePath)
if (!hasChanges) {
  await this.cleanupWorktree(projectPath, worktreePath, branchName)
}
```

Orphaned worktrees (from crashes) are garbage-collected on startup by parsing timestamps embedded in branch names (`auto-{hash}-{Date.now()}`).

## Concurrency Controls

| Control | Mechanism | Location |
|---------|-----------|----------|
| Max 3 concurrent runs | `runningCount` integer check | AutomationService.triggerRun() |
| No duplicate automation runs | `isRunning(automationId)` check | AutomationService.triggerRun() |
| File change cooldown | Per-automation timestamp map | AutomationService.handleFileChangeTrigger() |
| Serialized worktree ops | Promise chain lock | AutomationRunner.serializedWorktreeCreate() |
| Output size cap | 10MB limit, kills process | AutomationRunner.run() |
| Run history pruning | Max 50 runs per automation | AutomationPersistence.pruneRuns() |

Note: JavaScript's single-threaded event loop makes the `runningCount` check-and-increment safe without explicit locking.

## Known Edge Cases and Risks

| Risk | Severity | Current Mitigation | Future Action |
|------|----------|-------------------|---------------|
| Process zombies on Windows | Medium | `taskkill /T /F` in destroy | Test deep subprocess chains |
| Worktree lock stalelock | Medium-Low | Serialization + 6-step removal | Consider lock timeout |
| Unbounded stderr collection | Medium | None | Add stderr size limit |
| Missed cron runs after long sleep | Low-Medium | 24h window + startup check | Consider periodic re-check |
| `atomicWrite()` silent failures | Medium | Error logging only | Consider retry logic |
| Disk usage at scale | Medium (future) | 24h GC for worktrees | Size-based GC |

## Storage Design

Two separate JSON files in `userData/`:
- `automations.json` - automation definitions (schemas, triggers, enabled state)
- `automation-runs.json` - execution history

Separation means a corrupted runs file doesn't block loading automation definitions. Each file carries a `version` field for future migration. Run history is pruned to 50 entries per automation.

## Related Documentation

- `docs/brainstorms/2026-02-23-automations-brainstorm.md` - Original design exploration
- `docs/plans/2026-02-23-feat-automations-plan.md` - Implementation plan
- `docs/solutions/runtime-errors/ebusy-worktree-removal-terminal-handles.md` - Windows process cleanup patterns
- `docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md` - Promise chain serialization pattern
- `docs/solutions/security-issues/tasks-ipc-path-traversal-and-review-fixes.md` - IPC security patterns
- `docs/solutions/integration-issues/github-context-menu-integration.md` - 4-layer IPC pattern

## Testing Gaps

Priority test scenarios not yet covered:

1. **Process cleanup on timeout** - Verify process killed and worktree cleaned after timeout
2. **Concurrent trigger deduplication** - Same automation triggered twice within 1ms
3. **Worktree cleanup on crash** - Mock child.on('error'), verify cleanup
4. **Serialization deadlock prevention** - Worktree creation fails in queue, verify lock doesn't deadlock
5. **Output size limit enforcement** - Claude outputs >10MB, verify process killed and cleanup
6. **Missed run recovery on startup** - Verify checkMissedRuns() triggers missed run correctly
7. **Invalid cron expression handling** - Malformed cron doesn't crash scheduler
