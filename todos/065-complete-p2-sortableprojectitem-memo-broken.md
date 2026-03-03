---
status: complete
priority: p2
issue_id: "065"
tags: [code-review, performance, profiles, react]
dependencies: []
---

# Fix SortableProjectItem memo broken by broad store subscriptions

## Problem Statement

`SortableProjectItem` is wrapped in `memo` for drag-and-drop performance, but the new `useProjectStore` selectors subscribe to `projectLocalConfigs` (entire map) and `profiles` (entire array). When ANY project's local config changes or ANY profile is modified, ALL `SortableProjectItem` instances re-render because the record/array reference changes. This bypasses `memo`.

With 20 projects, changing one profile name triggers 20 re-renders, each including `useSortable` recalculation and Framer Motion layout work.

## Findings

**Source:** TypeScript Reviewer (Significant #7), Performance Oracle (#7), Pattern Specialist (#16)

**Location:** `src/components/Sidebar/SortableProjectItem.tsx` lines 62-63

```typescript
const projectLocalConfigs = useProjectStore((s) => s.projectLocalConfigs)
const profilesList = useProjectStore((s) => s.profiles)
```

## Proposed Solutions

### Option A: Use targeted selectors (Recommended)

```typescript
const hasLocalConfig = useProjectStore((s) => s.projectLocalConfigs[project.id] ?? false)
const selectedProfile = useProjectStore((s) => {
  const profileId = project.settings?.profileId
  return profileId ? s.profiles.find(p => p.id === profileId) ?? null : null
})
```

**Effort:** Small | **Risk:** Low

### Option B: Pass as props from parent Sidebar

Compute `hasLocalConfig` and `hasMismatch` in Sidebar and pass as props. Maintains the prop-driven pattern the component originally used.

**Effort:** Small | **Risk:** Low

## Recommended Action

Option A — targeted selectors. Keeps the logic co-located with the component.

## Technical Details

- **Affected file:** `src/components/Sidebar/SortableProjectItem.tsx`

## Acceptance Criteria

- [ ] Each `SortableProjectItem` only re-renders when its own project's data changes
- [ ] Profile/config indicators still display correctly

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
