---
title: Harden Tasks Tab with Security Fixes, Simplifications, and UX Improvements
date: 2026-02-15
category: security-issues
tags: [electron, ipc, path-traversal, input-validation, react, tailwind, yagni, refactoring, ux]
modules: [TaskService, TaskItem, TaskSection, TasksPanel, FileExplorer]
severity: high
resolution_time: ~1 hour
problem_type: [security_issue, ui_bug, code_smell]
---

# Harden Tasks Tab with Security Fixes, Simplifications, and UX Improvements

## Problem

The Tasks tab feature (PR #40) had several critical issues discovered during a multi-agent code review:

1. **Path traversal vulnerability** - Task IPC handlers (`tasks:update`, `tasks:add`, `tasks:delete`, `tasks:move`) validated only the project path but not file paths within the project. An attacker could craft a `filePath` value like `../../../etc/passwd` to read/write files outside the project boundary.

2. **Tasks tab inaccessible for workspace/project types** - The guard condition `(isLimitedProject || activeTab === 'files')` forced all non-code projects to always show FileTree, making the Tasks tab unreachable even though tasks can exist in any project type.

3. **Invisible add-task button** - The Plus button used `group-hover:opacity-100` but the parent `<div>` lacked the Tailwind `group` class, so the button never became visible on hover.

4. **Over-engineered task utilities (YAGNI)** - Five unnecessary features inflated complexity:
   - `findTaskNearby()` - Silent fallback that could corrupt the wrong task during concurrent edits
   - `atomicWrite()` - Overkill temp-file+rename for small markdown files
   - Cross-file move support (`targetFilePath`) - Never used by the UI
   - 20+ section aliases - Premature normalization for 5 canonical sections
   - `isKnownSection` field - Set but never read by any UI component

5. **Bold marker leak** - TaskService wrapped text in `**` on write but didn't strip on parse, forcing 3 separate `.replace(/\*\*/g, '')` calls in TaskItem.

6. **Long task text unreadable** - Tasks were always truncated with `truncate` class, no way to expand and read full content.

## Root Cause

### 1. Path Traversal - Missing validateFilePathInProject

**Before:**
```typescript
ipcMain.handle('tasks:update', async (_event, projectPath: string, update: { filePath: string; ... }) => {
  validateProjectPath(projectPath)  // Only validates string length (0-1000 chars)
  return taskService?.updateTask(projectPath, update) ?? null  // filePath not validated!
})
```

The existing `validateFilePathInProject()` function (used by all `fs:*` handlers) resolves the path, normalizes it, and verifies it's within a registered project directory. The task handlers used only `validateProjectPath()` which checks string length only.

### 2. isLimitedProject Guard Logic Error

```typescript
// Before - Tasks tab unreachable when isLimitedProject=true
(isLimitedProject || activeTab === 'files') ? (
  <FileTree />      // Always matches for workspace/project types
) : activeTab === 'tasks' ? (
  <TasksPanel />    // Never reached
) : ...
```

### 3. Missing Tailwind Group Class

```tsx
// Before - no group class on parent
<div className="flex items-center gap-1 px-2 py-1.5 ...">
  <button className="... opacity-0 group-hover:opacity-100 ...">  // Never triggers
```

### 4-6. YAGNI, Bold Markers, Truncation

- `findTaskNearby` searched +/-5 lines for any checkbox, ignoring the `_expectedContent` parameter entirely
- Bold markers added in `addTask`/`applyUpdate` but never stripped in `parseLine`
- Text always rendered with `truncate` class, no expand mechanism

## Solution

### Step 1: Secure IPC Handlers

Added `validateFilePathInProject()` + input validation to all four task handlers:

```typescript
ipcMain.handle('tasks:update', async (_event, projectPath, update) => {
  validateProjectPath(projectPath)
  update.filePath = validateFilePathInProject(update.filePath)
  if (typeof update.lineNumber !== 'number' || update.lineNumber < 1 || update.lineNumber > 100000) {
    throw new Error('Invalid line number')
  }
  if (!['toggle', 'edit', 'delete'].includes(update.action)) {
    throw new Error('Invalid action')
  }
  // ...
})
```

### Step 2: Fix isLimitedProject Guard

Reordered conditional so Tasks tab is checked first:

```typescript
activeTab === 'tasks' ? (
  <TasksPanel project={activeProject} />
) : (isLimitedProject || activeTab === 'files') ? (
  <FileTree project={activeProject} />
) : (
  <GitStatusPanel ... />
)
```

Also fixed tab bar: `activeTab={isLimitedProject && activeTab === 'git' ? 'files' : activeTab}`

### Step 3: Add Group Classes

```tsx
// TaskSection.tsx - named group to avoid nesting conflicts
<div className="group/header flex items-center gap-1 ...">
  <button className="... opacity-0 group-hover/header:opacity-100 ...">
```

### Step 4: Remove Over-Engineering

- `SECTION_ALIASES` (20+ keywords) -> `SECTION_PRIORITIES` (5 entries)
- Deleted `findTaskNearby()`, `atomicWrite()`, `serializeTask()`
- Removed `targetFilePath` from `TaskMove` type (all 3 locations)
- Removed `isKnownSection` from `TaskSection` type (all 3 locations)
- Replaced `atomicWrite()` calls with direct `writeFile()`

### Step 5: Strip Bold Markers at Parse Time

```typescript
// TaskService.ts parseLine()
const rawText = line.slice(match[0].length)
const text = rawText.replace(/\*\*/g, '')  // Strip once at source
```

Removed all 3 `.replace(/\*\*/g, '')` calls from TaskItem.tsx.

### Step 6: Click-to-Expand + Pencil Edit Icon

```tsx
const [expanded, setExpanded] = useState(false)

<span
  onClick={() => setExpanded(!expanded)}
  className={`... ${expanded ? 'whitespace-pre-wrap break-words' : 'truncate'} ...`}
>

// Separate edit button with Pencil icon
<button onClick={handleStartEdit} className="... opacity-0 group-hover:opacity-100 ...">
  <Pencil className="w-3 h-3 ..." />
</button>
```

## Verification

1. **TypeScript** - `tsc --noEmit` passes with zero errors
2. **Tests** - `npm run test` passes (3/3 tests)
3. **Net reduction** - 101 insertions, 149 deletions (-48 lines) across 8 files

## Prevention Strategies

### Checklist for New IPC Handlers
- [ ] All file path parameters validated with `validateFilePathInProject()`
- [ ] All numeric parameters validated for type and reasonable bounds
- [ ] All enum/string parameters validated against allowed values
- [ ] Project path validated with `validateProjectPath()`

### Checklist for New File Explorer Tabs
- [ ] Tab renders correctly for all project types (workspace, project, code)
- [ ] `isLimitedProject` guard only blocks tabs that truly need git context
- [ ] Tab content routing handles new tab ID before fallback

### Tailwind group-hover Pattern
- Always add `group` (or `group/name`) class to the parent element
- Use named groups (`group/header`) to avoid conflicts with nested group contexts

### YAGNI Principle
- Don't add backend support for features the UI doesn't use yet
- Prefer throwing errors over silently degrading (`findTaskNearby` lesson)
- Parse/strip format details at the boundary, not in every consumer

## Related Documentation

- [GitHub Context Menu Integration](../integration-issues/github-context-menu-integration.md) - 4-layer IPC pattern with security analysis
- [Terminal Link Feature Review](../code-review/terminal-link-feature-review-fixes.md) - Code review patterns for IPC endpoints
- [Editor Save Handler Logic Errors](../logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md) - Multi-layer event flow patterns
- [Tasks Tab Plan](../../plans/2026-02-15-feat-tasks-tab-sidebar-plan.md) - Implementation roadmap
- CLAUDE.md: IPC Communication Pattern, Key Patterns sections
- PR #40: `feat: add Tasks tab to right sidebar for TASKS.md management`
