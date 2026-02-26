---
status: pending
priority: p2
issue_id: "056"
tags: [code-review, security, validation, automations]
dependencies: []
---

# Add pattern count limit in validateTrigger for file-change triggers

## Problem Statement

The `file-change` trigger validator limits individual pattern length to 500 characters but has no upper bound on the number of patterns. A malicious or buggy renderer could submit thousands of patterns, causing performance degradation in file-change matching.

## Findings

**Source:** Security Sentinel (Finding 4)
**Location:** `electron/main/index.ts` lines 53-58

## Proposed Solutions

### Option A: Add max pattern count (Recommended)

```typescript
if (patterns.length > 50) throw new Error('Too many patterns (max 50)')
```

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `validateTrigger` rejects file-change triggers with more than 50 patterns
- [ ] Error message is descriptive

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-26 | Created | From PR #52 code review |
