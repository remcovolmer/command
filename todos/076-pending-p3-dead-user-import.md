---
status: pending
priority: p3
issue_id: "076"
tags: [code-review, cleanup, profiles]
dependencies: []
---

# Remove unused User icon import from Sidebar.tsx

## Problem Statement

`User` is imported from `lucide-react` in `Sidebar.tsx` but never used in any JSX. Dead import.

## Findings

**Source:** Simplicity Reviewer (#6), Pattern Specialist (#15)

**Location:** `src/components/Sidebar/Sidebar.tsx` line 2

## Proposed Solutions

Remove `User` from the import statement. One-line fix.

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] Unused `User` import removed from Sidebar.tsx

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
