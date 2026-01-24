---
status: pending
priority: p1
issue_id: "005"
tags: [code-review, memory-leak, react, typescript]
dependencies: ["001"]
---

# App Close Handler Listener Accumulation

## Problem Statement

The App component registers a new close request listener on every re-render when `hasActiveTerminals` changes, without cleaning up the previous listener. This causes listener accumulation and potential memory issues.

## Findings

### Evidence

**File:** `src/App.tsx:13-21`

```typescript
useEffect(() => {
  api.app.onCloseRequest(() => {
    if (hasActiveTerminals) {
      setShowCloseDialog(true)
    } else {
      api.app.confirmClose()
    }
  })
}, [hasActiveTerminals, api])  // Re-runs when hasActiveTerminals changes
```

Each time `hasActiveTerminals` changes, a new listener is added without removing the previous one.

## Proposed Solutions

### Option A: Fix After Issue #001 (Recommended)

Once issue #001 is fixed and `onCloseRequest` returns an unsubscribe function:

```typescript
useEffect(() => {
  const unsubscribe = api.app.onCloseRequest(() => {
    if (hasActiveTerminals) {
      setShowCloseDialog(true)
    } else {
      api.app.confirmClose()
    }
  })
  return unsubscribe
}, [hasActiveTerminals, api])
```

**Pros:** Clean, follows React patterns
**Cons:** Depends on issue #001
**Effort:** Low (after #001)
**Risk:** Low

### Option B: Use Ref for Current State

```typescript
const hasActiveTerminalsRef = useRef(hasActiveTerminals)
hasActiveTerminalsRef.current = hasActiveTerminals

useEffect(() => {
  api.app.onCloseRequest(() => {
    if (hasActiveTerminalsRef.current) {
      setShowCloseDialog(true)
    } else {
      api.app.confirmClose()
    }
  })
  // Only run once - use ref for current value
}, [api])
```

**Pros:** Works without modifying preload
**Cons:** Less idiomatic React
**Effort:** Low
**Risk:** Low

## Recommended Action

Option A after issue #001 is completed

## Technical Details

### Affected Files
- `src/App.tsx`

### Dependencies
- Issue #001 (IPC listener cleanup)

### Acceptance Criteria
- [ ] Close handler is properly cleaned up on re-render
- [ ] No listener accumulation over time
- [ ] Dialog still works correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created from code review | Related to issue #001 |

## Resources

- [React useEffect Dependencies](https://react.dev/reference/react/useEffect#specifying-reactive-dependencies)
