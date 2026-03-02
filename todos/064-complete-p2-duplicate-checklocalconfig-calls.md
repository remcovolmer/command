---
status: complete
priority: p2
issue_id: "064"
tags: [code-review, performance, profiles, ipc]
dependencies: []
---

# Remove duplicate checkLocalConfig calls and batch IPC

## Problem Statement

Both `Sidebar.tsx` and `GeneralSection.tsx` run identical `useEffect` hooks that call `checkLocalConfig(project.id)` for every project on mount. Since Sidebar is always mounted, the GeneralSection call is redundant. Worse, the `projects` dependency triggers the effect on every project mutation (reorder, settings change, name change), firing N IPC calls each time. Each call does `fs.access()` on the main thread and triggers individual `set()` calls, causing N re-renders.

With 10 projects, every settings change fires 10 IPC round trips + 10 state updates.

## Findings

**Source:** TypeScript Reviewer (Critical #1), Performance Oracle (Critical #3/#4), Simplicity Reviewer (#2), Pattern Specialist (related)

**Location:**
- `src/components/Sidebar/Sidebar.tsx` lines 104-109
- `src/components/Settings/GeneralSection.tsx` lines 16-21

## Proposed Solutions

### Option A: Remove GeneralSection effect + batch Sidebar check (Recommended)

1. Remove the `useEffect` from `GeneralSection.tsx` entirely
2. In `Sidebar.tsx`, change dependency from `projects` to `projects.length` (only re-check when projects added/removed)
3. Better yet: compute `hasLocalConfig` during `project:list` in the main process

**Effort:** Small | **Risk:** Low

### Option B: Move to project:list handler

Compute `hasLocalConfig` in the `project:list` IPC handler and add it to the Project type. Eliminates the separate IPC channel, store property, and both useEffect loops.

**Effort:** Medium | **Risk:** Low

## Recommended Action

Option A for quick fix, Option B as the cleaner long-term solution.

## Technical Details

- **Affected files:** `Sidebar.tsx`, `GeneralSection.tsx`, `projectStore.ts`, `index.ts`

## Acceptance Criteria

- [ ] `GeneralSection.tsx` no longer calls `checkLocalConfig` in useEffect
- [ ] `Sidebar.tsx` effect only fires when projects are added/removed
- [ ] Local config indicators still show correctly

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
