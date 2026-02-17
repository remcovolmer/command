---
title: "Collapsible Inactive Projects: Inconsistent Toggle Behavior Between Click and Hotkey"
date: 2026-02-17
module: Sidebar / State Management
severity: medium
status: resolved
tags:
  - zustand
  - keyboard-shortcuts
  - state-management
  - sidebar
  - code-review
  - dual-code-path
---

# Collapsible Inactive Projects: Hotkey Handler Missing Auto-Switch Behavior

## Problem Statement

When collapsing the "Inactive" projects section in the sidebar, clicking the button correctly auto-switched away from an inactive project if one was selected. However, pressing `Ctrl+Shift+I` (keyboard shortcut) did not -- it collapsed the section but left the inactive project selected and invisible in the sidebar ("selected but invisible" state).

### Symptoms

- Pressing `Ctrl+Shift+I` while an inactive project was selected collapsed the section but kept the project selected
- The center area still showed the hidden project's content with no sidebar selection visible
- Clicking the collapse button behaved correctly, switching to the first active project
- Dead code path: workspace fallback in `SortableProjectList.tsx` was unreachable

## Root Cause

Two independent code paths implemented the toggle functionality with inconsistent behavior:

**Button click handler** (`SortableProjectList.tsx:111-124`) contained auto-switch logic:
```typescript
const handleToggleInactive = () => {
  if (!inactiveSectionCollapsed && activeProjectId) {
    const isSelectedInactive = inactiveProjects.some((p) => p.id === activeProjectId)
    if (isSelectedInactive) {
      const firstVisible = activeProjects[0] ?? projects.find((p) => p.type === 'workspace')
      if (firstVisible) setActiveProject(firstVisible.id)
    }
  }
  toggleInactiveSectionCollapsed()
}
```

**Hotkey handler** (`App.tsx:316-318`) called the raw store toggle:
```typescript
'sidebar.toggleInactive': () => {
  useProjectStore.getState().toggleInactiveSectionCollapsed()
},
```

**Secondary issue**: The workspace fallback `projects.find((p) => p.type === 'workspace')` was dead code because the `projects` prop was pre-filtered to exclude workspaces at the caller (`Sidebar.tsx:243`).

**Root issue**: Business logic (auto-switch on collapse) was duplicated in the UI layer rather than centralized in the state management layer.

## Solution

Moved auto-switch logic into the Zustand store's `toggleInactiveSectionCollapsed` action, ensuring all callers get identical behavior.

### After (`projectStore.ts:336-361`)

```typescript
toggleInactiveSectionCollapsed: () =>
  set((state) => {
    const newCollapsed = !state.inactiveSectionCollapsed
    if (newCollapsed && state.activeProjectId) {
      const terminalValues = Object.values(state.terminals)
      const hasTerminals = terminalValues.some(
        (t) => t.projectId === state.activeProjectId
      )
      const activeProject = state.projects.find(p => p.id === state.activeProjectId)
      if (activeProject && activeProject.type !== 'workspace' && !hasTerminals) {
        const firstVisible = state.projects.find(
          (p) => p.type !== 'workspace' && terminalValues.some((t) => t.projectId === p.id)
        ) ?? state.projects.find((p) => p.type === 'workspace')
        if (firstVisible) {
          return {
            inactiveSectionCollapsed: newCollapsed,
            activeProjectId: firstVisible.id,
          }
        }
      }
    }
    return { inactiveSectionCollapsed: newCollapsed }
  }),
```

### Simplified component (`SortableProjectList.tsx`)

- Removed `handleToggleInactive` wrapper function
- Removed `setActiveProject` store selector
- Button now calls `toggleInactiveSectionCollapsed` directly (same as hotkey)

### Why store-level

- Single source of truth for all callers (click, hotkey, future IPC)
- State mutations are atomic (`inactiveSectionCollapsed` + `activeProjectId` in one return)
- Store has access to all projects including workspaces, fixing the dead fallback
- No duplicate logic between UI handlers

### Files changed

- `src/stores/projectStore.ts` -- Enhanced toggle action with auto-switch logic
- `src/components/Sidebar/SortableProjectList.tsx` -- Removed duplicated logic

### Verification

17/17 tests pass (14 unit + 3 e2e).

## Prevention Strategies

### 1. Side effects belong in store actions, not UI handlers

When a state change has side effects (auto-switching, cleanup, validation), implement them in the Zustand action. UI handlers should be thin wrappers that call the action.

```typescript
// WRONG: Logic in handler
const handleClick = () => {
  if (someCondition) doSideEffect()
  store.toggle()
}

// CORRECT: Logic in store
store.toggle = () => set((state) => {
  if (someCondition) return { ...newState, sideEffect }
  return newState
})
```

### 2. Multi-path trigger verification

When adding a new invocation path (hotkey, context menu, IPC), verify it calls the same code path:

```
[ ] Identified the existing source-of-truth implementation
[ ] New path calls the SAME store action
[ ] All invocation paths produce identical final state
```

### 3. Dead code detection for fallback expressions

When using `??` or `||` fallbacks, verify the fallback condition can occur given the data contract:

- Document upstream filtering in component props
- If the parent pre-filters data, the fallback may be unreachable
- Moving logic to the store (which has unfiltered data) can make fallbacks reachable and correct

### 4. Testing strategy

Use parameterized tests to verify all invocation paths produce identical behavior:

```typescript
const testToggleBehavior = (invokeFn: () => void) => {
  // Setup: inactive project selected
  invokeFn()
  // Assert: auto-switched to first active project
}

it('click toggles and auto-switches', () => testToggleBehavior(clickButton))
it('hotkey toggles and auto-switches', () => testToggleBehavior(pressCtrlShiftI))
```

## Related Documentation

- [isActive propagation patterns](../logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md) -- Same module, similar dual-path inconsistency
- [Workspace empty state visibility](../ui-bugs/workspace-empty-state-visibility.md) -- Sidebar consistency patterns
- [Feature plan](../../plans/2026-02-16-feat-collapsible-inactive-projects-section-plan.md) -- Original specification
- Existing pattern reference: `sidecarTerminalCollapsed` in `projectStore.ts`
