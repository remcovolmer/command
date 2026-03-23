---
status: pending
priority: p3
issue_id: "087"
tags: [code-review, architecture]
dependencies: ["085"]
---

# Extract theme resolution logic from App.tsx to dedicated hook

## Problem Statement

The `useEffect` in `App.tsx` (lines 389-409) handles three distinct concerns: DOM class mutation, store state update, and IPC sync. This couples theme resolution to the App component. If a second window or entry point is added, the logic would need duplication.

## Findings

- **Source:** Architecture Strategist
- **Location:** `src/App.tsx:389-409`
- **Severity:** Low — works correctly today, but is architectural debt

## Proposed Solutions

### Option A: Extract to `useThemeResolver` hook
- **Pros:** Single-responsibility, reusable, testable
- **Cons:** New file, minor refactor
- **Effort:** Small-Medium

### Option B: Handle via Zustand subscription/middleware
- **Pros:** Store is self-contained for theme, works without React
- **Cons:** More complex, DOM manipulation in store is unconventional
- **Effort:** Medium

## Recommended Action

Option A when more theme-related work is planned.

## Technical Details

- **Affected files:** `src/App.tsx`, new `src/hooks/useThemeResolver.ts`

## Acceptance Criteria

- [ ] Theme resolution logic in a dedicated hook or store subscription
- [ ] App.tsx useEffect is simplified

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-22 | Created from PR #89 code review | |

## Resources

- PR #89
