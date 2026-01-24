---
status: pending
priority: p2
issue_id: "009"
tags: [code-review, security, typescript]
dependencies: []
---

# Unsafe JSON Parsing Without Validation

## Problem Statement

`as PersistedState` cast assumes valid data - corrupted file causes crash.

## Findings

**File:** `electron/main/services/ProjectPersistence.ts:34-35`

```typescript
const data = JSON.parse(content) as PersistedState
```

## Proposed Solution

Add try/catch and schema validation, return default state on error.

## Acceptance Criteria
- [ ] JSON parsing wrapped in try/catch
- [ ] Schema validation before cast
- [ ] Graceful fallback on corruption
