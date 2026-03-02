---
status: complete
priority: p2
issue_id: "071"
tags: [code-review, security, profiles, ux]
dependencies: []
---

# Use password input type for env var values

## Problem Statement

Env var value inputs in `AccountsSection.tsx` use `type="text"`, displaying API keys, tokens, and credentials in plaintext on screen. Since the whole feature is about encrypted env storage, showing secrets in cleartext during input undermines the security posture. Shoulder surfing risk.

## Findings

**Source:** TypeScript Reviewer (Moderate #8), Security Sentinel (Low #4), Pattern Specialist (#14)

**Location:** `src/components/Settings/AccountsSection.tsx` line 291

## Proposed Solutions

Change `type="text"` to `type="password"` with an optional toggle-visibility button.

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] Env var value inputs use `type="password"`
- [ ] Optional show/hide toggle for each value

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
