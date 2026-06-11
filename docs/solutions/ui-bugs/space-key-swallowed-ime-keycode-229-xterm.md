---
title: "Space key intermittently stops working in Claude chats because xterm.js drops IME-processed (keyCode 229) keydowns by design"
date: 2026-06-11
category: ui-bugs
module: Terminal / xterm keyboard input
problem_type: ui_bug
component:
  - src/hooks/useXtermInstance.ts
  - src/utils/spaceKeyWatchdog.ts
symptoms:
  - "After a while, the spacebar stops producing spaces in a Claude chat — every other key keeps working"
  - "Clicking another window and back to Command Center fixes it instantly"
  - "No reproducible pattern; intermittent and per-terminal"
root_cause: upstream_behavior
resolution_type: code_fix
severity: medium
tags:
  - xterm
  - keyboard
  - ime
  - keycode-229
  - composition
  - windows
  - electron
---

# Space key intermittently stops working in Claude chats because xterm.js drops IME-processed (keyCode 229) keydowns by design

## Problem

In Claude chat terminals the spacebar would intermittently stop working: all other characters typed fine, only spaces vanished. Switching to another window and back restored it. No pattern was visible to the user.

## Root cause

Two facts combine:

1. **xterm.js never processes keyCode-229 keydowns as keys.** In `CompositionHelper.keydown` (verified in @xterm/xterm 5.5.0), any keydown with `keyCode === 229` ("processed by IME") returns `false`; xterm then only forwards *textarea diffs* (`_handleAnyTextareaChanges`) to the PTY.
2. **An OS-level IME/text-suggestion layer treats space as a control key** (commit/accept), not as text. When such a layer latches onto xterm's hidden helper textarea, letters survive (the layer inserts them into the textarea, so the diff path forwards them) but space inserts nothing — the diff is empty and the keystroke silently vanishes.

This is why *only* space broke: space is the one printable key that IME layers consume without producing text. The window-switch workaround worked because blurring the textarea resets the IME's per-element state, and `App.tsx` refocuses the active terminal's textarea on window focus.

The exact Windows layer that latches on was not pinned down (user had US layout, hardware text suggestions off), so the fix observes *outcomes* instead of pattern-matching broken event shapes. The same only-spaces-vanish signature is documented upstream in [anthropics/claude-code#43429](https://github.com/anthropics/claude-code/issues/43429).

## Solution

`createSpaceKeyWatchdog` (src/utils/spaceKeyWatchdog.ts), wired into `useXtermInstance`:

- Every plain space keydown (`event.code === 'Space'`, no Ctrl/Alt/Meta, not `isComposing`) arms an 80ms timer via `attachCustomKeyEventHandler`.
- Any `terminal.onData` chunk containing a space disarms pending timers. In the normal path xterm emits the space synchronously during the same keydown dispatch, so the timer only fires when the space was actually dropped.
- On fire, the watchdog writes `' '` straight to the PTY (`api.terminal.write`), bypassing the broken keyboard path.
- `event.isComposing` guard keeps real CJK composition intact (there, space legitimately selects a candidate).

## Key learnings

- **xterm.js trusts the IME completely for keyCode-229 events.** If the IME consumes a key without mutating the hidden textarea, the key is gone — xterm has no fallback. Any key an IME treats as a control key (space, sometimes Enter) can silently vanish.
- **"Only key X fails, focus-switch fixes it" is an IME/composition signature**, not an app-handler bug. App-level key handlers were ruled out first: they only intercept specific Ctrl-combos and Escape.
- **Detect outcomes, not event shapes.** The broken events' `key`/`keyCode` values vary per IME layer ('Process', 'Unidentified', 229). Watching whether the expected data reached the PTY is robust against all variants.
- **`event.code` is the layout- and IME-independent way** to identify the physical key when `event.key` has been rewritten by an input method.

## Diagnostic path (for similar bugs)

1. Verify the suspect key and working keys take the same code path (here: deminified `Terminal._keyDown` showed space and lowercase letters are identical — so the divergence had to be upstream of xterm's handler).
2. Enumerate every capture-phase/document-level key listener in the app and check what they can swallow.
3. Map the user's workaround to code: "window switch fixes it" → `window focus → refocusActiveTerminal()` → textarea blur/refocus → IME state reset.

Full analysis with causal chain and evidence table: `docs/analyse/2026-06-11-spatie-werkt-niet.html`.
