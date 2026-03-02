---
status: pending
priority: p3
issue_id: "078"
tags: [code-review, validation, profiles]
dependencies: []
---

# Verify profile existence in setActive and project:update

## Problem Statement

Neither `profile:setActive` nor `project:update` verifies that the referenced profile ID actually exists. A non-existent profileId causes `getEnvVars()` to return an empty object at terminal creation, silently falling back to no env injection without warning.

## Findings

**Source:** Architecture Strategist (#3), Security Sentinel (Low #5)

**Location:** `electron/main/index.ts` lines 545-547 and 461-468

## Proposed Solutions

Add existence check: `if (!projectPersistence?.getProfiles().find(p => p.id === id)) throw new Error('Profile not found')`.

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] `profile:setActive` rejects non-existent profile IDs
- [ ] `project:update` with `profileId` rejects non-existent profiles
- [ ] Clear error message returned

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
