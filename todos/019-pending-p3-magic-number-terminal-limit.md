---
status: pending
priority: p3
issue_id: "019"
tags: [code-review, maintainability]
dependencies: []
---

# Magic Number (Terminal Limit)

## Problem Statement

Hardcoded `3` for terminal limit appears in multiple places.

## Findings

**Files:**
- `src/components/Sidebar/Sidebar.tsx:48`
- `src/components/Layout/TerminalArea.tsx:26`

## Action

Extract to constant `MAX_TERMINALS_PER_PROJECT = 3`.
