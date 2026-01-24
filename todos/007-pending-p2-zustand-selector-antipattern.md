---
status: pending
priority: p2
issue_id: "007"
tags: [code-review, performance, react, zustand]
dependencies: []
---

# Zustand Selector Anti-Pattern

## Problem Statement

Sidebar destructures entire store causing unnecessary re-renders.

## Findings

**File:** `src/components/Sidebar/Sidebar.tsx:8-20`

```typescript
const { projects, terminals, ... } = useProjectStore()
```

Should use granular selectors:
```typescript
const projects = useProjectStore((s) => s.projects)
```

## Acceptance Criteria
- [ ] All components use granular selectors
- [ ] No full store destructuring
