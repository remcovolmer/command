---
status: complete
priority: p2
issue_id: "068"
tags: [code-review, migration, profiles, latent-bug]
dependencies: []
---

# Fix v4->v5 migration to use literal version 5 instead of STATE_VERSION

## Problem Statement

The v4->v5 migration in `ProjectPersistence` returns `version: STATE_VERSION` instead of the literal `5`. If a future v6 migration is added and `STATE_VERSION` is bumped to 6, this code would create a v6 object and skip the v5->v6 migration step. All other migrations (v1->v2, v2->v3, v3->v4) correctly use literal version numbers.

## Findings

**Source:** Pattern Recognition Specialist (#8)

**Location:** `electron/main/services/ProjectPersistence.ts` line 191

## Proposed Solutions

One-line fix: Change `version: STATE_VERSION` to `version: 5`.

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] v4->v5 migration returns `version: 5` (literal)
- [ ] Pattern matches v1->v2, v2->v3, v3->v4 migrations

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
