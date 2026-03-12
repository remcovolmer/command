---
title: "fix: Remove /workflows:plan prefill from worktree terminals"
type: fix
status: completed
date: 2026-03-12
---

# fix: Remove /workflows:plan prefill from worktree terminals

## Overview

When a worktree terminal is created, `/workflows:plan ` is automatically prefilled into the Claude Code prompt after a 3-second delay. This behavior is unwanted and should be removed along with all supporting code.

## Problem Statement

The prefill feature injects text into the PTY 3 seconds after Claude starts, which is:
- Unwanted by the user
- Fragile (timing-based, no signal that Claude is ready)
- Tightly coupled to a single use case with no other consumers

Since `initialInput` has no other callers, the entire mechanism can be removed cleanly.

## Proposed Solution

Remove 3 things:
1. The prefill trigger in the IPC handler
2. The `initialInput` field from `CreateTerminalOptions`
3. The `initialInput` delivery mechanism (timeout + PTY write) in `TerminalManager`
4. The `CLAUDE_STARTUP_DELAY_MS` constant (only used by `initialInput`)

## Acceptance Criteria

- [x] Opening a worktree terminal no longer prefills any text
- [x] `initialInput` removed from `CreateTerminalOptions` interface
- [x] `CLAUDE_STARTUP_DELAY_MS` constant removed
- [x] `initialInput` handling block removed from `createTerminal()`
- [x] No references to `initialInput`, `effectiveInitialInput`, or `CLAUDE_STARTUP_DELAY_MS` remain in source code
- [x] App builds without errors
- [x] Existing tests pass

## MVP

### 1. `electron/main/index.ts` (lines 389-394)

Remove the prefill variable and its usage:

```typescript
// REMOVE these lines:
// For worktree terminals, default to plan mode initial input
const effectiveInitialInput = worktreeId ? '/workflows:plan ' : undefined

// REMOVE from createTerminal call:
initialInput: effectiveInitialInput,
```

After:
```typescript
  return terminalManager?.createTerminal({
    cwd,
    type,
    initialTitle,
    projectId,
    worktreeId: worktreeId ?? undefined,
    dangerouslySkipPermissions: project?.settings?.dangerouslySkipPermissions ?? false,
    envOverrides,
  })
```

### 2. `electron/main/services/TerminalManager.ts`

**Remove constant** (line 9):
```typescript
// REMOVE:
const CLAUDE_STARTUP_DELAY_MS = 3000
```

**Remove from `CreateTerminalOptions`** (line 17):
```typescript
// REMOVE:
initialInput?: string
```

**Remove from destructuring** (line 71):
```typescript
// REMOVE initialInput from:
const { cwd, type = 'claude', initialInput, initialTitle, projectId, worktreeId } = options
// becomes:
const { cwd, type = 'claude', initialTitle, projectId, worktreeId } = options
```

**Remove initialInput block** (lines 160-166):
```typescript
// REMOVE entire block:
      // If initialInput is provided, send it after Claude has started
      if (initialInput) {
        const inputTimeout = setTimeout(() => {
          if (this.terminals.has(id)) ptyProcess.write(initialInput)
        }, CLAUDE_STARTUP_DELAY_MS)
        terminal.timeouts.push(inputTimeout)
      }
```

## Sources

- `electron/main/index.ts:389-394` — prefill trigger
- `electron/main/services/TerminalManager.ts:9` — `CLAUDE_STARTUP_DELAY_MS` constant
- `electron/main/services/TerminalManager.ts:14-22` — `CreateTerminalOptions` interface
- `electron/main/services/TerminalManager.ts:67-172` — `createTerminal()` method
