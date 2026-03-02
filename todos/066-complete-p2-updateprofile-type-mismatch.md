---
status: complete
priority: p2
issue_id: "066"
tags: [code-review, typescript, profiles, type-safety]
dependencies: []
---

# Fix updateProfile type mismatch across process boundary

## Problem Statement

The `profile:update` IPC type says `{ name: string }` (name required, no envVarCount) in the renderer/preload. But `ProjectPersistence.updateProfile()` accepts `{ name?: string; envVarCount?: number }`. The main process calls `updateProfile` internally with only `{ envVarCount: count }` (no name). This works at runtime but is a type safety hole that will cause confusing errors if the types are ever enforced.

## Findings

**Source:** TypeScript Reviewer (Critical #2)

**Location:**
- `src/types/index.ts` line 388: `update: (id: string, updates: { name: string })`
- `electron/preload/index.ts`: same signature
- `electron/main/services/ProjectPersistence.ts` line 394: `updateProfile(id, { name?, envVarCount? })`
- `electron/main/index.ts` line 565: `updateProfile(profileId, { envVarCount: count })`

## Proposed Solutions

### Option A: Split into two methods (Recommended)

- `updateProfileName(id, name)` — exposed via IPC
- `updateProfileMeta(id, { envVarCount })` — internal only, not exposed to renderer

**Effort:** Small | **Risk:** Low

### Option B: Create separate internal type

Keep one method but use `ProfileUpdatePublic = { name: string }` for IPC and `ProfileUpdateInternal = { name?: string; envVarCount?: number }` internally.

**Effort:** Small | **Risk:** Low

## Recommended Action

Option A — cleaner separation of concerns.

## Technical Details

- **Affected files:** `src/types/index.ts`, `electron/preload/index.ts`, `electron/main/services/ProjectPersistence.ts`, `electron/main/index.ts`

## Acceptance Criteria

- [ ] IPC-facing update method only accepts `{ name: string }`
- [ ] Internal envVarCount update uses a separate code path
- [ ] No `as` casts needed at the boundary

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
