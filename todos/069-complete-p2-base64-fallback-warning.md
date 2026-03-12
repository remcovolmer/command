---
status: complete
priority: p2
issue_id: "069"
tags: [code-review, security, profiles, encryption]
dependencies: []
---

# Add warning when safeStorage encryption is unavailable

## Problem Statement

When `safeStorage.isEncryptionAvailable()` returns `false`, SecureEnvStore stores env var values as base64 — which is encoding, not encryption. Any process with filesystem read access to `%APPDATA%/command/secure-env.json` can trivially decode all secrets. The code has a comment acknowledging this, but there is no user-facing warning or logging.

## Findings

**Source:** Security Sentinel (Medium #1), Architecture Strategist (Info #7)

**Location:** `electron/main/services/SecureEnvStore.ts` lines 58-61 and 79-81

## Proposed Solutions

### Option A: Log warning + UI indicator (Recommended)

1. Log a prominent `console.warn` on first fallback
2. Add an `encryptionAvailable: boolean` to the profile:list response
3. Show a yellow warning banner on the Accounts settings page when false

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] Console warning logged when safeStorage falls back to base64
- [ ] UI shows warning on Accounts page when encryption unavailable
- [ ] Warning explains the security implications

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
