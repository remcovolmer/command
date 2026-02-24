---
title: "feat: Performance & Memory Optimization"
type: feat
status: completed
date: 2026-02-23
origin: docs/brainstorms/2026-02-23-performance-optimization-brainstorm.md
---

# Performance & Memory Optimization

## Overview

Reduce Command's memory footprint for power users (5-10 projects, 10-20 terminals). Two biggest drivers: eager loading of heavy libraries (~3MB Monaco at startup) and all xterm.js terminals alive in memory simultaneously. Secondary: synchronous file reads in 100ms polling loop, all worktrees loaded at startup, no code splitting.

## Problem Statement

Memory is already high at startup before the user does anything. With 10-20 terminals, each xterm.js instance holds its own scrollback buffer, DOM elements, and addon state — even when hidden. Monaco Editor (~3MB JS) and Milkdown (ProseMirror-based) are parsed and initialized before React renders, regardless of use.

## Proposed Solution

Six changes in two phases: **Phase 1** (quick wins: lazy loading, async reads, deferred loading) and **Phase 2** (terminal LRU pool with serialization).

(see brainstorm: `docs/brainstorms/2026-02-23-performance-optimization-brainstorm.md`)

---

## Phase 1: Quick Wins

### 1.1 Lazy-Load Monaco Editor

**Current state:** `src/main.tsx:1` imports `monacoConfig.ts` which does `import * as monaco from 'monaco-editor'` — a full namespace import that blocks initial render.

**Change:**
- Remove `import './utils/monacoConfig'` from `src/main.tsx`
- In `src/components/Terminal/TerminalViewport.tsx`, replace static imports of `EditorContainer` and `DiffEditorView` with `React.lazy()`:
  ```tsx
  const EditorContainer = React.lazy(() => import('../Editor/EditorContainer'))
  const DiffEditorView = React.lazy(() => import('../Editor/DiffEditorView'))
  ```
- Move `loader.config({ monaco })` call into `EditorContainer.tsx` as a module-level side effect (runs when the lazy chunk loads, before any `<Editor>` mounts)
- Wrap lazy components in `<Suspense fallback={<EditorSkeleton />}>` with error boundary
- `monacoConfig.ts` content merges into `EditorContainer.tsx` top-level scope

**Files:**
- `src/main.tsx` — remove Monaco import
- `src/components/Terminal/TerminalViewport.tsx` — React.lazy wrappers + Suspense
- `src/components/Editor/EditorContainer.tsx` — absorb Monaco config, add error boundary
- `src/utils/monacoConfig.ts` — delete file
- New: `src/components/Editor/EditorSkeleton.tsx` — loading fallback component

**Risk:** CSP blocks CDN fetch if `loader.config()` doesn't run before first `<Editor>` mount. Mitigated by placing config at module scope in EditorContainer (executes synchronously when chunk loads).

### 1.2 Lazy-Load Milkdown

**Current state:** `EditorContainer.tsx:4` imports `MarkdownEditor` statically. Milkdown pulls in ProseMirror — significant bundle.

**Change:**
- In `EditorContainer.tsx`, replace static import with `React.lazy()`:
  ```tsx
  const MarkdownEditor = React.lazy(() => import('./MarkdownEditor'))
  ```
- Wrap in `<Suspense>` inside the WYSIWYG branch
- Same error boundary pattern as Monaco

**Files:**
- `src/components/Editor/EditorContainer.tsx` — lazy import for MarkdownEditor

**Note:** When user toggles Raw→WYSIWYG on a .md file, there's a one-time load delay for Milkdown. Acceptable trade-off.

### 1.3 Async File Reads in ClaudeHookWatcher

**Current state:** `ClaudeHookWatcher.ts:171` uses `readFileSync` inside `watchFile` callback (polling at 100ms). Blocks main process event loop.

**Change:**
- Replace `readFileSync` with `await fs.promises.readFile`
- Make `onStateChange()` async
- Add `isReading` guard to prevent concurrent reads:
  ```ts
  private isReading = false
  private async onStateChange(): Promise<void> {
    if (this.isReading) return
    this.isReading = true
    try { /* read + process */ }
    finally { this.isReading = false }
  }
  ```
