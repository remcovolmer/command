---
title: Fix scroll-into-view for hotkey navigation
type: fix
status: completed
date: 2026-02-15
---

# Fix: Scroll active item into view on hotkey navigation

## Overview

When navigating between projects (Ctrl+Up/Down) or chat tabs (Ctrl+Left/Right, Alt+1-9) using hotkeys, the scroll position doesn't follow the active selection. If the newly activated item is off-screen, the user can't see what they navigated to.

This affects two scrollable containers:
1. **Sidebar project list** - vertical scroll (`overflow-y-auto`)
2. **Chat tab bar** - horizontal scroll (`overflow-x-auto`)

## Proposed Solution

Add `useEffect` hooks that watch the active state IDs and call `scrollIntoView()` on the active element when it changes. Use `data-*` attributes on DOM elements to locate them within their scroll containers.

This approach is state-driven, so it naturally covers **all** navigation methods (hotkeys, mouse clicks, sidebar terminal clicks, Ctrl+Tab for editor tabs) without special-casing each trigger.

## Technical Approach

### 1. TerminalTabBar.tsx (chat tab bar scroll)

- Add a `ref` to the `overflow-x-auto` container div (line 45)
- Add `data-tab-id={terminal.id}` to each terminal tab div (line 52)
- Add `data-tab-id={tab.id}` to each editor tab div (line 111)
- Add a `useEffect` watching `activeCenterTabId`:

```tsx
const containerRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  if (!activeCenterTabId || !containerRef.current) return
  const el = containerRef.current.querySelector(
    `[data-tab-id="${activeCenterTabId}"]`
  )
  el?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
}, [activeCenterTabId])
```

### 2. Sidebar.tsx (project list scroll)

- Add a `ref` to the scrollable project list container div (line 356)
- Add `data-project-id={workspace.id}` to workspace `<li>` elements (line 278)
- Add a `useEffect` watching `activeProjectId`:

```tsx
const projectScrollRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  if (!activeProjectId || !projectScrollRef.current) return
  const el = projectScrollRef.current.querySelector(
    `[data-project-id="${activeProjectId}"]`
  )
  el?.scrollIntoView({ block: 'nearest' })
}, [activeProjectId])
```

Note: workspace projects sit **above** the scrollable container, so the `querySelector` will return `null` for them - this is correct since workspaces are always visible.

### 3. SortableProjectItem.tsx (data attribute)

- Add `data-project-id={project.id}` to the `<motion.li>` element (line 104)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scroll behavior | `auto` (instant) | IDE-like snappy feel; `smooth` is disorienting on wrap-around jumps |
| Watch target (tabs) | `activeCenterTabId` | Covers terminal AND editor tabs, all navigation triggers |
| Watch target (sidebar) | `activeProjectId` | Single source of truth for active project |
| Effect placement | In the component owning the scroll container | Clean ownership, no global DOM queries |
| Workspace handling | No-op (always visible) | Workspaces are pinned at top, outside scroll container |
| Debouncing | None | React 18 batches rapid updates; `scrollIntoView` is idempotent |

## Acceptance Criteria

- [x] Ctrl+Up/Down scrolls the sidebar project list to reveal the newly active project
- [x] Ctrl+Left/Right scrolls the tab bar to reveal the newly active terminal tab
- [x] Alt+1-9 scrolls the tab bar to reveal the targeted terminal tab
- [x] Ctrl+Tab/Shift+Tab scrolls the tab bar to reveal the newly active editor tab
- [x] Wrap-around navigation (last→first, first→last) scrolls correctly
- [x] No scroll happens when the active item is already fully visible
- [x] Mouse click navigation also benefits from scroll-into-view (state-driven)

## Files to Modify

| File | Change |
|------|--------|
| `src/components/Terminal/TerminalTabBar.tsx` | Add `ref`, `data-tab-id`, `useEffect` for horizontal scroll |
| `src/components/Sidebar/Sidebar.tsx` | Add `ref`, `data-project-id` on workspaces, `useEffect` for vertical scroll |
| `src/components/Sidebar/SortableProjectItem.tsx` | Add `data-project-id` to `motion.li` |

## References

- Hotkey handlers: `src/App.tsx:82-124` (project/terminal navigation)
- Store actions: `src/stores/projectStore.ts:681-700` (`setActiveProject`), `828-849` (`setActiveTerminal`)
- Tab bar container: `src/components/Terminal/TerminalTabBar.tsx:45`
- Sidebar scroll container: `src/components/Sidebar/Sidebar.tsx:356`
