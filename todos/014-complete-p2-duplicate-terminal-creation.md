---
status: complete
priority: p2
issue_id: "014"
tags: [code-review, architecture, dry]
dependencies: []
---

# Duplicate Terminal Creation Logic

## Problem Statement

Same terminal creation code exists in 2 components - DRY violation.

## Findings

**Files:**
- `src/components/Sidebar/Sidebar.tsx:43-66`
- `src/components/Layout/TerminalArea.tsx:22-43`

## Proposed Solution

Extract to custom hook `useCreateTerminal()` or store action.

## Acceptance Criteria
- [ ] Single implementation of terminal creation
- [ ] Both components use shared logic
