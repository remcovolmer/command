---
status: pending
priority: p2
issue_id: "053"
tags: [code-review, quality, type-safety, automations]
dependencies: ["052"]
---

# Use AutomationTrigger type alias for validateTrigger return type

## Problem Statement

`validateTrigger()` in `electron/main/index.ts` has a massive inlined union return type that spans 150+ characters. The `AutomationTrigger` type alias already exists and could be imported or redeclared locally. The inline union is a fifth location where the trigger shape is spelled out.

## Findings

**Source:** TypeScript Reviewer, Pattern Recognition
**Location:** `electron/main/index.ts` line 41

## Proposed Solutions

### Option A: Import AutomationTrigger from AutomationPersistence (Recommended)

```typescript
import type { AutomationTrigger } from './services/AutomationPersistence'

function validateTrigger(raw: unknown): AutomationTrigger {
```

**Effort:** Small | **Risk:** Low

### Option B: Declare local alias

```typescript
type AutomationTrigger = { type: 'schedule'; cron: string } | ...
function validateTrigger(raw: unknown): AutomationTrigger {
```

**Effort:** Small | **Risk:** Low (but adds yet another duplication)

## Acceptance Criteria

- [ ] `validateTrigger` return type references a named type, not an inline union
- [ ] Function signature is readable without horizontal scrolling
- [ ] Build passes

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-26 | Created | From PR #52 code review |
