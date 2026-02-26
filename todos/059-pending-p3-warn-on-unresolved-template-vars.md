---
status: pending
priority: p3
issue_id: "059"
tags: [code-review, quality, developer-experience, automations]
dependencies: []
---

# Log warning when stripping unresolved template variables with context present

## Problem Statement

The regex `\{\{pr\.\w+\}\}` silently strips any unresolved `{{pr.*}}` tokens. When `prContext` IS present, a typo like `{{pr.numbr}}` vanishes without warning. Users get no feedback that a variable was not replaced.

## Findings

**Source:** TypeScript Reviewer (Minor), Pattern Recognition, Code Simplicity Reviewer
**Location:** `electron/main/services/AutomationService.ts` line 389

## Proposed Solutions

### Option A: Add console.warn when stripping with context (Recommended)

```typescript
const stripped = resolvedPrompt.match(/\{\{pr\.\w+\}\}/g)
if (stripped && prContext) {
  console.warn(`[AutomationService] Unresolved template vars stripped: ${stripped.join(', ')}`)
}
resolvedPrompt = resolvedPrompt.replace(/\{\{pr\.\w+\}\}/g, '')
```

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] Warning logged when `{{pr.*}}` tokens remain after replacement with prContext present
- [ ] No warning when stripping without prContext (manual trigger)

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-26 | Created | From PR #52 code review |
