---
status: complete
priority: p1
issue_id: "062"
tags: [code-review, security, profiles, env-injection]
dependencies: []
---

# Sanitize env var key names to prevent dangerous overrides

## Problem Statement

The `profile:setEnvVars` IPC handler validates key length (0-200 chars) but does not restrict which env var names can be set. Since env overrides are spread *after* `process.env` in the PTY spawn, a user (or compromised renderer) can override critical system env vars like `PATH`, `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`, `LD_PRELOAD`, or `COMSPEC`. Setting `NODE_OPTIONS=--require=/path/to/malicious.js` would inject code into any Node.js process started in that shell.

In the context of a locally-running desktop app where the user configures their own environment, this is lower-risk. However, if the renderer is ever compromised (e.g., XSS in terminal output), this becomes an escalation vector to arbitrary code execution via the PTY.

## Findings

**Source:** Security Sentinel (Medium)

**Location:** `electron/main/index.ts` lines 558-560 (validation), `electron/main/services/TerminalManager.ts` lines 92-95 (env spread)

## Proposed Solutions

### Option A: Denylist dangerous env vars (Recommended)

```typescript
const BLOCKED_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'COMSPEC',
  'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE',
  'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES',
])
// In profile:setEnvVars handler:
if (BLOCKED_ENV_KEYS.has(key.toUpperCase())) throw new Error(`Cannot override system env var: ${key}`)
```

**Effort:** Small | **Risk:** Low

### Option B: Allowlist pattern

Only allow keys matching `/^(CLAUDE_|ANTHROPIC_|CLOUD_ML_|AWS_|GOOGLE_)/i`. Restrictive but prevents all unknown overrides.

**Effort:** Small | **Risk:** Medium (may block legitimate use cases)

### Option C: Regex + denylist combo

Enforce `/^[A-Z_][A-Z0-9_]*$/i` naming + denylist of dangerous vars.

**Effort:** Small | **Risk:** Low

## Recommended Action

Option A — denylist approach. Blocks known-dangerous vars while allowing arbitrary cloud provider env vars.

## Technical Details

- **Affected files:** `electron/main/index.ts` (profile:setEnvVars handler)
- **Affected lines:** 554-566

## Acceptance Criteria

- [ ] Denylist of dangerous env var keys implemented in `profile:setEnvVars`
- [ ] Keys validated with regex for valid env var naming
- [ ] Attempting to set a blocked key throws a clear error
- [ ] Existing Vertex AI keys (`CLAUDE_CODE_USE_VERTEX`, `CLOUD_ML_REGION`, `ANTHROPIC_VERTEX_PROJECT_ID`) pass validation

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-03-02 | Created | From account profiles code review |

## Resources

- Commit: a3b2623
