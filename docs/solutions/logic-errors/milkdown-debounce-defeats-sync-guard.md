---
title: Milkdown's debounced markdownUpdated defeats sync guards when reconciling two editable panes
date: 2026-06-10
category: logic-errors
module: Markdown editor (raw/preview dual-pane)
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "A genuine edit made in the Milkdown preview within ~400ms of a programmatic content push is silently dropped, so the canonical buffer and dirty flag never update"
  - "The canonical buffer gets overwritten with Milkdown's round-trip-normalized markdown after a programmatic replaceAll, spuriously marking a clean tab dirty"
  - "A synchronous boolean syncing flag set true then false around editor.action(replaceAll(content)) does not suppress the resulting markdownUpdated callback"
root_cause: async_timing
resolution_type: code_fix
severity: medium
related_components: ["monaco-editor", "milkdown", "file-watcher"]
tags: ["milkdown", "markdown-editor", "debounce", "async-timing", "edit-loss", "reconciliation", "monaco", "dirty-state"]
---

# Milkdown's debounced markdownUpdated defeats sync guards when reconciling two editable panes

## Problem

When the markdown editor keeps a Monaco (raw) pane and a Milkdown (preview) pane both mounted and reconciles content on toggle, the obvious "suppress the change event caused by my own programmatic write" guard silently fails for the Milkdown side — because Milkdown's `markdownUpdated` listener is debounced ~200ms. The programmatic-write echo therefore arrives *after* any synchronous guard has been cleared, and a naive time-window guard built to catch it also swallows genuine user edits made in that window (silent edit-loss).

## Symptoms

- A genuine edit made in the preview within the suppress window of a programmatic push is silently dropped — canonical buffer and dirty indicator do not update, so the edit can be lost on save-from-the-other-pane or on tab close.
- After a programmatic `replaceAll`, the canonical buffer is overwritten with Milkdown's re-serialized (normalized) markdown, spuriously marking a clean tab dirty.
- A synchronous boolean flag (`syncing = true; replace(); syncing = false`) suppresses the echo for Monaco but not for Milkdown.

## What Didn't Work

- **Synchronous boolean guard** (`syncingRef` set true → `editor.action(replaceAll(content))` → set false): this works for **Monaco** because `model.onDidChangeContent` (and thus `@monaco-editor/react`'s `onChange`) fires *synchronously* during `setValue`, so the flag is still `true` when the event arrives. It does **not** work for **Milkdown**: `@milkdown/plugin-listener` runs the `markdownUpdated` callback through a lodash `debounce(fn, 200)` inside the ProseMirror plugin's `apply`, so the echo fires ~200ms later, by which point the flag is already `false`. The echo then re-enters the change handler and corrupts the canonical buffer / marks dirty.
- **Time-only suppress window** (ignore *all* preview change events for ~400ms after a push): this suppresses the bounce, but it cannot distinguish the bounce from a real edit. A user who edits in the preview within the window has that edit dropped too — the very edit-preservation the feature exists to provide.

## Solution

Suppress with **value AND time**: record the exact content last pushed, and ignore a preview change event only when it arrives within the window *and* its markdown equals what was pushed. A genuine edit differs in value, so it is never suppressed — even one made inside the window — while the same-value bounce is. The time bound prevents a stale "last pushed" value from swallowing a much-later identical edit.

```ts
// constants / refs
const PREVIEW_BOUNCE_SUPPRESS_MS = 400          // > Milkdown's 200ms debounce
const suppressPreviewUntilRef = useRef(0)
const lastPushedToPreviewRef = useRef<string | null>(null)

// when pushing canonical content into the preview programmatically:
lastPushedToPreviewRef.current = canonical
suppressPreviewUntilRef.current = Date.now() + PREVIEW_BOUNCE_SUPPRESS_MS
previewHandle.replace(canonical)

// the preview's markdownUpdated handler:
function handlePreviewUpdated(markdown: string) {
  // bounce = within window AND same value; a real edit differs in value
  if (Date.now() < suppressPreviewUntilRef.current && markdown === lastPushedToPreviewRef.current) {
    return
  }
  currentContentRef.current = markdown
  updateDirty(markdown)
}
```

Confirmed from the listener source: `markdownUpdated` does **not** fire on initial document load (the plugin's `state.init` only seeds `prevDoc`/`prevMarkdown`), so files do not open dirty.

## Why This Works

The two editors have opposite change-event timing. Monaco's content event is synchronous with `setValue`, so a flag that brackets the call catches it. Milkdown's is debounced, so a synchronous flag is already gone when the echo lands. Matching on the pushed *value* rather than only on *time* lets the handler tell the programmatic echo (same string we just wrote — at most round-trip-normalized) apart from a real edit (a different string), which is exactly the discrimination a time-only window cannot make. Keeping the time bound on top avoids a corner case where a stale `lastPushed` value would suppress a genuinely-new edit that happens to equal it much later.

## Prevention

- **Verify a change listener's timing before guarding its echo.** Do not assume a synchronous "I'm writing" flag suppresses the event from a programmatic write. Check the plugin/source for `debounce`/`throttle`/`setTimeout` (Milkdown's listener debounces 200ms). When the write and user edits share one event, prefer **value-based** (or value+time) suppression over time-only.
- **Only push when content actually changed.** Gate the programmatic push behind a `needsSync(canonical, paneLastHeld)` equality check so an unchanged pane is never rebuilt — this is also what preserves its scroll position on toggle.
- **Never let an external reload clobber a dirty buffer.** A file-watcher "apply" should skip whenever the buffer is dirty — even when disk equals the last save (a spurious/same-content event has nothing new to adopt and would discard unsaved edits).
- **Extract the decisions as pure functions** (`needsSync`, `computeDirty`, the reload decision, the suppression predicate) so they are unit-testable without mounting Monaco/Milkdown, which do not run in jsdom. The component wiring then needs only manual QA for scroll/layout.

## Related Issues

- `docs/solutions/logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md` — sibling editor learning; save must be a single `isActive`-gated handler, which is what keeps a hidden-but-mounted pane from also saving.
- `docs/solutions/ui-bugs/chat-scrollbar-disappears-fitaddon-fit-noop.md` — why the dual-pane toggle uses `visibility:hidden` (not `display:none`): hidden panes keep layout/scroll geometry.
- `docs/solutions/performance-issues/terminal-lru-pooling-memory-optimization.md` — the lazy/code-split boundary that keeps Monaco/Milkdown out of the main bundle still holds with both panes mounted.
- PR #130 — the dual-pane raw/preview scroll + edit-preservation change where this surfaced.
