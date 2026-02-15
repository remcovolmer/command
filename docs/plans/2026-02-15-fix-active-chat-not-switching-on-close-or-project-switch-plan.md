---
title: "fix: Active chat view does not switch when closing tab or switching project"
type: fix
status: completed
date: 2026-02-15
---

# fix: Active chat view does not switch when closing tab or switching project

## Overview

When closing the active chat tab or switching to a different project, the center viewport goes blank instead of switching to the next available chat. The root cause is that `activeCenterTabId` is not updated in several store actions, while `TerminalViewport` relies on it as the primary source of truth for what to display.

## Problem Statement

The store has a dual-ID system:
- `activeTerminalId` -- tracks the active terminal
- `activeCenterTabId` -- tracks what the center viewport displays (terminal OR editor tab)

`TerminalViewport.tsx:132` uses `activeCenterTabId` first:
```typescript
const effectiveTerminalId = isEditorActive ? null : (activeCenterTabId ?? activeTerminalId)
```

Three store actions update `activeTerminalId` but NOT `activeCenterTabId`:
1. **`removeTerminal`** (line 733) -- closing a chat tab
2. **`removeProject`** (line 613) -- removing a project
3. **`removeWorktree`** (line 873) -- removing a worktree

Additionally, the fallback terminal selection in these actions (and in `setActiveProject`) includes sidecar/`type === 'normal'` terminals, which the center area filters out (`TerminalArea.tsx:33`). This means the fallback could select an invisible terminal.

## Proposed Solution

### 1. Extract a shared helper for visible terminal filtering

Create a helper function used consistently across all actions:

```typescript
// Inside the store, as a utility
function getVisibleTerminals(
  terminals: Record<string, TerminalInfo>,
  sidecarTerminals: Record<string, string[]>,
  projectId: string
): TerminalInfo[] {
  const sidecarIds = new Set(Object.values(sidecarTerminals).flat())
  return Object.values(terminals).filter(
    (t) => t.projectId === projectId && t.type !== 'normal' && !sidecarIds.has(t.id)
  )
}
```

### 2. Fix `removeTerminal` -- add `activeCenterTabId` to return

```typescript
// projectStore.ts, in removeTerminal action
// After determining newActiveTerminalId, also set activeCenterTabId

// Use visible terminals for fallback (exclude sidecar/normal)
let newActiveTerminalId = state.activeTerminalId
let newActiveCenterTabId = state.activeCenterTabId

if (state.activeTerminalId === id || state.activeCenterTabId === id) {
  const visible = getVisibleTerminals(newTerminals, state.sidecarTerminals, removedTerminal?.projectId ?? '')
  const fallbackTerminalId = visible.length > 0 ? visible[0].id : null

  if (state.activeTerminalId === id) {
    newActiveTerminalId = fallbackTerminalId
  }
  if (state.activeCenterTabId === id) {
    newActiveCenterTabId = fallbackTerminalId
  }
}

return {
  terminals: newTerminals,
  activeTerminalId: newActiveTerminalId,
  activeCenterTabId: newActiveCenterTabId,
  layouts: newLayouts,
  sidecarTerminals: newSidecarTerminals,
  activeSidecarTerminalId: newActiveSidecar,
}
```

### 3. Fix `removeProject` -- add `activeCenterTabId`

In the `removeProject` action (line 613-679), where `activeTerminalId` is updated but `activeCenterTabId` is not, add `activeCenterTabId` to the return object matching the new `activeTerminalId`.

### 4. Fix `removeWorktree` -- add `activeCenterTabId`

In the `removeWorktree` action (line 873-902), same pattern: add `activeCenterTabId` to match the new `activeTerminalId`.

### 5. Fix `setActiveProject` -- filter sidecar terminals

Update the filter at line 684 to exclude `type === 'normal'` and sidecar terminals:

```typescript
setActiveProject: (id) =>
  set((state) => {
    const visible = getVisibleTerminals(state.terminals, state.sidecarTerminals, id)
    const newActiveTerminalId = visible.length > 0 ? visible[0].id : null
    // ... rest unchanged
  }),
```

## Acceptance Criteria

- [x] Closing the active chat tab switches view to the next visible chat
- [x] Closing the last chat tab in a project shows the empty state
- [x] Switching projects shows the correct chat (not a sidecar terminal)
- [x] Closing a non-active tab does not change the active view
- [x] Removing a project with active chat correctly switches to next project's chat
- [x] Removing a worktree with active chat correctly falls back
- [x] Sidecar/normal terminals are never selected as center tab fallback

## Files to Modify

| File | Change |
|------|--------|
| `src/stores/projectStore.ts` | Extract `getVisibleTerminals` helper; fix `removeTerminal`, `removeProject`, `removeWorktree`, `setActiveProject` |

## Tests

| Test Case | Expected |
|-----------|----------|
| Close active terminal (2+ remain) | `activeCenterTabId` = next visible terminal |
| Close active terminal (last one) | `activeCenterTabId` = null |
| Close non-active terminal | `activeCenterTabId` unchanged |
| Close terminal, only sidecar remains | `activeCenterTabId` = null (not sidecar) |
| Switch project with chats | `activeCenterTabId` = first visible terminal |
| Switch project with only sidecar | `activeCenterTabId` = null |

## References

- Related fix: #33 (chat tab shows worktree name immediately on creation)
- Past learning: `docs/plans/2026-02-13-fix-chat-tab-name-on-worktree-creation-plan.md` (stale closure pattern)
- Past learning: `docs/solutions/logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md` (active state propagation)
