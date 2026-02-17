---
title: "feat: Collapsible inactive projects section"
type: feat
status: completed
date: 2026-02-16
---

# feat: Collapsible inactive projects section

## Overview

Make the "Inactive" section in the sidebar collapsible so users can hide projects they're not working on. Additionally, hide worktrees for inactive projects unless the project is currently selected, reducing sidebar clutter.

## Problem Statement / Motivation

When many projects are added but only a few are active (have terminal sessions), the Inactive section takes up significant sidebar space. Users need a way to collapse this section. Similarly, worktrees for inactive projects add visual noise when the user isn't interacting with that project.

## Proposed Solution

1. **Collapsible Inactive section** - The "Inactive" heading becomes a clickable toggle with a chevron icon and project count badge. Collapsed state persists across sessions.
2. **Auto-collapse worktrees for inactive projects** - Worktrees only render when the project is the currently selected project (`activeProjectId`). This is data-driven: any project without terminals hides its worktrees unless selected.

## Technical Considerations

### State management
- Add `inactiveSectionCollapsed: boolean` to the Zustand store (`projectStore.ts`)
- Add `toggleInactiveSectionCollapsed` action
- Add to `partialize` for persistence (alongside existing `sidecarTerminalCollapsed` pattern)

### Keyboard navigation interaction
- `getProjectVisualOrder()` in `App.tsx` must respect the collapsed state: when collapsed, skip inactive projects from the `Ctrl+Up`/`Ctrl+Down` cycle
- Users must expand the section first to navigate to inactive projects via keyboard

### Selected project handling
- When collapsing hides the currently selected inactive project: auto-switch `activeProjectId` to the first visible project (nearest active project, or first workspace)
- This prevents the "selected but invisible" state

### Drag-and-drop
- When collapsed, the `DndContext` and `SortableContext` for inactive projects simply don't render. No special handling needed.

### isActive propagation (from learnings)
- Per `docs/solutions/logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md`: ensure collapsed children don't receive `isActive={true}` if they register global event listeners

### Accessibility
- Replace the `<h3>` with a `<button>` element (or button role)
- Add `aria-expanded` attribute reflecting collapsed state
- Chevron icon gets `aria-hidden="true"`

## Acceptance Criteria

### Collapsible Inactive Section
- [x] "Inactive" heading has a clickable chevron toggle
- [x] Shows project count when collapsed: "Inactive (N)"
- [x] Clicking toggles visibility of all inactive projects
- [x] Collapsed state persists across app restarts (localStorage via Zustand)
- [x] Accessible: `aria-expanded`, keyboard operable with Enter/Space

### Worktree Hiding for Inactive Projects
- [x] Worktrees hidden for inactive projects (projects without terminals)
- [x] Worktrees shown when the inactive project is the selected project (`activeProjectId`)
- [x] Worktrees re-collapse when navigating away from the inactive project

### Keyboard Navigation
- [x] `Ctrl+Up`/`Ctrl+Down` skip collapsed inactive projects
- [x] New hotkey `Ctrl+Shift+I` toggles inactive section collapse
- [x] Hotkey added to `DEFAULT_HOTKEY_CONFIG` in `src/utils/hotkeys.ts`
- [x] Hotkey registered in `App.tsx`

### Selection Edge Case
- [x] Collapsing the section while an inactive project is selected auto-switches to the first visible project

### Testing
- [x] Unit test: collapse state toggle and persistence
- [ ] Unit test: worktree visibility logic based on terminal presence and selection

## Success Metrics

- Sidebar takes less vertical space when inactive section is collapsed
- No regressions in keyboard navigation, drag-and-drop, or project selection

## Dependencies & Risks

- **Low risk**: Changes are isolated to sidebar rendering logic and Zustand store
- **Dependency**: Existing `motion/react` `AnimatePresence` patterns can be reused for smooth collapse animation
- **Risk**: Layout jumps during collapse/expand - mitigate with animation

## MVP Implementation

### Files to modify

#### `src/stores/projectStore.ts`

Add state and action:

```typescript
// State (alongside sidecarTerminalCollapsed)
inactiveSectionCollapsed: boolean

// Action
toggleInactiveSectionCollapsed: () => void
```

Add to `partialize`:

```typescript
inactiveSectionCollapsed: state.inactiveSectionCollapsed,
```

#### `src/types/hotkeys.ts`

Add to `HotkeyAction` union type:

```typescript
| 'sidebar.toggleInactive'
```

#### `src/utils/hotkeys.ts`

Add to `DEFAULT_HOTKEY_CONFIG`:

```typescript
'sidebar.toggleInactive': 'ctrl+shift+i',
```

#### `src/App.tsx`

- Register hotkey handler for `sidebar.toggleInactive` → calls `toggleInactiveSectionCollapsed()`
- Update `getProjectVisualOrder()` to filter out inactive projects when `inactiveSectionCollapsed` is true

#### `src/components/Sidebar/SortableProjectList.tsx`

- Read `inactiveSectionCollapsed` and `toggleInactiveSectionCollapsed` from store
- Replace `<h3>Inactive</h3>` with clickable button:

```tsx
<button
  onClick={toggleInactiveSectionCollapsed}
  aria-expanded={!inactiveSectionCollapsed}
  className="flex items-center gap-1 px-3 py-1.5 w-full text-left ..."
>
  <ChevronRight className={cn("h-3 w-3 transition-transform", !inactiveSectionCollapsed && "rotate-90")} />
  <span>Inactive</span>
  {inactiveSectionCollapsed && (
    <span className="text-muted-foreground/40">({inactiveProjects.length})</span>
  )}
</button>
```

- Conditionally render the project list based on `inactiveSectionCollapsed`

#### `src/components/Sidebar/SortableProjectItem.tsx`

- Accept `isInactive` prop (or derive from terminals)
- Conditionally render worktrees:

```tsx
const showWorktrees = !isInactive || project.id === activeProjectId
```

- Only render worktrees block when `showWorktrees` is true

## References

- Existing collapse pattern: `sidecarTerminalCollapsed` in `projectStore.ts:80`
- Active/Inactive split logic: `SortableProjectList.tsx:74-89`
- Worktree rendering: `SortableProjectItem.tsx:238-250`
- Keyboard nav: `App.tsx` `getProjectVisualOrder()`
- Learning: `docs/solutions/logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md`
- Learning: `docs/solutions/ui-bugs/workspace-empty-state-visibility.md`
