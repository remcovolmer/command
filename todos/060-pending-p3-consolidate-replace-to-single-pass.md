---
status: pending
priority: p3
issue_id: "060"
tags: [code-review, performance, readability, automations]
dependencies: []
---

# Consolidate 6 chained .replace() into single-pass template replacement

## Problem Statement

The template replacement uses 6 chained `.replace()` calls plus 1 cleanup regex (7 passes over the prompt string). While performance impact is negligible, a single-pass approach with a lookup map would be more readable and extensible.

## Findings

**Source:** Performance Oracle (low priority), Architecture Strategist (Priority 3)
**Location:** `electron/main/services/AutomationService.ts` lines 378-389

## Proposed Solutions

### Option A: Single regex with lookup map (Recommended)

```typescript
const vars: Record<string, string> = prContext ? {
  number: String(prContext.number),
  title: sanitize(prContext.title),
  branch: sanitize(prContext.branch),
  url: prContext.url,
  mergeable: prContext.mergeable,
  state: prContext.state,
} : {}
resolvedPrompt = resolvedPrompt.replace(
  /\{\{pr\.(\w+)\}\}/g,
  (_, key) => vars[key] ?? ''
)
```

One pass handles both replacement and cleanup.

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] Template replacement done in single pass
- [ ] Same behavior: known vars replaced, unknown vars stripped
- [ ] Build passes

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-26 | Created | From PR #52 code review |
