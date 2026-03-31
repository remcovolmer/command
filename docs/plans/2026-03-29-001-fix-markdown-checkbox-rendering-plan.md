---
title: "fix: Render markdown checkboxes in Milkdown editor"
type: fix
status: active
date: 2026-03-29
---

# fix: Render markdown checkboxes in Milkdown editor

## Overview

Markdown task list checkboxes (`- [ ]` / `- [x]`) are not visible in the Milkdown WYSIWYG editor. The fix adds visual and interactive checkbox rendering.

## Problem Frame

When a markdown file with task lists is opened in the editor's preview mode, the checkbox markers are completely invisible. Both checked and unchecked items render as plain list items without any visual checkbox indicator. Users cannot see or interact with task completion state.

## Root Cause

Milkdown's `@milkdown/preset-gfm` renders task list items as `<li data-item-type="task" data-checked="true/false">` with text content only — it does NOT create `<input type="checkbox">` elements or any visual checkbox representation. The existing CSS in `src/index.css` has:
- `::before { content: '' }` — empty, shows nothing
- `input[type="checkbox"]` rules — target elements that don't exist

## Requirements Trace

- R1. Unchecked task items (`- [ ]`) must show a visible empty checkbox
- R2. Checked task items (`- [x]`) must show a visible checked checkbox with strikethrough text
- R3. Clicking a checkbox must toggle its checked state in the editor
- R4. Toggling a checkbox must mark the editor as dirty (unsaved changes)

## Scope Boundaries

- Only the Milkdown WYSIWYG preview mode is affected (Monaco raw mode already shows the raw `[ ]`/`[x]` syntax correctly)
- No changes to the TasksPanel sidebar or TaskService

## Context & Research

### Relevant Code and Patterns

- `src/components/Editor/MarkdownEditor.tsx` — Milkdown editor setup with GFM plugin
- `src/index.css:332-351` — Existing (broken) CSS rules for task list items
- `node_modules/@milkdown/preset-gfm/lib/index.js:858-871` — `toDOM` outputs `<li data-item-type="task" data-checked>` with NO checkbox element
- `node_modules/@milkdown/components/lib/list-item-block/` — Milkdown's official component for rendering list items with checkboxes (uses `atomico` web components, framework-agnostic)

### Institutional Learnings

- `docs/solutions/logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md`: When passing callbacks to Milkdown that run once on mount, use a ref pattern to avoid stale closures
- Milkdown plugins registered via `.use()` in `useEditor` — follow existing pattern in `MilkdownEditorInner`

## Key Technical Decisions

- **CSS-only approach via `::before` pseudo-elements**: Rather than adding `@milkdown/components` as a new dependency (which uses `atomico` web components and adds complexity), use CSS pseudo-elements with unicode checkbox characters for the visual rendering. This matches the simplicity-first principle and keeps the dependency footprint small.
- **ProseMirror plugin for click interaction**: Add a small ProseMirror plugin to handle clicking near the checkbox area to toggle the `checked` attribute. This keeps interactivity without a heavy component dependency.

## Open Questions

### Resolved During Planning

- **Should we use `@milkdown/components/list-item-block`?** No — it introduces `atomico` (web component framework) as a runtime dependency for a feature that can be solved with CSS + a small ProseMirror plugin. The component package is already in `node_modules` as a transitive dependency but is not in `package.json`.

### Deferred to Implementation

- Exact unicode characters for checkbox rendering (☐/☑ vs ▢/✓) — will test visually

## Implementation Units

- [ ] **Unit 1: Fix CSS to render visual checkboxes**

**Goal:** Make task list checkboxes visually appear in the Milkdown editor

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `src/index.css`

**Approach:**
- Replace the empty `::before { content: '' }` with two rules based on `data-checked` attribute:
  - `li[data-item-type="task"][data-checked="false"]::before` → show empty checkbox character
  - `li[data-item-type="task"][data-checked="true"]::before` → show checked checkbox character
- Style the pseudo-element (font-size, vertical alignment, cursor pointer)
- Remove the orphaned `input[type="checkbox"]` CSS rules (no such element exists)
- Keep the existing `li[data-checked="true"]` strikethrough + opacity rules

**Patterns to follow:**
- Existing CSS structure in `src/index.css` for `.milkdown-wrapper .ProseMirror` selectors

**Test scenarios:**
- Happy path: Open a markdown file with `- [ ] unchecked` — empty checkbox symbol visible
- Happy path: Open a markdown file with `- [x] checked` — filled checkbox visible, text has strikethrough + opacity
- Edge case: Mixed list with regular items and task items — only task items get checkbox styling

**Verification:**
- Task list items show visible checkbox indicators in the Milkdown preview

- [ ] **Unit 2: Add click-to-toggle interaction**

**Goal:** Allow users to click checkboxes to toggle checked/unchecked state

**Requirements:** R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `src/components/Editor/MarkdownEditor.tsx`

**Approach:**
- Create a small ProseMirror plugin (using `@milkdown/utils` `$prose` helper or raw `Plugin` from `@milkdown/prose`) that:
  - Listens for click events on `li[data-item-type="task"]` (specifically near the `::before` area or on the whole line)
  - On click, toggles the `checked` attribute of the ProseMirror node via a transaction
- Register the plugin via `.use()` in the `MilkdownEditorInner` editor setup
- The content change listener already handles dirty state via `markdownUpdated`, so toggling triggers R4 automatically

**Patterns to follow:**
- Plugin registration pattern in `MilkdownEditorInner` (`.use(commonmark).use(gfm)...`)
- Milkdown's GFM task list schema: `extendListItemSchemaForTask` sets `checked` attribute on `list_item` nodes

**Test scenarios:**
- Happy path: Click unchecked task item → becomes checked (☑), text gets strikethrough
- Happy path: Click checked task item → becomes unchecked (☐), strikethrough removed
- Happy path: Toggle marks editor as dirty (unsaved changes indicator appears)
- Edge case: Clicking a regular (non-task) list item does nothing

**Verification:**
- Checkbox toggles on click, editor dirty state updates accordingly, markdown output reflects `[x]`/`[ ]` changes

## System-Wide Impact

- **Interaction graph:** The `markdownUpdated` listener in `EditorControls` already fires on any ProseMirror content change, so toggling a checkbox will correctly trigger dirty state detection and file save flow
- **State lifecycle risks:** None — the toggle is a standard ProseMirror transaction
- **Unchanged invariants:** Monaco raw editor mode, TasksPanel sidebar, file save/reload flow all remain unchanged

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Unicode checkbox characters may render poorly on some systems | Test on Windows; fall back to SVG background-image if needed |
| Click target for `::before` pseudo-element may be small/hard to hit | Make the entire task list item label area clickable, not just the pseudo-element |
