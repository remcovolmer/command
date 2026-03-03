---
status: complete
priority: p2
issue_id: "070"
tags: [code-review, architecture, profiles, data-integrity]
dependencies: []
---

# Derive envVarCount instead of syncing it

## Problem Statement

`envVarCount` is stored on `AccountProfile` in `projects.json` and manually synced after every `setEnvVars`/`clearEnvVars` call via `updateProfile(id, { envVarCount })`. If the sync call is ever missed or `secure-env.json` is manually edited, the count drifts from reality. This is an entire class of bugs that can be eliminated by computing the count on demand.

## Findings

**Source:** TypeScript Reviewer (Moderate #11), Simplicity Reviewer (#1)

**Location:**
- `electron/main/services/SecureEnvStore.ts` lines 106-111 (`getEnvVarCount`)
- `electron/main/index.ts` lines 562-565 (sync calls)
- `electron/main/services/ProjectPersistence.ts` (persisted field)

## Proposed Solutions

### Option A: Compute at list time (Recommended)

In the `profile:list` IPC handler, compute `envVarCount` from `secureEnvStore.getEnvVarKeys(id).length` before returning. Remove from persisted type.

**Effort:** Small | **Risk:** Low

Removes: `getEnvVarCount` method, two `updateProfile({ envVarCount })` calls, stale data bug class.

## Acceptance Criteria

- [ ] `envVarCount` computed from SecureEnvStore at read time
- [ ] Not stored in `projects.json` profile data
- [ ] `profile:setEnvVars` and `profile:clearEnvVars` no longer call `updateProfile` for count

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
