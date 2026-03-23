---
status: pending
priority: p2
issue_id: "082"
tags: [code-review, quality, error-handling]
dependencies: []
---

# Silent `.catch(() => {})` on theme sync swallows errors

## Problem Statement

In `src/App.tsx` (line 397), `api.app.syncClaudeTheme(resolved).catch(() => {})` silently swallows all errors from the IPC call. If the write to `~/.claude.json` fails persistently (permissions, disk full, corrupted JSON), there is no feedback to the user or diagnostics. The main process logs a warning, but the renderer side is completely silent.

## Findings

- **Source:** TypeScript Reviewer, Security Sentinel, Architecture Strategist
- **Location:** `src/App.tsx:397`
- **Severity:** Low — convenience feature, not critical path

## Proposed Solutions

### Option A: Log to console.warn
- **Pros:** Matches main process pattern (line 1264), aids debugging
- **Cons:** None
- **Effort:** Small (one-line change)
- **Risk:** None

```typescript
api.app.syncClaudeTheme(resolved).catch((e) => console.warn('Failed to sync Claude theme:', e))
```

## Recommended Action

Option A.

## Technical Details

- **Affected files:** `src/App.tsx`

## Acceptance Criteria

- [ ] Errors from syncClaudeTheme are logged, not silently swallowed

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-22 | Created from PR #89 code review | |

## Resources

- PR #89
