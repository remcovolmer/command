---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, security, electron, ipc]
dependencies: []
---

# Unrestricted IPC Channel Listener Removal - Security Risk

## Problem Statement

The `removeAllListeners` function in the preload script accepts any arbitrary channel name from the renderer process. This allows the renderer to remove listeners on **any** IPC channel, not just the ones explicitly defined.

A compromised renderer process could:
- Remove security-critical listeners
- Cause denial of service by breaking IPC communication
- Interfere with application functionality

## Findings

### Evidence

**File:** `electron/preload/index.ts:79-81`

```typescript
removeAllListeners: (channel: string): void => {
  ipcRenderer.removeAllListeners(channel)
},
```

No validation is performed on the `channel` parameter.

## Proposed Solutions

### Option A: Whitelist Allowed Channels (Recommended)

```typescript
const ALLOWED_CHANNELS = [
  'terminal:data',
  'terminal:state',
  'terminal:exit',
  'app:close-request'
];

removeAllListeners: (channel: string): void => {
  if (ALLOWED_CHANNELS.includes(channel)) {
    ipcRenderer.removeAllListeners(channel)
  } else {
    console.warn(`Attempted to remove listeners from unauthorized channel: ${channel}`)
  }
},
```

**Pros:** Simple, secure, minimal code change
**Cons:** Must maintain whitelist
**Effort:** Low
**Risk:** Low

### Option B: Remove the Function Entirely

If issue #001 is fixed (returning unsubscribe functions), this function may not be needed at all.

**Pros:** Eliminates attack surface
**Cons:** May break existing cleanup patterns
**Effort:** Low
**Risk:** Medium - need to verify no legitimate uses

## Recommended Action

Option A - Whitelist allowed channels

## Technical Details

### Affected Files
- `electron/preload/index.ts`

### Acceptance Criteria
- [ ] `removeAllListeners` only accepts whitelisted channels
- [ ] Unauthorized attempts are logged
- [ ] All legitimate uses still work

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created from code review | Found via security-sentinel agent |

## Resources

- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
