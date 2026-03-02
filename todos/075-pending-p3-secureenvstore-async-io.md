---
status: pending
priority: p3
issue_id: "075"
tags: [code-review, performance, profiles, main-thread]
dependencies: []
---

# Convert SecureEnvStore to async I/O

## Problem Statement

`SecureEnvStore.save()` uses synchronous `writeFileSync` and `renameSync`, blocking the main thread for 1-5ms per save. During `terminal:create`, the `getEnvVars` decryption loop calls `safeStorage.decryptString()` per key (~0.5ms each via DPAPI). With many env vars this accumulates. Also, `isEncryptionAvailable()` is called inside the loop per key instead of once before the loop.

Note: This follows the existing synchronous pattern in `ProjectPersistence.saveState()`. Converting is a cross-cutting concern.

## Findings

**Source:** Performance Oracle (Critical #1), Architecture Strategist (Low #4), Pattern Specialist (#1, #3)

**Location:** `electron/main/services/SecureEnvStore.ts`

## Proposed Solutions

1. Convert `save()` to async with `fs.promises`
2. Hoist `isEncryptionAvailable()` out of loops
3. Keep constructor `load()` synchronous (runs once at startup, acceptable)

**Effort:** Medium | **Risk:** Low

## Acceptance Criteria

- [ ] `save()` uses async fs operations
- [ ] `isEncryptionAvailable()` called once per method, not per key
- [ ] No main thread blocking during env var mutations

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
