---
title: Fix scrollbar disappears on terminal state change
type: fix
status: completed
date: 2026-02-15
---

# Fix: Scrollbar disappears on terminal state change

## Overview

The xterm.js scrollbar intermittently disappears on both the center chat terminals and the right sidebar (sidecar) terminals. The user primarily notices this when Claude finishes (state changes to "done"), but it can happen at other times. Resizing the window brings the scrollbar back, which confirms the issue is related to xterm.js viewport dimensions being stale.

## Problem Statement

When Claude's state changes (e.g., to "done"), the Zustand store update triggers React re-renders across tab bars and state indicators. While these re-renders don't change the terminal container's dimensions (so ResizeObserver doesn't fire), they can cause xterm.js's internal viewport to get out of sync with the actual container size. The native scrollbar — controlled by `overflow-y: auto !important` — then disappears because the browser thinks there's nothing to scroll.

### Root Causes

1. **`overflow-y: auto !important` on `.xterm-viewport`** (`src/index.css:167`): The scrollbar only appears when content overflows the viewport. If xterm's internal viewport dimensions are stale, the browser calculates "no overflow" and hides the scrollbar. Using `auto` instead of `scroll` makes the scrollbar fragile.

2. **No re-fit after state changes**: When Claude finishes, `updateTerminalState()` triggers re-renders but no `safeFit()` call. Small layout shifts from re-rendered tab bar indicators can desync the viewport without triggering ResizeObserver.

3. **`display: none` on inactive center terminals** (`src/components/Terminal/Terminal.tsx:23`): The Tailwind `hidden` class sets `display: none`, which prevents ResizeObserver from firing. Any layout changes while a terminal is hidden are missed entirely. The 50ms `FOCUS_REFIT_DELAY_MS` when switching back may be insufficient.

4. **Competing `safeFit()` calls cancel each other** (`src/hooks/useXtermInstance.ts:62-64`): The shared `retryTimeoutRef` means concurrent `safeFit()` calls (from ResizeObserver + focus refit) can cancel each other's retry chains, leaving the terminal unfitted.

## Proposed Solution

A two-part fix targeting the root causes:

### Part 1: CSS — Always show scrollbar track (`src/index.css`)

Change `overflow-y: auto !important` to `overflow-y: scroll !important` on `.xterm-viewport`. This ensures the scrollbar track is always visible, preventing visual "disappearance" even when dimensions are briefly stale. This is the standard approach for terminal emulators.

```css
/* Before */
.terminal-container .xterm-viewport {
  overflow-y: auto !important;
}

/* After */
.terminal-container .xterm-viewport {
  overflow-y: scroll !important;
}
```

### Part 2: Re-fit on state change (`src/hooks/useXtermInstance.ts`)

Subscribe to state changes within `useXtermInstance` and trigger a `safeFit()` when the terminal's Claude state updates. This ensures dimensions stay correct across state transitions.

Add a `useEffect` that watches the terminal's state from the store and calls `safeFit()`:

```tsx
// Re-fit when terminal state changes (e.g. Claude finishes)
const terminalState = useProjectStore((s) => s.terminals[id]?.state)

useEffect(() => {
  if (isActive && terminalRef.current && isReadyRef.current) {
    const timer = setTimeout(() => {
      safeFit()
    }, FOCUS_REFIT_DELAY_MS)
    return () => clearTimeout(timer)
  }
}, [terminalState, isActive, safeFit])
```

## Technical Considerations

- **`overflow-y: scroll` visual impact**: Shows an empty scrollbar track when terminal has minimal content. This is standard terminal behavior (VS Code, iTerm2, Windows Terminal all do this) and is not a UX concern.
- **Performance**: The additional `safeFit()` on state change is infrequent (only when Claude transitions states) and already debounced/guarded internally.
- **No changes to sidecar terminals**: The sidecar already uses `visibility: hidden` (not `display: none`), so it handles resize better. The CSS fix covers both center and sidecar terminals.

## Acceptance Criteria

- [ ] Scrollbar remains visible on center chat terminal when Claude finishes
- [ ] Scrollbar remains visible on sidecar terminal when Claude finishes
- [ ] Scrollbar works correctly after switching between terminal tabs
- [ ] Window resize still works as before
- [ ] Split view terminals retain scrollbars
- [ ] No visual regression on scrollbar appearance

## Files to Change

| File | Change |
|------|--------|
| `src/index.css:167` | Change `overflow-y: auto` to `overflow-y: scroll` |
| `src/hooks/useXtermInstance.ts` | Add state-change `useEffect` to trigger `safeFit()` |
