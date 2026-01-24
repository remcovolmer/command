---
status: pending
priority: p3
issue_id: "015"
tags: [code-review, cleanup]
dependencies: []
---

# Unused SearchAddon

## Problem Statement

SearchAddon is imported and loaded but no search UI exists.

## Findings

**File:** `src/components/Terminal/Terminal.tsx:5, 61`

## Action

Remove import or implement search functionality.
