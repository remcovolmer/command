---
status: pending
priority: p2
issue_id: "010"
tags: [code-review, architecture, typescript]
dependencies: []
---

# Type Duplication Across Files

## Problem Statement

`Project`, `TerminalState` defined in 3+ places causing maintenance burden and drift risk.

## Findings

Types duplicated in:
- `src/types/index.ts`
- `electron/main/services/*.ts`
- `electron/preload/index.ts`

## Proposed Solution

Create shared types package or use single source of truth with proper imports.

## Acceptance Criteria
- [ ] Single source of truth for all types
- [ ] No duplicate type definitions
