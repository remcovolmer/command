---
status: complete
priority: p2
issue_id: "072"
tags: [code-review, architecture, profiles, duplication]
dependencies: []
---

# Extract duplicate env override resolution to shared helper

## Problem Statement

The same env override resolution logic (check authMode === 'profile', check profileId, call secureEnvStore.getEnvVars) is duplicated in both `terminal:create` IPC handler and `restoreSessions`. If the logic changes (e.g., adding validation, logging), both locations must be updated.

## Findings

**Source:** Architecture Strategist (Medium #1)

**Location:** `electron/main/index.ts` — `terminal:create` handler and `restoreSessions` function

## Proposed Solutions

Extract to a helper function:

```typescript
function resolveEnvOverrides(project: Project | undefined): Record<string, string> | undefined {
  if (project?.settings?.authMode === 'profile' && project.settings.profileId && secureEnvStore) {
    return secureEnvStore.getEnvVars(project.settings.profileId)
  }
  return undefined
}
```

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] Single helper function for env override resolution
- [ ] Both terminal:create and restoreSessions use the helper

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
