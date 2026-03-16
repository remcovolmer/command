---
title: "fix: Sidecar terminal goes black due to LRU pool eviction"
type: fix
status: completed
date: 2026-03-14
---

# fix: Sidecar terminal goes black due to LRU pool eviction

## Overview

When typing in a Claude chat terminal and pressing Enter, the sidecar (plain shell) terminal in the right panel suddenly goes black — content disappears, leaving only a black rectangle. The terminal component remains mounted but the xterm.js instance has been destroyed.

## Root Cause

The `TerminalPool` singleton manages LRU eviction for **all** xterm.js instances — both center (Claude chat) terminals and sidecar (plain shell) terminals. However, only center terminal IDs are protected from eviction:

```typescript
// TerminalViewport.tsx:42 — only center terminals are protected
useTerminalPool(activeTerminalId, splitTerminalIds)
```

**The eviction flow:**

1. User presses Enter in a Claude chat terminal
2. `useXtermInstance` calls `terminalPool.touch(chatTerminalId)` — moves chat to front of LRU
3. `useTerminalPool` effect fires, sees pool exceeds `maxSize` (default 5)
4. `getEvictionCandidate()` filters by `activeTerminalId` and `splitTerminalIds` — both are center-only IDs
5. Active sidecar terminal is **not** protected → becomes eviction candidate
6. `evict()` serializes scrollback, calls cleanup (destroys xterm DOM), marks as evicted
7. `SidecarTerminalInstance` React component stays mounted with `isActive={true}`
8. Since `isActive` didn't change, the init effect in `useXtermInstance` doesn't re-fire
9. Result: black rectangle where the terminal used to be

**Key files:**
- `src/utils/terminalPool.ts:106` — `getEvictionCandidate` has no sidecar awareness
- `src/hooks/useTerminalPool.ts:13` — only receives center terminal IDs
- `src/hooks/useXtermInstance.ts` — shared by both center and sidecar, registers all in same pool
- `src/components/FileExplorer/SidecarTerminalPanel.tsx:35` — sidecar uses `useXtermInstance`

## Proposed Solution

**Exclude sidecar terminals from pool eviction** by filtering on terminal type in `getEvictionCandidate`.

Sidecar terminals are already capped at 5 per context and are lightweight. The pool limit exists to manage expensive Claude chat xterm instances, not sidecar shells. Excluding them is the simplest fix with zero risk of memory issues.

### Implementation

**File: `src/utils/terminalPool.ts` — `getEvictionCandidate` (line 113)**

Add a type check to the candidate filter:

```typescript
const candidates = this.lruOrder.filter(id => {
  if (this.evictedSet.has(id)) return false
  if (id === activeTerminalId) return false
  if (splitSet.has(id)) return false
  const terminal = terminals[id]
  if (!terminal) return false
  if (terminal.type === 'normal') return false  // <-- NEW: never evict sidecar terminals
  if (PROTECTED_STATES.has(terminal.state)) return false
  return true
})
```

**That's the entire fix — one line.**

### Alternative Considered

Pass `activeSidecarTerminalId` into `useTerminalPool` as an additional protected ID. Rejected because:
- More complex (threading IDs through component hierarchy)
- Still allows inactive sidecar terminals to be evicted
- Sidecar terminals are lightweight enough to never need eviction

## Acceptance Criteria

- [x] Active sidecar terminal does not go black when interacting with Claude chat terminals
- [x] Sidecar terminals are excluded from pool eviction candidates (`terminalPool.ts`)
- [x] Existing center terminal eviction behavior is unchanged
- [x] Pool size limit still works correctly for Claude chat terminals
- [x] Unit test in `test/terminalPool.test.ts` covers sidecar exclusion

## Context

- Sidecar terminals: max 5 per context, `type: 'normal'`
- Claude chat terminals: max 10 per project, `type: 'claude'`
- Pool default size: 5 active xterm instances
- Documented learning: `docs/solutions/performance-issues/terminal-lru-pooling-memory-optimization.md`
