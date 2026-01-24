---
status: pending
priority: p2
issue_id: "013"
tags: [code-review, architecture, consistency]
dependencies: []
---

# Inconsistent API Access Pattern

## Problem Statement

Mix of `window.electronAPI` and `getElectronAPI()` bypasses error handling.

## Findings

**File:** `src/components/Layout/TerminalArea.tsx:27-34`

Direct `window.electronAPI` access instead of helper function.

## Proposed Solution

Use `getElectronAPI()` consistently throughout codebase.

## Acceptance Criteria
- [ ] All API access uses `getElectronAPI()`
- [ ] No direct `window.electronAPI` access
