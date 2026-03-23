---
status: pending
priority: p3
issue_id: "085"
tags: [code-review, architecture]
dependencies: []
---

# setResolvedTheme is publicly exposed on store

## Problem Statement

`setResolvedTheme` is a public action on the Zustand store. Since `resolvedTheme` should only be derived from `theme` + OS preference, exposing a public setter allows any consumer to break the contract (e.g., calling `setResolvedTheme('light')` while theme is `system` and OS is dark).

## Findings

- **Source:** Architecture Strategist
- **Location:** `src/stores/projectStore.ts:788`
- **Severity:** Low — no one misuses it today, but the API surface is wider than needed

## Proposed Solutions

### Option A: Document as internal-only
- **Pros:** Quick, no code change
- **Cons:** Convention-based, not enforced
- **Effort:** Small

### Option B: Move resolution logic to store subscription
- **Pros:** Eliminates the public setter entirely, self-contained theme logic
- **Cons:** More refactoring, moves logic from App.tsx to store
- **Effort:** Medium

## Recommended Action

Option A for now; Option B when extracting theme logic is prioritized.

## Technical Details

- **Affected files:** `src/stores/projectStore.ts`, `src/App.tsx`

## Acceptance Criteria

- [ ] setResolvedTheme is either documented as internal or removed from public API

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-22 | Created from PR #89 code review | |

## Resources

- PR #89
