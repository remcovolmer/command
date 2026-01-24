---
status: pending
priority: p1
issue_id: "004"
tags: [code-review, typescript, type-safety]
dependencies: []
---

# Unsafe `any` Cast Bypasses Type Safety

## Problem Statement

The Terminal component casts the state string to `any`, completely bypassing TypeScript's type checking. Invalid state strings will silently corrupt the Zustand store.

## Findings

### Evidence

**File:** `src/components/Terminal/Terminal.tsx:89`

```typescript
const handleStateChange = (terminalId: string, state: string) => {
  if (terminalId === id) {
    updateTerminalState(id, state as any)  // <-- UNSAFE
  }
}
```

The `TerminalState` type is defined as:

```typescript
type TerminalState = 'idle' | 'running' | 'waiting' | 'exited'
```

Any string from the IPC channel is accepted without validation.

## Proposed Solutions

### Option A: Runtime Validation (Recommended)

```typescript
const VALID_STATES: TerminalState[] = ['idle', 'running', 'waiting', 'exited']

const handleStateChange = (terminalId: string, state: string) => {
  if (terminalId === id) {
    if (VALID_STATES.includes(state as TerminalState)) {
      updateTerminalState(id, state as TerminalState)
    } else {
      console.warn(`Invalid terminal state received: ${state}`)
    }
  }
}
```

**Pros:** Type-safe, catches bugs early, good developer experience
**Cons:** Small runtime overhead
**Effort:** Low
**Risk:** Low

### Option B: Type Guard Function

```typescript
function isValidTerminalState(state: string): state is TerminalState {
  return ['idle', 'running', 'waiting', 'exited'].includes(state)
}

const handleStateChange = (terminalId: string, state: string) => {
  if (terminalId === id && isValidTerminalState(state)) {
    updateTerminalState(id, state)
  }
}
```

**Pros:** Reusable, TypeScript-idiomatic
**Cons:** Extra function to maintain
**Effort:** Low
**Risk:** Low

## Recommended Action

Option B - Type guard function (more reusable)

## Technical Details

### Affected Files
- `src/components/Terminal/Terminal.tsx`
- `src/types/index.ts` (add type guard)

### Acceptance Criteria
- [ ] No `as any` casts in codebase
- [ ] Invalid states are rejected with warning
- [ ] Type guard is reusable

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created from code review | Found via kieran-typescript-reviewer agent |

## Resources

- [TypeScript Type Guards](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates)
