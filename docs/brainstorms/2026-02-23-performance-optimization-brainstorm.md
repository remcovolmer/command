# Performance Optimization: Memory & Startup

**Date:** 2026-02-23
**Status:** Draft
**Branch:** feat/performance-optimalization

## What We're Building

Reduce Command's memory footprint and startup overhead, especially for power users with 5-10 projects and 10-20 terminals open simultaneously. The primary pain point is high memory usage from startup — the app is already heavy before the user does anything.

## Why This Approach

Root cause analysis identified two major memory drivers:

1. **Eager loading of heavy libraries** — Monaco Editor (~3MB+ JS parsed at startup), Milkdown, and other large dependencies are loaded synchronously before React renders, regardless of whether the user needs them.
2. **All terminals live in memory** — Every terminal creates a full xterm.js instance with scrollback buffer, even when hidden. With 20 terminals, that's 20 instances consuming memory for 2-3 visible ones.

Secondary contributors: synchronous file reads in a 100ms polling loop, all worktrees loaded for all projects at startup, no code splitting in the Vite bundle.

## Key Decisions

### 1. Lazy-load Monaco Editor
- Move Monaco initialization from `main.tsx` line 1 to `React.lazy()` wrapper around `CodeEditor` and `DiffEditorView`
- Monaco only loads when the user opens a file editor tab for the first time
- Use a loading spinner/skeleton as fallback

### 2. Lazy-load Milkdown (Markdown Editor)
- Same approach as Monaco — `React.lazy()` wrapper
- Only loaded when user opens a markdown file

### 3. Terminal LRU Pool (Virtualization)
- Keep a maximum of N (default: 5) xterm.js instances alive at any time
- When a terminal is evicted: serialize its scrollback buffer, destroy the xterm instance
- When a terminal is focused: recreate xterm instance, restore scrollback buffer (~20-50ms)
- **Rule: terminals with state `busy` are never evicted** — only idle/done/stopped terminals are candidates
- Pool size is configurable (could expose in settings later)
- Most-recently-used terminals stay in pool, least-recently-used get evicted

### 4. Async File Reads in ClaudeHookWatcher
- Replace `readFileSync` with `fs.promises.readFile` in the polling loop
- Increase `POLL_INTERVAL_MS` from 100ms to 250ms (state transitions are user-perceptible at 200-300ms, 100ms is unnecessarily aggressive)
- This unblocks the main process event loop

### 5. Deferred Worktree Loading
- On startup, only load worktrees for the active project
- Load worktrees for other projects when they are selected (lazy)
- Reduces N IPC round-trips at startup to 1

### 6. Vite Code Splitting
- Configure `build.rollupOptions.output.manualChunks` for:
  - `monaco-editor` (largest dependency)
  - `@milkdown/*` packages
  - `@dnd-kit/*` packages
- These chunks only load when their consuming components are rendered

## Approach Not Taken

### Full Zustand Store Refactor (Approach C)
Splitting the monolithic Zustand store into slices and adding `React.memo`/`useShallow` everywhere would reduce re-renders but is not the primary driver of the memory problem. The re-render overhead causes CPU/UI jank, not memory growth. This can be a follow-up optimization if needed.

### Terminal Process Pooling (Main Process)
An alternative was to also pool the PTY processes in the main process (not just xterm instances in the renderer). Rejected because PTY processes are relatively lightweight compared to xterm.js instances with their DOM elements and scrollback buffers. The PTY continues running and buffering data regardless.

## Resolved Questions

- **What happens when a evicted terminal receives output?** → Busy terminals are never evicted. Only idle/done/stopped terminals are candidates for eviction. If an evicted terminal somehow receives data, the main process buffers it.
- **Does terminal virtualization cause lag on fast switching?** → The LRU pool (default 5) means your actively-used terminals stay live. Only terminals untouched for a while get evicted and take ~20-50ms to restore.

## Resolved Questions (continued)

- **LRU pool default size:** 5, configurable in Settings from day 1.
- **Monaco lazy-load boundary:** Lazy-load the entire editor panel. Simpler, less code. Tab bar only appears when a file is opened anyway.
- **Scrollback buffer serialization:** Use xterm.js serialize addon. Preserves ANSI colors/styling on restore.

## Open Questions

None — ready for planning.
