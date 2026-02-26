---
status: pending
priority: p2
issue_id: "055"
tags: [code-review, security, validation, automations]
dependencies: []
---

# Fix inconsistent projectIds UUID validation in automation:update

## Problem Statement

The `automation:create` handler validates projectIds with `isValidUUID()`, but `automation:update` only checks `typeof id === 'string'` without UUID validation. This is an inconsistency — both should apply the same validation.

## Findings

**Source:** Security Sentinel (Finding 6)
**Location:** `electron/main/index.ts` line 1097 vs line 1077

## Proposed Solutions

### Option A: Add UUID validation to update handler (Recommended)

```typescript
if (Array.isArray(updates.projectIds)) allowedUpdates.projectIds = updates.projectIds.filter((id: unknown) => typeof id === 'string' && isValidUUID(id as string))
```

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `automation:update` handler validates projectIds with `isValidUUID()`
- [ ] Matches `automation:create` validation pattern

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-26 | Created | From PR #52 code review |
