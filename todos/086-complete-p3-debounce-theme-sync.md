---
status: pending
priority: p3
issue_id: "086"
tags: [code-review, performance, reliability]
dependencies: []
---

# Debounce theme sync for rapid toggles

## Problem Statement

Rapid theme toggling via keyboard shortcut (Ctrl+Shift+T) causes multiple concurrent read-modify-write cycles on `~/.claude.json`. The atomic rename prevents corruption, but concurrent reads could cause one write to clobber another's changes. The last-write-wins behavior means intermediate values get written unnecessarily.

## Findings

- **Source:** Performance Oracle, Architecture Strategist, Security Sentinel
- **Location:** `electron/main/index.ts:1248-1266` (handler), `src/App.tsx:397` (caller)
- **Severity:** Low — only theme value at risk, not data loss

## Proposed Solutions

### Option A: Debounce in renderer (simplest)
- **Pros:** Single debounce prevents multiple IPC calls
- **Cons:** Adds a small delay before sync
- **Effort:** Small

### Option B: Debounce in main process handler
- **Pros:** Protects against any caller, not just the current one
- **Cons:** Slightly more complex (need to manage timeout in handler)
- **Effort:** Small

## Recommended Action

Option A — 200ms debounce on the syncClaudeTheme call in applyTheme.

## Technical Details

- **Affected files:** `src/App.tsx` or `electron/main/index.ts`

## Acceptance Criteria

- [ ] Rapid theme toggles result in at most one file write per settling period

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-22 | Created from PR #89 code review | |

## Resources

- PR #89
