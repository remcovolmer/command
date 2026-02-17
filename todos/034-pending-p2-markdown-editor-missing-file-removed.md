---
status: pending
priority: p2
issue_id: "034"
tags: [code-review, agent-native, editor, parity]
dependencies: []
---

# MarkdownEditor Missing file-removed Handling

## Problem Statement

CodeEditor properly handles `file-removed` events by setting `isDeletedExternally` and showing an AlertTriangle banner. MarkdownEditor has no `file-removed` handling - if an agent deletes a Markdown file, the editor stays open with stale content and no warning.

## Findings

**File:** `src/components/Editor/MarkdownEditor.tsx:176-197`

The `handleWatchEvents` only handles `file-changed` and `file-added`. Missing `file-removed` case.

Compare with CodeEditor.tsx lines 99-100 which correctly handles deletion.

## Proposed Solutions

### Option A: Add file-removed handling (Recommended)
Add a `file-removed` case that calls `setEditorTabDeletedExternally(tabId, true)` and display the same deletion banner.

**Pros:** Parity with CodeEditor, simple
**Cons:** None
**Effort:** Small (5-10 lines)

## Acceptance Criteria
- [ ] MarkdownEditor shows deletion banner when file is removed externally
- [ ] Banner clears when file is recreated (file-added while deleted)
