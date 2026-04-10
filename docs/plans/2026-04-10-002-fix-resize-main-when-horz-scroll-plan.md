---
title: "fix: Resize terminal when tab bar scrollbar appears"
type: fix
status: active
date: 2026-04-10
---

# fix: Resize terminal when tab bar scrollbar appears

## Overview

When enough tabs exist in the center area's tab bar that horizontal overflow triggers a scrollbar, the terminal below doesn't resize to account for the reduced vertical space. Part of the terminal gets clipped at the bottom.

## Problem Frame

The `TerminalTabBar` uses `overflow-x-auto` (in `src/components/Terminal/TerminalTabBar.tsx:57`). On Windows with classic (non-overlay) scrollbars, this causes the scrollbar to consume ~17px of vertical space inside the element. Per CSS spec, setting `overflow-x: auto` implicitly promotes `overflow-y` to `auto` as well, which means the element's outer height may not change — the scrollbar sits inside the existing bounds, effectively stealing vertical space from the tab content area or extending it unpredictably depending on the flex context.

The result: the `flex-1 min-h-0` sibling containing the terminal viewport either doesn't shrink, or the ResizeObserver on the xterm container doesn't fire reliably because the height change is small and happens inside the overflow box.

## Requirements Trace

- R1. Terminal must remain fully visible when the tab bar's horizontal scrollbar appears or disappears
- R2. No regression in tab bar scroll/drag behavior

## Scope Boundaries

- Not adding scroll arrow buttons or tab overflow dropdown (future enhancement)
- Not changing tab sizing or maximum tab count

## Context & Research

### Relevant Code and Patterns

- `src/components/Terminal/TerminalTabBar.tsx:57` — `overflow-x-auto` on tab bar container
- `src/components/Layout/TerminalArea.tsx:219-247` — flex column layout: TerminalTabBar + flex-1 TerminalViewport
- `src/hooks/useXtermInstance.ts:287-295` — ResizeObserver on terminal container triggers `safeFit()`
- `src/index.css:114-142` — existing custom scrollbar classes (`sidebar-scroll`, `main-scroll`) with 5px width/height

### Institutional Learnings

- The codebase already has a pattern for thin custom scrollbars via CSS classes in `src/index.css`

## Key Technical Decisions

- **Hide the scrollbar on the tab bar instead of adding resize observer complexity**: The tab bar still scrolls via mousewheel/trackpad/shift+scroll, but the scrollbar takes zero vertical space. This eliminates the root cause (scrollbar stealing terminal space) rather than reacting to it. This matches the pattern used by VS Code, Chrome tab strips, and other tab bar UIs.
- **Use a dedicated CSS class rather than inline styles**: Follows the existing `sidebar-scroll` / `main-scroll` pattern in `src/index.css`.

## Implementation Units

- [ ] **Unit 1: Add hidden-scrollbar CSS class and apply to tab bar**

**Goal:** Prevent the horizontal scrollbar from consuming vertical space in the tab bar while preserving scroll functionality.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/Terminal/TerminalTabBar.tsx`

**Approach:**
- Add a `.tab-scroll` class in `src/index.css` that hides the scrollbar visually:
  - `::-webkit-scrollbar { display: none }` (Electron/Chromium)
  - `scrollbar-width: none` (standard CSS, future-proofing)
- Apply the `tab-scroll` class to the tab bar container div alongside `overflow-x-auto`
- The div retains `overflow-x-auto` so mouse wheel scrolling still works

**Patterns to follow:**
- Existing `sidebar-scroll` / `main-scroll` pattern in `src/index.css`

**Test scenarios:**
- Happy path: With 8+ tabs, the tab bar scrolls horizontally via mousewheel without showing a scrollbar, and the terminal fills all available vertical space
- Happy path: With few tabs (no overflow), layout is unchanged
- Edge case: Adding/removing tabs crossing the overflow threshold doesn't cause terminal resize flicker
- Integration: Tab drag-and-drop still works when scrollbar is hidden

**Verification:**
- Open a project with enough tabs to trigger horizontal overflow
- Terminal content is fully visible (no clipping at bottom)
- Tabs can be scrolled via mousewheel
- Tab drag-and-drop functions correctly

## System-Wide Impact

- **Interaction graph:** Only the tab bar's visual scrollbar behavior changes. Terminal resize, tab events, and drag-and-drop are unaffected.
- **Unchanged invariants:** `overflow-x-auto` behavior preserved — only the scrollbar visibility changes, not the overflow mechanics.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Hidden scrollbar reduces discoverability of additional tabs | Tabs are already small and numerous — users discover overflow by seeing tabs cut off at the edge. A future enhancement could add scroll indicators or a tab overflow menu. |

## Sources & References

- Related code: `src/components/Terminal/TerminalTabBar.tsx`, `src/index.css`
