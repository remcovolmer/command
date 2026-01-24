---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, security, validation, ipc]
dependencies: []
---

# Missing IPC Input Validation

## Problem Statement

IPC handlers accept parameters directly from the renderer without validation.

## Findings

**File:** `electron/main/index.ts:85-112`

No validation on `terminalId`, `cols`, `rows`, `projectPath`, or `data` length.

## Proposed Solution

Add validation helpers and bounds checking to all IPC handlers.

## Acceptance Criteria
- [ ] All IPC handlers validate input
- [ ] Bounds enforced on numeric values
- [ ] Path validation for project:add
