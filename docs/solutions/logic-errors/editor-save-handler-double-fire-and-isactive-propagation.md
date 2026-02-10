---
title: "Editor Save Handler: Double-Fire, isActive Propagation, and Stale Closure Bugs"
date: 2026-02-09
category: logic-errors
tags:
  - electron
  - react
  - monaco-editor
  - event-handling
  - keyboard-shortcuts
  - useCallback
  - stale-closure
severity: medium
component: Editor
symptoms:
  - Ctrl+S triggers two concurrent file writes when Monaco editor has focus
  - Inactive markdown editor tabs intercept save events meant for active tab
  - Potential stale closure in Monaco addCommand callback
root_cause: "Overlapping event handler layers (Monaco addCommand + document keydown) combined with useHotkeys textarea bailout; hardcoded isActive={true} in EditorContainer; stale useCallback reference captured by Monaco onMount"
pr: "#29"
---

# Editor Save Handler: Double-Fire, isActive Propagation, and Stale Closure Bugs

## Problem Statement

PR #29 ("fix: make Ctrl+S save work reliably in editors") introduced a multi-layer save architecture to ensure Ctrl+S works regardless of focus context. Code review by 6 parallel agents discovered 3 bugs in the implementation.

### Symptoms

1. Two concurrent `api.fs.writeFile()` IPC calls fire on every Ctrl+S when Monaco has focus
2. Inactive markdown editor tabs respond to global save events
3. Monaco's internal Ctrl+S handler could capture a stale `saveFile` reference

## Investigation

### Event Flow Analysis

The hotkey system uses a **capture-phase** `keydown` listener on `window` (`useHotkeys.ts`). When it matches a hotkey, it calls `e.preventDefault()` + `e.stopPropagation()` and executes the handler.

The `editor.save` handler in `App.tsx` dispatches a `CustomEvent('editor-save-request')` on `window`, which editors listen for.

**Critical discovery:** The `useHotkeys` hook has an input-target guard (lines 46-68) that **bails out early** when `e.target` is an `INPUT`, `TEXTAREA`, or `contentEditable` element (except xterm textareas):

```typescript
// useHotkeys.ts
const isXtermTextarea = target.classList.contains('xterm-helper-textarea');
if (
  !isXtermTextarea && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
) {
  return; // Bails out — no preventDefault, no stopPropagation
}
```

Monaco uses a hidden `<textarea>` internally. This textarea does NOT have the `xterm-helper-textarea` class. So when Monaco has focus, `useHotkeys` bails out silently.

### Double-Save Trace (Monaco focused)

| Step | Handler | Fires? | Result |
|------|---------|--------|--------|
| 1 | `useHotkeys` (window, capture) | Bails out (textarea guard) | No `stopPropagation`, no CustomEvent dispatched |
| 2 | Monaco `addCommand` (internal) | Yes | `saveFile()` called — **first save** |
| 3 | Document `keydown` (bubble) | Yes (propagation not stopped) | `saveFile()` called — **second save** |
| 4 | `editor-save-request` listener | No (CustomEvent never dispatched) | — |

### isActive Propagation Trace

```
EditorContainer (isActive=false → display:none)
  └─ MarkdownEditor (isActive={true} ← hardcoded!)
       └─ EditorControls registers document keydown + editor-save-request listeners
          → Inactive tab intercepts saves!
```

### Stale Closure in handleMount

```typescript
const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor
    editor.addCommand(2048 | 49, () => saveFile()) // captures saveFile ref
}, [saveFile])
```

Monaco's `onMount` fires once. Even though `handleMount` has `[saveFile]` as dependency, the `addCommand` closure captures the `saveFile` reference at mount time. If `saveFile` is recreated (e.g., `filePath` changes), Monaco's internal handler calls the stale version.

## Root Cause

1. **Double-save:** The `useHotkeys` textarea guard creates a blind spot where neither `stopPropagation` is called nor the `editor-save-request` CustomEvent is dispatched. Both Monaco's `addCommand` and the backup document `keydown` handler fire independently.

2. **isActive propagation:** `EditorContainer` uses a ternary to render either `MarkdownEditor` or `CodeEditor`, always passing `isActive={true}`. The container's own visibility (`display: none`) doesn't prevent children from registering global event listeners.

3. **Stale closure:** `addCommand` captures the callback at mount time. The `useCallback` dependency array causes `handleMount` to change, but Monaco doesn't re-invoke `onMount` — so the old closure persists.

## Solution

### Fix 1+3: Remove Monaco addCommand (CodeEditor.tsx)

Removing `addCommand` eliminates both the double-save and the stale closure:

```typescript
// Before
const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor
    editor.addCommand(2048 | 49, () => saveFile())
}, [saveFile])

// After
const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor
}, [])
```

The two remaining layers provide complete coverage:

| Focus location | Save handler |
|---------------|-------------|
| Monaco / Milkdown (in-editor) | Document `keydown` listener (bubble phase) |
| Terminal, sidebar, buttons | `editor-save-request` CustomEvent via `useHotkeys` |

### Fix 2: Pass real isActive (EditorContainer.tsx)

```typescript
// Before
<MarkdownEditor tabId={tabId} filePath={filePath} isActive={true} />
<CodeEditor tabId={tabId} filePath={filePath} isActive={true} />

// After
<MarkdownEditor tabId={tabId} filePath={filePath} isActive={isActive} />
<CodeEditor tabId={tabId} filePath={filePath} isActive={isActive} />
```

### Net Result

- **-9 lines** of code
- 3 bugs fixed
- Simpler `handleMount` with empty dependency array
- Only active tab responds to save events

## Verification

- All 3 Vitest tests pass
- Manual verification: Ctrl+S saves in Monaco, Milkdown, and when focus is outside editor

## Prevention Strategies

### 1. Event Handler Layering

**Rule:** When building multi-layer keyboard handling, trace the complete event flow for every focus scenario. Create a matrix:

| Focus target | Handler A fires? | Handler B fires? | Handler C fires? |
|-------------|-----------------|-----------------|-----------------|

Watch for rows where multiple handlers fire for the same action.

**Test idea:** Unit test that mocks `dispatchEvent` and verifies `saveFile` is called exactly once per Ctrl+S, regardless of `document.activeElement`.

### 2. Prop Propagation Through Container Components

**Rule:** Container components that manage visibility (`display: none`) must propagate their `isActive`/`visible` state to children that register global event listeners. Never hardcode `isActive={true}` for children of a conditionally-visible container.

**Test idea:** Render the component with `isActive=false`, dispatch a `keydown` event, and assert the save callback was NOT called.

### 3. Stale Closures in Third-Party Editor Integration

**Rule:** When passing callbacks to third-party editors that only invoke them once (like Monaco's `onMount`), use a ref pattern to avoid stale closures:

```typescript
const saveFileRef = useRef(saveFile)
saveFileRef.current = saveFile

const handleMount = useCallback((editor) => {
    editor.addCommand(key, () => saveFileRef.current())
}, []) // stable — no dependency on saveFile
```

**Test idea:** Change the `filePath` prop after mount and verify the save writes to the new path, not the old one.

## Related

- PR #29: https://github.com/remcovolmer/command/pull/29
- `src/hooks/useHotkeys.ts` — Centralized hotkey system with input-target guard
- `src/components/Editor/CodeEditor.tsx` — Monaco editor component
- `src/components/Editor/MarkdownEditor.tsx` — Milkdown WYSIWYG editor
- `src/components/Editor/EditorContainer.tsx` — Editor routing component
- `src/App.tsx:253-258` — `editor.save` hotkey handler dispatching CustomEvent
