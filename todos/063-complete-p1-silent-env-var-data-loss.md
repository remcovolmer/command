---
status: complete
priority: p1
issue_id: "063"
tags: [code-review, data-loss, profiles, ux]
dependencies: []
---

# Prevent silent data loss when saving env vars with empty values

## Problem Statement

In `AccountsSection.tsx`, the `handleSaveEnvVars` function filters out env pairs where `pair.value` is falsy (empty string). When the user opens the env editor for an existing profile, all values are pre-filled as empty strings (because the renderer never receives actual values — correct for security). If the user changes one key name but forgets to re-enter all values, all existing vars get wiped without warning.

The UX message says "Enter all values — existing values cannot be displayed" but the code silently drops empty-value pairs. This can destroy Vertex AI configuration silently.

## Findings

**Source:** TypeScript Reviewer (Critical)

**Location:** `src/components/Settings/AccountsSection.tsx` lines 60-76

```typescript
for (const pair of envPairs) {
  const key = pair.key.trim()
  if (key && pair.value) {  // empty value = pair dropped
    vars[key] = pair.value
  }
}
```

## Proposed Solutions

### Option A: Warn on empty values before saving (Recommended)

Show a confirmation dialog listing which keys have empty values and will be removed. Let the user cancel or proceed.

**Effort:** Small | **Risk:** Low

### Option B: Only send changed pairs, keep existing server-side

Have the IPC handler merge new vars with existing ones instead of replacing entirely. Send a `delete: string[]` array for explicit removals.

**Effort:** Medium | **Risk:** Low

### Option C: Disable save button when empty values present

Validate the form and show inline error when any key has an empty value.

**Effort:** Small | **Risk:** Low (but forces re-entry of all values every time)

## Recommended Action

Option A — warning dialog before saving when empty values detected.

## Technical Details

- **Affected file:** `src/components/Settings/AccountsSection.tsx`
- **Affected lines:** 60-76 (handleSaveEnvVars)

## Acceptance Criteria

- [ ] User sees warning when saving env vars if any key has an empty value
- [ ] Warning lists affected keys
- [ ] User can cancel the save to re-enter values
- [ ] Intentional deletion of all vars still works

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
