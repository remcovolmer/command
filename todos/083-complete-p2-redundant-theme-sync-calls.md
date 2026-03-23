---
status: pending
priority: p2
issue_id: "083"
tags: [code-review, performance]
dependencies: []
---

# syncClaudeTheme fires even when resolvedTheme hasn't changed

## Problem Statement

In `src/App.tsx`, `applyTheme` unconditionally calls `syncClaudeTheme` even when the resolved theme hasn't actually changed (e.g., switching to `system` when OS preference already matches current theme). This causes an unnecessary read-parse-write cycle on `~/.claude.json`.

## Findings

- **Source:** Performance Oracle
- **Location:** `src/App.tsx:397` (inside `applyTheme`)
- **Severity:** Low — theme changes are infrequent, but the fix is trivial

## Proposed Solutions

### Option A: Compare before syncing
- **Pros:** Eliminates unnecessary disk I/O, trivial change
- **Cons:** None
- **Effort:** Small
- **Risk:** None

```typescript
const applyTheme = (resolved: 'light' | 'dark') => {
  const prev = useProjectStore.getState().resolvedTheme
  // ... DOM class toggle ...
  setResolvedTheme(resolved)
  if (resolved !== prev) {
    api.app.syncClaudeTheme(resolved).catch((e) => console.warn('...', e))
  }
}
```

## Recommended Action

Option A.

## Technical Details

- **Affected files:** `src/App.tsx`

## Acceptance Criteria

- [ ] syncClaudeTheme only called when resolvedTheme actually changes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-22 | Created from PR #89 code review | |

## Resources

- PR #89
