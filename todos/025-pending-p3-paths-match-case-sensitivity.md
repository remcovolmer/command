---
status: pending
priority: p3
issue_id: "025"
tags: [code-review, cross-platform, file-paths]
dependencies: []
---

# pathsMatch Always Lowercases (Case-Insensitive)

## Problem Statement

The `pathsMatch` utility always lowercases both paths for comparison. This is correct for Windows (case-insensitive filesystem) but would be incorrect on Linux (case-sensitive). Since this is an Electron desktop app primarily targeting Windows, this is acceptable for now.

## Findings

**File:** `src/utils/paths.ts:10-13`

```typescript
export function pathsMatch(a: string, b: string): boolean {
  const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  return normalize(a) === normalize(b)
}
```

Used by: CodeEditor, MarkdownEditor, TasksPanel for matching watcher events to specific files.

## Proposed Solutions

### Option A: Platform-aware comparison (Recommended if Linux support needed)
Only lowercase on Windows (`process.platform === 'win32'`), or detect from Electron main process.

**Pros:** Cross-platform correct
**Cons:** Needs platform detection in renderer (via IPC or build-time constant)
**Effort:** Small

### Option B: Accept current behavior
Document the Windows-only assumption. Address if/when Linux support is added.

**Pros:** Zero effort now
**Cons:** Technical debt if Linux support comes
**Effort:** None

## Acceptance Criteria
- [ ] Decision documented on cross-platform path comparison strategy
