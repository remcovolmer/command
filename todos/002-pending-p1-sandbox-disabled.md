---
status: pending
priority: p1
issue_id: "002"
tags: [code-review, security, electron]
dependencies: []
---

# Electron Sandbox Disabled - Security Risk

## Problem Statement

The Electron sandbox is explicitly disabled (`sandbox: false`). Now that node-pty is installed, this is required for PTY functionality, but the current implementation disables sandbox globally for ALL renderer processes.

If an attacker achieves code execution in the renderer process (e.g., via XSS), they have direct access to Node.js APIs through the preload script without sandbox restrictions.

## Findings

### Evidence

**File:** `electron/main/index.ts:54`

```typescript
webPreferences: {
  preload,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false, // Required for node-pty when we add it
},
```

The comment is now outdated since node-pty is installed.

## Proposed Solutions

### Option A: Keep Sandbox Disabled (Current State)

Since node-pty requires sandbox to be disabled for PTY operations, keep the current configuration but update the comment to reflect this is intentional.

**Pros:** Simple, works with node-pty
**Cons:** Reduced security posture
**Effort:** Minimal
**Risk:** Medium - accepted risk for terminal functionality

### Option B: Use Utility Process for PTY (Best Practice)

Move PTY operations to a separate utility process with sandbox disabled, while keeping the main renderer sandboxed.

```typescript
// Main window stays sandboxed
webPreferences: {
  sandbox: true,
  // ...
}

// Utility process for PTY
const ptyProcess = utilityProcess.fork(path.join(__dirname, 'pty-worker.js'))
```

**Pros:** Best security practice, isolates PTY
**Cons:** More complex architecture, IPC overhead
**Effort:** High
**Risk:** Low

### Option C: Document and Accept Risk

Keep sandbox disabled but add security documentation explaining the trade-off.

**Pros:** Minimal effort, transparent
**Cons:** Doesn't improve security
**Effort:** Low
**Risk:** Medium

## Recommended Action

Option A for now (update comment), consider Option B for future security hardening.

## Technical Details

### Affected Files
- `electron/main/index.ts`

### Acceptance Criteria
- [ ] Comment updated to reflect node-pty is installed
- [ ] Security implications documented in CLAUDE.md
- [ ] Consider utility process architecture for future versions

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created from code review | node-pty now installed, sandbox disable is intentional |

## Resources

- [Electron Sandbox Documentation](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [Electron Utility Process](https://www.electronjs.org/docs/latest/api/utility-process)
