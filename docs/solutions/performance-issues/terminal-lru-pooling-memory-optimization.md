---
title: "Terminal LRU Pool & Memory Optimization"
category: performance-issues
tags:
  - memory-optimization
  - electron
  - xterm.js
  - code-splitting
  - lru-cache
  - terminal-pooling
  - lazy-loading
  - async-io
severity: high
components:
  - src/utils/terminalPool.ts
  - src/hooks/useXtermInstance.ts
  - src/hooks/useTerminalPool.ts
  - electron/main/services/TerminalManager.ts
  - electron/main/services/ClaudeHookWatcher.ts
  - src/components/Editor/EditorContainer.tsx
  - src/stores/projectStore.ts
  - vite.config.ts
date: 2026-02-23
status: implemented
origin: docs/brainstorms/2026-02-23-performance-optimization-brainstorm.md
---

# Terminal LRU Pool & Memory Optimization

## Problem

Memory usage was high at startup (5-10 projects, 10-20 terminals) due to four root causes:

1. **All xterm.js terminals alive simultaneously** - each holds DOM elements, scrollback buffers, and addon state even when hidden
2. **Eager loading of Monaco (~3MB) and Milkdown** - parsed and initialized before React renders, regardless of use
3. **Synchronous `readFileSync` in 100ms polling loop** - ClaudeHookWatcher blocks the main process every 100ms
4. **All worktrees loaded at startup** - every project's worktrees fetched immediately, not just the active project

## Investigation

- Profiled startup: Monaco chunk alone is ~4.2MB, Milkdown ~460KB
- Counted xterm instances: all terminals mount `Terminal` component, each creates full xterm.js instance
- Traced ClaudeHookWatcher: `readFileSync` in `setInterval(100)` with no concurrency guard
- Checked Sidebar mount: two `useEffect` calls load worktrees for ALL projects

## Solution

### Phase 1: Quick Wins

**1. Vite code splitting** (`vite.config.ts`)

```typescript
manualChunks(id) {
  if (id.includes('monaco-editor') || id.includes('@monaco-editor')) return 'monaco'
  if (id.includes('@milkdown')) return 'milkdown'
  if (id.includes('@dnd-kit')) return 'dnd'
}
```

**2. React.lazy() for editors** (`EditorContainer.tsx`, `TerminalViewport.tsx`)

```typescript
const EditorContainer = lazy(() =>
  import('../Editor/EditorContainer').then(m => ({ default: m.EditorContainer }))
)
// Named exports need .then(m => ({ default: m.X })) pattern
```

Wrapped in `<Suspense fallback={<EditorSkeleton />}>`. Monaco config moved to `EditorContainer.tsx` module scope (runs when lazy chunk loads, not at startup).

**3. Async ClaudeHookWatcher** (`ClaudeHookWatcher.ts`)

- Replaced `readFileSync` with `fs.promises.readFile`
- Added `isReading` boolean guard to prevent concurrent reads
- Increased polling from 100ms to 250ms

**4. Deferred worktree loading** (`Sidebar.tsx`)

- Only load worktrees for `activeProjectId` at startup
- Other projects load on-demand when selected

### Phase 2: Terminal LRU Pool

**Core: `src/utils/terminalPool.ts`** (singleton)

- LRU ordering via `string[]` array (most-recent-first)
- Configurable max size (2-20, default 5, persisted in Zustand)
- Eviction algorithm: prefer `stopped` > `done`, never evict `busy`/`permission`/`question`, never evict split view terminals

**Callback registry pattern:**

```typescript
terminalPool.registerCallbacks(id,
  () => serializeAddonRef.current?.serialize() ?? null, // serializer
  () => { cleanupRef.current?.(); cleanupRef.current = null } // cleanup
)
```

Each terminal registers its own serialize/cleanup functions. The pool calls them during eviction without tight coupling.

**Main-process buffering** (`TerminalManager.ts`):

When a terminal is evicted, `TerminalManager` buffers PTY data in a ring buffer (1MB cap per terminal). On restore, buffered data is flushed to the new xterm instance.

**Restoration flow** (order matters):

1. Create new xterm instance with SerializeAddon
2. Write serialized scrollback buffer (`terminal.write(savedBuffer)`)
3. Subscribe to terminal events via `terminalEvents.subscribe()`
4. **Then** call `api.terminal.restore(id)` to flush main-process buffer

The IPC restore call must come AFTER event subscription to ensure flushed data is captured.

**Settings UI** (`GeneralSection.tsx`):

Number input (2-20) persisted via `terminalPoolSize` in Zustand store. Changes sync to `terminalPool.setMaxSize()` immediately.

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| LRU over FIFO | Respects user attention - recently used terminals stay alive |
| Callback registry | Decouples pool from xterm lifecycle - pool is pure state manager |
| Restore after subscribe | Prevents data loss from IPC flush arriving before listener ready |
| 2MB serialize cap, 1MB buffer cap | Balances scrollback preservation against memory bounds |
| Protected states | Never evict terminals requiring user interaction |
| Global pool (not per-project) | 5 total across all projects matches actual concurrent usage |

## Prevention Strategies

### For new heavy components
- If >500KB: use `React.lazy()` + `<Suspense>` + `manualChunks` in Vite
- If singleton resource: consider LRU pool pattern (register/evict/restore lifecycle)
- If polling: async I/O with concurrency guard, minimum 250ms interval

### Code review checklist
- [ ] No new `readFileSync`/`statSync` in hot paths
- [ ] All `useEffect` returns clean up timers, listeners, subscriptions
- [ ] New dependencies >100KB justified and code-split
- [ ] No eager loading at startup without justification

### Testing
- Unit test eviction algorithm: protected states, LRU ordering, split view protection
- Unit test buffer caps: verify serialized data truncated at 2MB
- Integration test: evict-restore cycle preserves scrollback content
- Memory test: 50+ evict/restore cycles don't leak

## Related Documentation

- **Brainstorm:** `docs/brainstorms/2026-02-23-performance-optimization-brainstorm.md`
- **Plan:** `docs/plans/2026-02-23-feat-performance-memory-optimization-plan.md`
- **Related:** `docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md` (resource centralization, async patterns)
- **Related:** `docs/plans/2026-02-16-feat-agent-native-reactivity-file-watcher-plan.md` (IPC batching, event manager pattern)
