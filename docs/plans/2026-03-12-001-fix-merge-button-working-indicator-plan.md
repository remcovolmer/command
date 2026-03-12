---
title: "fix: Show working indicator on merge button during merge operation"
type: fix
status: completed
date: 2026-03-12
---

# fix: Show working indicator on merge button during merge operation

When the user presses the merge button on a worktree, there's no visual feedback between the click and the completion of the merge + worktree deletion. The operation takes several seconds (merge PR → close terminals → remove worktree), leaving the user wondering if anything happened.

## Acceptance Criteria

- [x] Merge button immediately shows a spinner (`Loader2`) and "Merging..." text after click
- [x] Button is disabled during the entire merge operation (prevents double-clicks)
- [x] Spinner clears when operation completes (success or failure)
- [x] Existing check-pending spinner behavior is preserved (yellow/red Loader2 for CI checks)

## Implementation

### Single file change: `src/components/Worktree/WorktreeItem.tsx`

**1. Add `isMerging` state to `WorktreeItem`**

```tsx
const [isMerging, setIsMerging] = useState(false)
```

**2. Wrap `handleMerge` with loading state**

Set `isMerging = true` before the confirm dialog resolves to merge, and `setIsMerging(false)` in a `finally` block.

```tsx
// At start of merge execution (after confirm dialog)
setIsMerging(true)
try {
  await api.github.mergePR(...)
  // ... close terminals, remove worktree
} catch (err) {
  // ... error handling
} finally {
  setIsMerging(false)
}
```

**3. Pass `isMerging` to `MergeButton`**

```tsx
<MergeButton checks={checks} onMerge={handleMerge} isMerging={isMerging} />
```

**4. Update `MergeButton` to show merging state**

```tsx
function MergeButton({ checks, onMerge, isMerging }: {
  checks: PRCheckStatus[]; onMerge: () => void; isMerging: boolean
}) {
  // ...existing check logic...

  if (isMerging) {
    return (
      <button disabled className="...disabled styles...">
        <Loader2 className="w-3 h-3 animate-spin" />
        Merging...
      </button>
    )
  }

  // ...existing render logic...
}
```

## Context

**Established pattern:** `GitStatusPanel.tsx` (lines 155-224) uses the identical `useState` + `setLoading` + `Loader2` + `disabled` pattern for git fetch/pull/push operations.

**Files touched:** Only `src/components/Worktree/WorktreeItem.tsx`