- Increase `POLL_INTERVAL_MS` from `100` to `250`

**Files:**
- `electron/main/services/ClaudeHookWatcher.ts` — async read, guard, interval change

**Risk:** 250ms means brief `permission` states (<250ms) could be missed. In practice, permission prompts persist until user responds — acceptable.

### 1.4 Deferred Worktree Loading

**Current state:** `Sidebar.tsx:94-114` loads worktrees for ALL projects on mount, plus a second redundant load triggered by `projects.length` change.

**Change:**
- On startup, only call `loadWorktrees()` for `activeProjectId`
- Remove the redundant second `useEffect` (lines 108-114)
- Add `loadWorktrees()` call to the project-switch handler (when user clicks a project)
- Cache worktrees after first load (they're already stored in Zustand) — only refetch if explicitly requested or file watcher detects `.worktrees/` change

**Files:**
- `src/components/Sidebar/Sidebar.tsx` — modify startup useEffect, remove duplicate

**Edge case:** If `activeProjectId` is null at startup (fresh install), first project is auto-selected by `loadProjects()`. Worktree load triggers after active project is set via Zustand subscriber.

### 1.5 Vite Code Splitting

**Current state:** `vite.config.ts` has no code splitting. Everything in one renderer chunk.

**Change:**
- Vite auto-splits `React.lazy()` dynamic imports — no manual config needed for Phase 1
- Optionally add `manualChunks` for vendor splitting:
  ```ts
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco': ['monaco-editor', '@monaco-editor/react'],
          'milkdown': [/^@milkdown/].map(id => id.source),
          'dnd': [/^@dnd-kit/].map(id => id.source),
        }
      }
    }
  }
  ```

**Files:**
- `vite.config.ts` — add manualChunks to renderer build config

**Note:** Dynamic `import()` from React.lazy already triggers Vite code splitting. `manualChunks` ensures vendor libs land in predictable, cacheable chunks.

---

## Phase 2: Terminal LRU Pool

### 2.1 Architecture Decisions

These decisions were surfaced by SpecFlow analysis and resolve critical gaps:

**Pool scope: Global** — 5 xterm instances total across all projects. Goal is total memory reduction regardless of project count. (see brainstorm)

**Eviction protection:** Terminals with state `busy`, `permission`, or `question` are **never evicted**. These all require user attention. Only `done` and `stopped` terminals are eviction candidates. `stopped` terminals are evicted first (lowest priority).

**PTY data while evicted:** Main-process ring buffer. `TerminalManager` buffers incoming PTY data for terminals whose xterm is evicted. Buffer capped at 1MB per terminal. On restoration, buffered data is replayed after scrollback restore. Oldest data truncated if buffer overflows.

**LRU "use" definition:** Terminal tab becomes active by user action (click tab, keyboard shortcut Alt+N, split view). Receiving PTY data or state changes do NOT count as "use."

**Split view:** Terminals visible in split view are always in the pool (count toward limit, never evicted while visible). Both split panels are "active."

**Sidecar terminals:** Normal shell terminals participate in the same global pool. No special treatment.

**Serialization:** `@xterm/addon-serialize` for scrollback preservation. If serialization fails, eviction is aborted (terminal stays alive). Serialized data stored in-memory Map. Cap at 2MB per terminal (truncate oldest lines).

### 2.2 Add `@xterm/addon-serialize` Dependency

```bash
npm install @xterm/addon-serialize
```

### 2.3 Terminal Pool Manager

New utility class that manages the LRU pool logic.

**File:** `src/utils/terminalPool.ts`

```
class TerminalPool {
  private maxSize: number  // from settings
  private lruOrder: string[]  // terminal IDs, most-recent first
  private serializedBuffers: Map<string, string>  // evicted terminal scrollback

  touch(terminalId: string): void  // move to front of LRU
  getEvictionCandidate(terminals: Record<string, TerminalSession>): string | null
  isEvicted(terminalId: string): boolean
  serialize(terminalId: string, xterm: Terminal): string | null
  getSerializedBuffer(terminalId: string): string | null
  clearBuffer(terminalId: string): void
  setMaxSize(size: number): void
}
```

**Eviction algorithm:**
1. Filter terminals where state is `done` or `stopped`
2. Exclude terminals that are `isActive` or in split view
3. Sort by LRU order (least-recently-used first)
4. Prefer `stopped` terminals over `done`
5. Return first candidate, or null if all are protected

**Testing:** This class is pure logic — unit-testable without DOM or xterm.

### 2.4 Integrate Pool with Terminal Lifecycle

**`src/hooks/useXtermInstance.ts` changes:**
- Import `SerializeAddon`, load it alongside other addons
- Store `serializeAddon` ref for later use
- On eviction trigger: `serializeAddon.serialize()` → store in pool → `terminal.dispose()`
- On restoration trigger: create new xterm → `terminal.write(serializedBuffer)` → subscribe to events

**`src/components/Terminal/TerminalViewport.tsx` changes:**
- Before rendering `<Terminal>`, check if terminal is evicted
- If evicted and becoming active: trigger restoration flow
- If creating new terminal and pool is full: trigger eviction of LRU candidate

**`src/utils/terminalEvents.ts` changes:**
- When terminal is evicted, unsubscribe data callback but keep state/title callbacks
- When restored, resubscribe data callback

### 2.5 Main Process Data Buffering

**`electron/main/services/TerminalManager.ts` changes:**

Add ring buffer for evicted terminals:
```ts
private evictedBuffers: Map<string, { data: string[], totalSize: number }> = new Map()
private readonly MAX_BUFFER_SIZE = 1_048_576  // 1MB per terminal
```

- New IPC: `terminal:evict` (renderer → main) — signals that xterm was evicted, start buffering
- New IPC: `terminal:restore` (renderer → main) — signals xterm was restored, flush buffer
- Modify `pty.onData` handler: if terminal is evicted, push to ring buffer instead of IPC send
- On restore: send buffered data via `terminal:data` IPC, then resume normal forwarding

**`electron/preload/index.ts` changes:**
- Expose `terminal:evict` and `terminal:restore` channels

**`src/types/index.ts` changes:**
- Add `evictTerminal(id: string): void` and `restoreTerminal(id: string): Promise<string>` to ElectronAPI

### 2.6 Settings UI

**`src/stores/projectStore.ts` changes:**
- Add `terminalPoolSize: number` (default: 5) to persisted state
- Add to `partialize` function for persistence

**`src/components/Settings/GeneralSection.tsx` changes:**
- Add "Terminal Pool Size" number input (min: 2, max: 20)
- Label: "Maximum active terminals in memory"
- Description: "Terminals beyond this limit are suspended to save memory. Busy terminals are never suspended."
- On change: update store, call `terminalPool.setMaxSize(newSize)`, re-evaluate pool (may trigger evictions)

### 2.7 Hotkey (required by CLAUDE.md)

No new hotkeys required — this feature is transparent to the user. Existing terminal switching hotkeys (Alt+1-9, Ctrl+←/→) trigger LRU touch + potential restore.

---

## Technical Considerations

### Architecture Impact
- Terminal lifecycle gains a new "evicted" pseudo-state (xterm destroyed but PTY alive)
- Main process gains buffering responsibility for evicted terminals
- New IPC channels: `terminal:evict`, `terminal:restore`

### Performance Implications
- Phase 1: Immediate reduction in startup memory (Monaco deferred = ~3MB JS not parsed)
- Phase 2: Memory footprint scales with pool size (5), not total terminals (20)
- Terminal restoration latency: ~20-50ms for serialize/deserialize + buffer replay

### Security Considerations
- No new security surface. IPC channels follow existing validation patterns (UUID format check)
- Serialized terminal buffers stored in renderer process memory only

---

## System-Wide Impact

- **Interaction graph**: Terminal eviction → `terminalEvents.unsubscribe` (data only) → `TerminalManager.evict` IPC → main process starts buffering. Restoration reverses this.
- **Error propagation**: Serialization failure → eviction aborted → pool stays at capacity → no eviction until a terminal closes or becomes `stopped`
- **State lifecycle risks**: Race between eviction and incoming state change: mitigated by keeping state/title event subscriptions active even for evicted terminals. Only the data callback is removed.
- **API surface parity**: `terminal:create`, `terminal:close`, `terminal:write`, `terminal:resize` are unaffected. New `terminal:evict` and `terminal:restore` are additive.

---

## Acceptance Criteria

### Phase 1
- [x] Monaco Editor does NOT load at startup — verify with DevTools Network tab
- [x] Opening first file triggers Monaco chunk load, editor renders correctly
- [x] Milkdown loads only when .md file opened in WYSIWYG mode
- [x] `ClaudeHookWatcher` uses async `readFile` — no `readFileSync` in codebase
- [x] Polling interval is 250ms
- [x] Only active project worktrees load at startup
- [x] Switching to inactive project loads its worktrees on demand
- [x] Vite build produces separate chunks for Monaco, Milkdown

### Phase 2
- [x] With pool size 5 and 10 terminals open, only 5 xterm instances exist in DOM
- [x] Clicking an evicted terminal tab restores it within 100ms
- [x] Restored terminal shows complete scrollback (ANSI colors preserved)
- [x] Busy/permission/question terminals are never evicted
- [x] Terminal in split view is never evicted while visible
- [x] PTY data arriving while evicted is buffered and replayed on restore
- [x] Pool size configurable in Settings (min 2, max 20)
- [x] Changing pool size immediately triggers eviction if needed
- [x] `stopped` terminals evicted before `done` terminals

### Regression
- [x] All existing terminal hotkeys work (Alt+1-9, Ctrl+←/→)
- [x] Split view works with pool (both panels alive)
- [x] Session restore on app restart works correctly
- [x] Claude state detection works for evicted terminals (state still tracked)
- [x] File editor works correctly with lazy-loaded Monaco
- [x] CSP does not block Monaco (local package, not CDN)

---

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Monaco CSP failure with lazy load | Medium | High (editor broken) | Test config placement in lazy boundary; error boundary with retry |
| xterm serialize doesn't preserve all content | Low | Medium (visual glitch) | Test with ANSI-heavy output, Unicode, wide chars |
| Race condition in eviction during rapid switching | Medium | Low (brief flicker) | Debounce eviction; ensure LRU touch is synchronous |
| Main process buffer grows large for chatty terminals | Low | Medium (memory) | 1MB cap per terminal with truncation |
| Pool re-evaluation on settings change causes visible flicker | Low | Low (UX) | Batch evictions in single React render cycle |

---

## Implementation Order

1. **Vite code splitting** — build config only, zero runtime risk
2. **Async ClaudeHookWatcher** — small, contained main-process change
3. **Deferred worktree loading** — small, sidebar-only change
4. **Lazy-load Monaco** — moderate risk (CSP), test thoroughly
5. **Lazy-load Milkdown** — low risk once Monaco pattern works
6. **Terminal LRU Pool** — highest complexity, implement last when all else is stable

---

## Sources & References

### Origin
- **Brainstorm document:** [docs/brainstorms/2026-02-23-performance-optimization-brainstorm.md](docs/brainstorms/2026-02-23-performance-optimization-brainstorm.md) — Key decisions: lazy-load Monaco/Milkdown, terminal LRU pool (5, configurable), async hook watcher, deferred worktrees, xterm serialize addon

### Internal References
- Monaco eager import: `src/main.tsx:1`, `src/utils/monacoConfig.ts:1-6`
- Terminal lifecycle: `src/hooks/useXtermInstance.ts:112-268`
- Hook watcher polling: `electron/main/services/ClaudeHookWatcher.ts:10,95-108,169-185`
- Worktree double-load: `src/components/Sidebar/Sidebar.tsx:94-114`
- Settings system: `src/components/Settings/GeneralSection.tsx`
- Terminal data flow: `electron/main/services/TerminalManager.ts:107-109`
- FileWatcher memory leak fix (reusable patterns): `docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md`

### Institutional Learnings Applied
- **Promise-chain lock** from FileWatcher fix — applicable to terminal pool serialization ordering
- **Zustand subscriber pattern** from FileWatcher fix — applicable to deferred worktree loading trigger
- **Resource centralization** principle — terminal pool is the centralized resource manager for xterm instances
