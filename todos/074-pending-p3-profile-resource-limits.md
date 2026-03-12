---
status: pending
priority: p3
issue_id: "074"
tags: [code-review, security, profiles, validation]
dependencies: []
---

# Add resource limits for profiles and env vars

## Problem Statement

No upper bound on number of profiles or env vars per profile. A compromised renderer could create thousands of profiles or send thousands of key-value pairs. Low risk since it's a local app, but the pattern of bounding collections exists elsewhere (`MAX_TERMINALS_PER_PROJECT = 10`).

## Findings

**Source:** Security Sentinel (Low #3), Pattern Specialist (#6)

## Proposed Solutions

Add `MAX_PROFILES = 20` in `profile:add` and `MAX_ENV_VARS_PER_PROFILE = 50` in `profile:setEnvVars`.

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] Max 20 profiles enforced
- [ ] Max 50 env vars per profile enforced

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
