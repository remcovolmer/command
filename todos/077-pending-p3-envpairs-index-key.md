---
status: pending
priority: p3
issue_id: "077"
tags: [code-review, react, profiles]
dependencies: []
---

# Use stable keys for env var pair list instead of array index

## Problem Statement

`AccountsSection.tsx` uses array index as React key for the env pairs list. When items can be added/removed, this causes React to misassociate DOM elements with state, leading to input values shifting to wrong rows after deletion.

## Findings

**Source:** TypeScript Reviewer (Minor #13)

**Location:** `src/components/Settings/AccountsSection.tsx` line 282

## Proposed Solutions

Generate a unique id (e.g., `crypto.randomUUID()` or incrementing counter) when adding each pair.

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] Each env pair has a stable unique key
- [ ] Deleting a pair from the middle does not shift other inputs

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
