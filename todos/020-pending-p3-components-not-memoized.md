---
status: pending
priority: p3
issue_id: "020"
tags: [code-review, performance]
dependencies: []
---

# Components Not Memoized

## Problem Statement

`ProjectItem` and `TerminalItem` re-render unnecessarily.

## Findings

**File:** `src/components/Sidebar/Sidebar.tsx:175-319`

## Action

Wrap with `React.memo()` for better performance.
