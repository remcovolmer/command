---
title: "FileWatcherService Memory Leak: Simultaneous Chokidar Instances on Startup"
date: 2026-02-19
category: performance-issues
tags: [memory-leak, ui-freeze, file-watcher, chokidar, electron, startup, zustand, race-condition]
severity: critical
component: FileWatcherService
symptoms:
  - ~1GB extra RAM usage on startup
  - Complete UI freeze ("Wachten op reactie van de app")
  - 10+ projects triggered simultaneous chokidar instances
  - App unresponsive before any user interaction
root_cause: "Release 0.13.0 started chokidar watchers for ALL projects simultaneously on startup instead of only the active project"
files_changed:
  - electron/main/index.ts
  - electron/main/services/FileWatcherService.ts
  - electron/preload/index.ts
  - src/types/index.ts
  - src/stores/projectStore.ts
  - src/components/FileExplorer/FileTree.tsx
  - test/projectStore.test.ts
---

# FileWatcherService Memory Leak: Simultaneous Chokidar Instances on Startup

## Context

Release 0.13.0 introduced a centralized `FileWatcherService` using chokidar for reactive file detection, replacing per-file watchers. The implementation spawned chokidar instances for every registered project on startup. With 10+ projects, this caused ~1GB extra RAM and complete UI freeze before any user interaction.

## Root Cause

Each chokidar instance performs a full directory tree traversal, builds internal file maps, and holds kernel file handles. The startup code was:

```typescript
// electron/main/index.ts (BEFORE - the problem)
const existingProjects = projectPersistence.getProjects()
for (const project of existingProjects) {
  fileWatcherService.startWatching(project.id, project.path)  // ALL projects at once
}
```

**Contributing factors:**

1. **`awaitWriteFinish: { pollInterval: 50 }`** made chokidar poll each changed file every 50ms until stable, adding per-file overhead on top of the batch system that already handled deduplication at 150ms intervals.

2. **State synchronization bug**: `activeProjectId` was modified by 6 different Zustand store actions (`setActiveProject`, `setActiveTerminal`, `addProject`, `removeProject`, `loadProjects`, `toggleInactiveSectionCollapsed`) but only 2 of those triggered the watcher switch. Users switching projects by clicking a terminal would leave the old watcher running.

3. **No serialization**: Rapid project switching could interleave async `stopAll()` and `startWatching()` calls, potentially orphaning chokidar instances.

## Solution

### Fix 1: Single Active Watcher with Serialized Switching

Added `switchTo()` method to `FileWatcherService` with a promise-chain serialization lock:

```typescript
// electron/main/services/FileWatcherService.ts
private switchLock: Promise<void> = Promise.resolve()

async switchTo(projectId: string, projectPath: string): Promise<void> {
  this.switchLock = this.switchLock.then(async () => {
    const currentIds = [...this.watchers.keys()]
    if (currentIds.length === 1 && currentIds[0] === projectId) return  // no-op
    await this.stopAll()
    this.startWatching(projectId, projectPath)
  }).catch(err => {
    console.error('[FileWatcher] switchTo failed:', err)
  })
  return this.switchLock
}
```

IPC handler:

```typescript
// electron/main/index.ts
ipcMain.handle('project:setActiveWatcher', async (_event, projectId: string) => {
  if (!isValidUUID(projectId)) throw new Error('Invalid project ID')
  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find(p => p.id === projectId)
  if (!project) return
  await fileWatcherService?.switchTo(project.id, project.path)
})
```

### Fix 2: Centralized Zustand Subscriber

Instead of calling `setActiveWatcher` from each store action that modifies `activeProjectId`, a single subscriber catches ALL changes:

```typescript
// src/stores/projectStore.ts (after store creation)
useProjectStore.subscribe(
  (state, prevState) => {
    if (state.activeProjectId && state.activeProjectId !== prevState.activeProjectId) {
      const api = getElectronAPI()
      api.project.setActiveWatcher(state.activeProjectId).catch((err: unknown) => {
        console.error('Failed to switch active watcher:', err)
      })
    }
  }
)
```

This ensures all 6 code paths that modify `activeProjectId` trigger the watcher switch automatically.

### Fix 3: Removed `awaitWriteFinish`

Removed redundant chokidar config. The existing 150ms batch system (`BATCH_INTERVAL`) already handles write stabilization.

### Fix 4: Batched Directory Invalidation

Replaced per-directory `invalidateDirectory` (N separate `set()` calls) with single `invalidateDirectories(dirPaths)`:

```typescript
invalidateDirectories: (dirPaths) =>
  set((state) => {
    const toDelete = dirPaths.filter(dir => state.directoryCache[dir])
    if (toDelete.length === 0) return state
    const newCache = { ...state.directoryCache }
    for (const dir of toDelete) { delete newCache[dir] }
    return { directoryCache: newCache }
  }),
```

## Investigation Steps

1. Identified startup loop watching all projects in `electron/main/index.ts`
2. Measured memory: ~1GB with 10+ projects vs ~200-400MB expected
3. Verified `awaitWriteFinish` was redundant with batch system
4. Code review revealed 6 code paths modify `activeProjectId` but only 2 triggered watcher
5. Stress-tested rapid project switching to identify race condition
6. Implemented and verified all 17 tests pass

## Key Patterns

### Promise-Chain Serialization Lock

For serializing async operations that must not interleave:

```typescript
private lock: Promise<void> = Promise.resolve()

async serializedOperation(): Promise<void> {
  this.lock = this.lock.then(async () => {
    // async work here - guaranteed sequential
  }).catch(err => { /* handle */ })
  return this.lock
}
```

### Zustand Subscriber for Centralized Side Effects

When multiple store actions modify the same state and all need the same side effect:

```typescript
store.subscribe((state, prevState) => {
  if (state.value !== prevState.value) {
    triggerSideEffect(state.value)
  }
})
```

This decouples side effects from individual actions, eliminating shotgun surgery.

## Prevention Strategies

1. **Resource budgeting**: Define hard limits per feature (e.g., max 1 file watcher). Treat watchers like DB connections -- centralize them.
2. **Subscriber-based side effects**: When 3+ code paths mutate the same state, use a Zustand subscriber instead of inline side-effect calls.
3. **Serialization for async I/O**: Any Electron feature involving OS resources (files, processes, ports) needs a serialization lock.
4. **Config audit**: For each new config option, ask "does this duplicate existing behavior?" Document config relationships.
5. **Scale testing**: Always test with N > 1 (10+ projects, rapid switching). Single-item tests hide scaling bugs.

## Lessons Learned

| Lesson | Pattern |
|--------|---------|
| One feature = one shared resource | Centralize watchers, connections, caches |
| State mutation != side effect execution | Zustand subscriber, not inline calls |
| Rapid async changes need serialization | Promise-chain lock pattern |
| Config redundancy = architecture smell | Remove inferior duplicate configs |
| Test with realistic scale | 10+ projects, rapid operations |

## Related Documentation

- [Original plan: Agent-Native Reactivity via FileWatcher](../../plans/2026-02-16-feat-agent-native-reactivity-file-watcher-plan.md)
- [EBUSY Worktree Removal](../runtime-errors/ebusy-worktree-removal-terminal-handles.md) -- resource cleanup timing
- [Editor Save Handler Double Fire](../logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md) -- event handler layering
- [Tasks IPC Path Traversal](../security-issues/tasks-ipc-path-traversal-and-review-fixes.md) -- path validation patterns
- [GitHub Context Menu Integration](../integration-issues/github-context-menu-integration.md) -- 4-layer IPC pattern
