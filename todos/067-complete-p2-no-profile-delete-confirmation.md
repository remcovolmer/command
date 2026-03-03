---
status: complete
priority: p2
issue_id: "067"
tags: [code-review, ux, profiles, safety]
dependencies: []
---

# Add confirmation dialog for profile deletion

## Problem Statement

Deleting a profile immediately destroys encrypted env vars and resets all projects using that profile to `subscription` mode. This cascading destructive action has no confirmation dialog and no undo. Compare to the `dangerouslySkipPermissions` toggle which requires confirmation.

## Findings

**Source:** TypeScript Reviewer (Significant #4), Architecture Strategist (#5), Security Sentinel, Pattern Specialist (#13)

**Location:** `src/components/Settings/AccountsSection.tsx` lines 188-197

## Proposed Solutions

### Option A: Window.confirm dialog (Recommended)

Simple and fast. Show profile name and impact (number of projects affected).

**Effort:** Small | **Risk:** Low

### Option B: Inline confirmation state

Two-step: click delete → button changes to "Confirm Delete?" with red styling.

**Effort:** Small | **Risk:** Low

## Recommended Action

Option A — simple confirm with impact summary.

## Technical Details

- **Affected file:** `src/components/Settings/AccountsSection.tsx`

## Acceptance Criteria

- [ ] Confirmation dialog before profile deletion
- [ ] Dialog shows profile name and number of affected projects
- [ ] Canceling does not delete

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
