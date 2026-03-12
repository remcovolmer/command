---
status: pending
priority: p3
issue_id: "073"
tags: [code-review, performance, profiles, ipc]
dependencies: []
---

# Merge loadProfiles into single IPC call

## Problem Statement

`loadProfiles()` makes two sequential IPC calls: `api.profile.list()` then `api.profile.getActive()`. Both read from the same in-memory `ProjectPersistence` state. Could be one call returning `{ profiles, activeProfileId }`.

## Findings

**Source:** Performance Oracle (#5), Simplicity Reviewer (#3)

**Location:** `src/stores/projectStore.ts` lines 283-292

## Proposed Solutions

Create single `profile:loadAll` IPC handler returning `{ profiles, activeProfileId }`. Drop `profile:getActive`.

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] Single IPC call loads both profiles and activeProfileId
- [ ] `profile:getActive` handler removed (or deprecated)

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
