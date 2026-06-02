---
title: "Chat scrollbar disappears in long conversations because FitAddon.fit() is a no-op when dimensions are unchanged"
date: 2026-06-02
category: ui-bugs
module: Terminal / xterm rendering
problem_type: ui_bug
component:
  - src/hooks/useXtermInstance.ts
  - src/components/Terminal/Terminal.tsx
  - src/components/Terminal/TerminalViewport.tsx
symptoms:
  - "In a long Claude chat the scrollbar stops working — you cannot scroll back through history"
  - "Dragging the right-hand panel divider (resizing the chat) is the only thing that brings scrolling back"
  - "Happens intermittently and correlates with conversation length, not with any specific action"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags:
  - xterm
  - fit-addon
  - scrollbar
  - viewport
  - react
  - electron
  - rendering
---

# Chat scrollbar disappears in long conversations because FitAddon.fit() is a no-op when dimensions are unchanged

## Problem

In Claude chat terminals the xterm scrollbar intermittently became unusable in long conversations: the user could no longer scroll back, and the only recovery was to drag the right-hand panel divider to resize the chat. The trigger correlated with buffer growth (long conversations), not with a specific user action.

## Symptoms

- Scrollbar present but not draggable / scroll-back broken in a long chat.
- Dragging the sidebar/panel divider (which resizes the chat) instantly restores scrolling.
- Intermittent; scales with how much output the conversation has produced.

## What Didn't Work

- **Re-fitting on Claude state and focus changes** (PR #38 / commit `f599f58`, plan `docs/plans/2026-02-15-fix-scrollbar-disappears-on-state-change-plan.md`). It added `safeFit()` calls when the terminal state changed or the tab regained focus. This had no effect in the reported scenario because every one of those paths calls `FitAddon.fit()`, and `fit()` is a **no-op when the proposed cols/rows equal the current cols/rows** — which is exactly the case when only the buffer grew but the container size stayed the same.
- **CSS `overflow-y: scroll`** (same plan) forces the scrollbar *track* to always render, but does not make a stale viewport scrollable — the thumb is still computed from xterm's internal scroll-area geometry.

## Solution

Three changes (PR `remcovolmer/command#128`):

1. **`useXtermInstance.ts` — force a real viewport resync when `fit()` was a no-op.** Detect whether `fit()` actually resized by comparing cols/rows before and after; if unchanged, force xterm's internal viewport to re-sync its scroll-area geometry.

   ```ts
   const term = terminalRef.current
   const prevCols = term.cols
   const prevRows = term.rows
   fitAddonRef.current.fit()
   // fit() is a complete no-op when proposed dims equal current dims, so it
   // never re-syncs the viewport scroll area. Force it when the buffer grew
   // but the container size did not change.
   if (term.cols === prevCols && term.rows === prevRows) {
     const core = term as unknown as {
       _core?: { viewport?: { syncScrollArea?: (immediate?: boolean) => void } }
     }
     core._core?.viewport?.syncScrollArea?.(true)
   }
   ```

2. **`Terminal.tsx` — stop using `display:none` for inactive center terminals.** Switch to `absolute inset-0` + `visibility:hidden`, mirroring the already-working `SidecarTerminalPanel`. `display:none` zeroes layout, which throttles xterm's `requestAnimationFrame`-driven viewport sync and lets it go stale while a tab is hidden.

   ```tsx
   // before: className={`... ${isActive ? 'block ...' : 'hidden ...'}`}  // hidden = display:none
   // after:
   className="terminal-container absolute inset-0 bg-sidebar"
   style={{ visibility: isActive ? 'visible' : 'hidden', pointerEvents: isActive ? 'auto' : 'none' }}
   ```

3. **`TerminalViewport.tsx` — add `relative` to the two wrappers that hold a `<Terminal>`** (the stacked map wrapper and the `SplitPanel` wrapper), so the now-`absolute` terminals anchor and fill correctly.

## Why This Works

xterm's scrollability is governed by `Viewport.syncScrollArea()` → `_innerRefresh()`, which sets the viewport's scrollable pixel height. Verified in `@xterm/addon-fit`, `fit()` does:

```js
this._terminal.rows === proposed.rows && this._terminal.cols === proposed.cols
  || (core._renderService.clear(), this._terminal.resize(proposed.cols, proposed.rows))
```

So when proposed dimensions equal the current ones, `fit()` skips `terminal.resize()` entirely — and `resize()` is what triggers `_afterResize` → `viewport.syncScrollArea(true)` and the `onDimensionsChange` → `syncScrollArea()` listeners. Dragging the divider works precisely because it *changes* the container size, forcing a real `resize()` and thus a resync. Calling `syncScrollArea(true)` directly reproduces that resync without needing a size change.

The `display:none` → `visibility:hidden` change addresses the upstream trigger: the non-immediate sync path defers via `requestAnimationFrame`, and rAF is throttled for `display:none`/unpainted elements, so a hidden tab's scroll-area geometry can go stale and the buffer-length guard inside `syncScrollArea` then prevents a later recompute. Keeping layout dimensions (as the sidecar already does) keeps those syncs valid.

## Prevention

- **Never assume `fitAddon.fit()` re-syncs the viewport.** It only does work when proposed cols/rows differ from current. If you need a guaranteed viewport refresh without a size change, force `viewport.syncScrollArea(true)` (or perform a real resize). Two consecutive fixes here made the same wrong assumption.
- **Prefer `visibility:hidden` over `display:none` for mounted-but-inactive xterm terminals**, so rAF-driven viewport syncs stay valid. The sidecar (`SidecarTerminalPanel`) was the correct precedent the whole time.
- This is a visual/DOM behavior that is not unit-testable headless. Verify manually: let a chat scroll past one screen → scroll works without dragging; switch tabs and back; check split-view and an open editor tab for layout regressions.

## Related Issues

- PR `remcovolmer/command#128` — this fix.
- PR `remcovolmer/command#38` (commit `f599f58`) — the earlier, structurally-insufficient fix.
- `docs/plans/2026-02-15-fix-scrollbar-disappears-on-state-change-plan.md` — original plan; flagged `display:none` as a root cause but the shipped fix never addressed it.
- `docs/solutions/performance-issues/terminal-lru-pooling-memory-optimization.md` — related `useXtermInstance` / pooling context.
