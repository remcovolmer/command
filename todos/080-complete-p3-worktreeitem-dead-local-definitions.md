---
status: complete
priority: p3
issue_id: "080"
tags: [code-review, quality, dead-code]
dependencies: []
---

# Dead local definitions shadow imports in WorktreeItem.tsx

## Problem Statement

`src/components/Worktree/WorktreeItem.tsx` lines 231-244 define local `stateDots`, `isInputState`, and `isVisibleState` that shadow the canonical imports from `../../utils/terminalState` (line 6). The local `stateDots` has a stale `busy: 'bg-blue-500'` color (should be gray), and the local `isInputState`/`isVisibleState` duplicate the imported functions exactly.

## Findings

- **`stateDots` (line 231):** Dead code. Defined but never referenced — `STATE_DOT_COLORS` (the import) is used on line 283 instead. Contains stale `bg-blue-500` for busy state.
- **`isInputState` (line 240):** Shadows the imported function from line 6. Functionally identical but means the import is unused.
- **`isVisibleState` (line 244):** Same — shadows import, identical logic.

Flagged independently by 3 review agents (Performance Oracle, Pattern Recognition, TypeScript Reviewer).

## Proposed Solutions

### Option 1: Delete lines 231-244 (Recommended)
Remove all local definitions. The imports on line 6 already provide `STATE_DOT_COLORS`, `isInputState`, and `isVisibleState` with correct implementations.

- **Effort:** Small (delete 14 lines)
- **Risk:** None — the imports are already in use or identical
- **Pros:** Removes dead code, eliminates stale color bug risk, single source of truth

## Acceptance Criteria

- [ ] Lines 231-244 of WorktreeItem.tsx are removed
- [ ] All references use the imported `STATE_DOT_COLORS`, `isInputState`, `isVisibleState`
- [ ] No unused imports remain on line 6

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-12 | Created from PR #77 code review | Pre-existing issue, not introduced by this PR |

## Resources

- PR #77: fix/merge-button-working-indicator
- `src/components/Worktree/WorktreeItem.tsx` lines 231-244
- `src/utils/terminalState.ts` (canonical source)
