---
status: pending
priority: p3
issue_id: "079"
tags: [code-review, typescript, profiles, type-safety]
dependencies: []
---

# Type settingsInitialTab as SettingsTab instead of string

## Problem Statement

`settingsInitialTab` in the store is typed as `string | null` and gets `as SettingsTab` cast in `SettingsDialog.tsx`. Invalid strings would break the tab system silently.

## Findings

**Source:** TypeScript Reviewer (Significant #6)

**Location:**
- `src/stores/projectStore.ts` line 68
- `src/components/Settings/SettingsDialog.tsx` line 22

## Proposed Solutions

Type the store field as `SettingsTab | null`. Export `SettingsTab` from types or the dialog module.

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] `settingsInitialTab` typed as `SettingsTab | null`
- [ ] No `as` cast in SettingsDialog

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
