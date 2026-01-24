---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, memory-leak, security, typescript]
dependencies: []
---

# IPC Event Listeners Never Cleaned Up - Memory Leak

## Problem Statement

IPC event listeners (`onData`, `onStateChange`) are registered in Terminal.tsx but never removed during cleanup. Every terminal mount/unmount adds new listeners that accumulate, causing:

- Memory growth proportional to terminal switches
- Duplicate event handlers firing multiple times
- CPU overhead processing events multiple times

This is a **critical memory leak** that will degrade performance over extended use.

## Findings

### Evidence

**File:** `src/components/Terminal/Terminal.tsx:93-94`

```typescript
api.terminal.onData(handleData)
api.terminal.onStateChange(handleStateChange)
```

These listeners are added but the cleanup function at lines 102-109 does NOT remove them:

```typescript
return () => {
  isDisposedRef.current = true
  resizeObserver.disconnect()
  terminal.dispose()
  terminalRef.current = null
  fitAddonRef.current = null
  // Missing: cleanup for onData and onStateChange listeners!
}
```

**File:** `electron/preload/index.ts:31-41`

The `onData` and `onStateChange` functions use `ipcRenderer.on()` which adds listeners but returns void - there's no way to remove individual listeners.

```typescript
onData: (callback: (terminalId: string, data: string) => void) => {
  ipcRenderer.on('terminal:data', (_event, terminalId, data) => callback(terminalId, data))
},
onStateChange: (callback: (terminalId: string, state: string) => void) => {
  ipcRenderer.on('terminal:state', (_event, terminalId, state) => callback(terminalId, state))
},
```

## Proposed Solutions

### Option A: Return Unsubscribe Functions from Preload (Recommended)

Modify preload to return cleanup functions:

```typescript
onData: (callback: (terminalId: string, data: string) => void) => {
  const handler = (_event: any, terminalId: string, data: string) => callback(terminalId, data)
  ipcRenderer.on('terminal:data', handler)
  return () => ipcRenderer.removeListener('terminal:data', handler)
},
```

Then use in Terminal.tsx:

```typescript
const unsubData = api.terminal.onData(handleData)
const unsubState = api.terminal.onStateChange(handleStateChange)

return () => {
  unsubData()
  unsubState()
  // ... rest of cleanup
}
```

**Pros:** Clean API, proper cleanup, follows React patterns
**Cons:** Breaking change to ElectronAPI interface
**Effort:** Medium
**Risk:** Low

### Option B: Use removeAllListeners Per Terminal

Call `removeAllListeners` in cleanup, but filter by terminal ID in handlers.

**Pros:** Uses existing API
**Cons:** Removes ALL listeners, not just for this terminal
**Effort:** Low
**Risk:** Medium - could affect other terminals

## Recommended Action

Option A - Modify preload to return unsubscribe functions

## Technical Details

### Affected Files
- `src/components/Terminal/Terminal.tsx`
- `electron/preload/index.ts`
- `src/types/index.ts` (ElectronAPI interface)

### Acceptance Criteria
- [ ] `onData` and `onStateChange` return unsubscribe functions
- [ ] Terminal cleanup calls unsubscribe functions
- [ ] Memory does not grow when switching between terminals repeatedly
- [ ] No duplicate event handlers fire after terminal remount

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created from code review | Found via security-sentinel and performance-oracle agents |

## Resources

- [Electron IPC Best Practices](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [React useEffect Cleanup](https://react.dev/learn/synchronizing-with-effects#step-3-add-cleanup-if-needed)
