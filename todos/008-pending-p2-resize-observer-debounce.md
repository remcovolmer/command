---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, performance, react]
dependencies: []
---

# ResizeObserver Without Debouncing

## Problem Statement

ResizeObserver fires 60+ times/sec during resize causing layout thrashing.

## Findings

**File:** `src/components/Terminal/Terminal.tsx:97-100`

The `safeFit` function is called directly without debouncing.

## Proposed Solution

Add debounce or throttle to ResizeObserver callback:

```typescript
const debouncedFit = useMemo(() => debounce(safeFit, 100), [safeFit])
```

## Acceptance Criteria
- [ ] ResizeObserver callback is debounced
- [ ] No layout thrashing during resize
