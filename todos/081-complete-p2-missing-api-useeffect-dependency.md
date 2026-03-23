---
status: pending
priority: p2
issue_id: "081"
tags: [code-review, quality, typescript]
dependencies: []
---

# Missing `api` in useEffect dependency array

## Problem Statement

In `src/App.tsx` (line 409), the theme resolution `useEffect` captures `api` in its closure (used on line 397 for `api.app.syncClaudeTheme(resolved)`) but does not include it in the dependency array `[theme, setResolvedTheme]`. This is a lint violation (`react-hooks/exhaustive-deps`). While `api` is stable from `useMemo(() => getElectronAPI(), [])`, the implicit dependency could break silently if that memoization ever changed.

## Findings

- **Source:** TypeScript Reviewer, Architecture Strategist (both flagged independently)
- **Location:** `src/App.tsx:409`
- **Severity:** Medium — lint violation, not a runtime bug today but fragile

## Proposed Solutions

### Option A: Add `api` to dependency array
- **Pros:** Fixes lint violation, explicit dependency
- **Cons:** None — `api` is stable, no behavioral change
- **Effort:** Small
- **Risk:** None

### Option B: eslint-disable comment
- **Pros:** Documents the intentional omission
- **Cons:** Hides a real dependency
- **Effort:** Small
- **Risk:** Low

## Recommended Action

Option A — add `api` to the dependency array.

## Technical Details

- **Affected files:** `src/App.tsx`
- **Components:** Theme resolution useEffect

## Acceptance Criteria

- [ ] `api` is in the useEffect dependency array or explicitly documented why not
- [ ] No eslint warnings on the effect

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-22 | Created from PR #89 code review | |

## Resources

- PR #89: feat: add system theme option, fix light mode highlights, sync Claude Code theme
