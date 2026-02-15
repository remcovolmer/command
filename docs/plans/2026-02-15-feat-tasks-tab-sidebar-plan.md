---
title: "feat: Add Tasks tab to right sidebar for TASKS.md management"
type: feat
status: completed
date: 2026-02-15
brainstorm: docs/brainstorms/2026-02-15-tasks-tab-brainstorm.md
---

# feat: Add Tasks tab to right sidebar for TASKS.md management

## Overview

Add a "Tasks" tab to the right sidebar (alongside Files and Git) that parses `TASKS.md` files from the project root and subfolders, displays tasks grouped by section (Now/Next/Waiting/Later/Done + custom), and supports inline editing, drag-and-drop between sections, and live file watching for external tool sync.

## Problem Statement / Motivation

Task management lives outside Command today. TASKS.md files (maintained by `/productivity`) exist in project directories but aren't visible while coding. Users must switch to Obsidian or a terminal to check tasks. Surfacing tasks directly in the sidebar keeps context close and enables quick task operations without breaking flow.

## Proposed Solution

A new TasksPanel component in the right sidebar, backed by a TaskService in the main process that handles TASKS.md parsing and serialization. The panel groups tasks by section, supports inline editing that writes back to the source file, and uses the existing `fs:watchFile` infrastructure for live sync.

## Technical Approach

### Architecture

Follow the established 4-layer IPC pattern:

```
TaskService (new service)
  → IPC handlers (tasks:scan, tasks:read, tasks:update, tasks:create-file)
    → Preload bridge (window.electronAPI.tasks.*)
      → React components (TasksPanel, TaskSection, TaskItem)
```

File watching reuses existing `fs:watchFile` / `fs:onFileChanged` infrastructure.

### Files to Modify/Create

**Backend (Main Process)**

| File | Change |
|------|--------|
| `electron/main/services/TaskService.ts` | **New** - TASKS.md discovery, parsing, serialization, template creation |
| `electron/main/index.ts` | Add IPC handlers for `tasks:scan`, `tasks:read`, `tasks:update`, `tasks:add`, `tasks:delete`, `tasks:move`, `tasks:create-file`; instantiate TaskService |
| `electron/preload/index.ts` | Add `tasks` namespace with bridge methods; add `tasks:changed` to allowed listener channels |

**Types**

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `TaskItem`, `TaskSection`, `TasksData`, `TaskUpdate` interfaces; extend `ElectronAPI` with `tasks` namespace |

**State**

| File | Change |
|------|--------|
| `src/stores/projectStore.ts` | Widen `fileExplorerActiveTab` to `'files' \| 'git' \| 'tasks'`; add `tasksData`, `tasksLoading` keyed state; add setter actions |

**UI Components**

| File | Change |
|------|--------|
| `src/components/FileExplorer/FileExplorerTabBar.tsx` | Widen tab type union; add Tasks tab entry with `ListTodo` icon and badge |
| `src/components/FileExplorer/FileExplorer.tsx` | Import TasksPanel; add rendering branch for `activeTab === 'tasks'`; add tasks refresh handler |
| `src/components/FileExplorer/TasksPanel.tsx` | **New** - Main tasks panel with section-grouped view, file watching, empty state |
| `src/components/FileExplorer/TaskSection.tsx` | **New** - Collapsible section (Now/Next/etc.) with task list and drag-drop zone |
| `src/components/FileExplorer/TaskItem.tsx` | **New** - Single task row with checkbox, inline edit, due date, person tags |

**Hotkeys & Docs**

| File | Change |
|------|--------|
| `src/types/hotkeys.ts` | Add `'fileExplorer.tasksTab'` to `HotkeyAction` union |
| `src/utils/hotkeys.ts` | Add default binding `Ctrl+Shift+K` for tasks tab |
| `src/App.tsx` | Register `fileExplorer.tasksTab` hotkey handler |
| `CLAUDE.md` | Document `Ctrl+Shift+K` shortcut in Keyboard Shortcuts table |

### Data Model

```typescript
// src/types/index.ts - new types

interface TaskItem {
  id: string                    // Generated: `${filePath}:${lineNumber}`
  text: string                  // Full task text (without checkbox syntax)
  completed: boolean            // true = [x], false = [ ]
  section: string               // Section name (e.g., "Now", "Next", custom)
  filePath: string              // Source TASKS.md file path
  lineNumber: number            // Line number in source file
  dueDate?: string              // Parsed from 📅 YYYY-MM-DD
  personTags?: string[]         // Parsed from [[Name]] syntax
  isOverdue?: boolean           // Computed: dueDate < today
  isDueToday?: boolean          // Computed: dueDate === today
}

interface TaskSection {
  name: string                  // Section heading text
  priority: number              // Sort order (Now=0, Next=1, Waiting=2, Later=3, Done=4, custom=5+)
  tasks: TaskItem[]
  isKnownSection: boolean       // true for Now/Next/Waiting/Later/Done
}

interface TasksData {
  sections: TaskSection[]
  files: string[]               // All discovered TASKS.md file paths
  totalOpen: number             // Count of uncompleted tasks
  nowCount: number              // Count of tasks in "Now" section (for badge)
}

// IPC types
interface TaskUpdate {
  filePath: string
  lineNumber: number
  action: 'toggle' | 'edit' | 'delete'
  newText?: string              // For 'edit' action
}

interface TaskMove {
  filePath: string
  lineNumber: number
  targetSection: string         // Section name to move to
  targetFilePath?: string       // If moving between files (default: same file)
}

interface TaskAdd {
  filePath: string              // Which TASKS.md to add to
  section: string               // Which section
  text: string                  // Task text
}

// ElectronAPI extension
interface ElectronAPI {
  // ... existing ...
  tasks: {
    scan: (projectPath: string) => Promise<TasksData>
    update: (projectPath: string, update: TaskUpdate) => Promise<TasksData>
    add: (projectPath: string, task: TaskAdd) => Promise<TasksData>
    delete: (projectPath: string, filePath: string, lineNumber: number) => Promise<TasksData>
    move: (projectPath: string, move: TaskMove) => Promise<TasksData>
    createFile: (projectPath: string) => Promise<string>  // Returns created file path
  }
}
```

### Implementation Phases

#### Phase 1: TaskService + Types + IPC

**Goal:** Backend foundation - parse and write TASKS.md files.

1. Define types in `src/types/index.ts` (`TaskItem`, `TaskSection`, `TasksData`, `TaskUpdate`, `TaskMove`, `TaskAdd`)

2. Create `electron/main/services/TaskService.ts`:
   - `scanForTaskFiles(projectPath: string): string[]` - Recursive scan for TASKS.md files (case-insensitive)
   - `parseTaskFile(filePath: string): TaskSection[]` - Parse single TASKS.md into sections
   - `parseAllTasks(projectPath: string): TasksData` - Aggregate all TASKS.md files
   - `updateTask(projectPath: string, update: TaskUpdate): TasksData` - Toggle/edit/delete a task, rewrite file
   - `addTask(projectPath: string, task: TaskAdd): TasksData` - Add task to section, rewrite file
   - `moveTask(projectPath: string, move: TaskMove): TasksData` - Move task between sections (remove from source, add to target)
   - `createTemplateFile(projectPath: string): string` - Create TASKS.md with Now/Next/Waiting/Later/Done sections
   - **Private helpers:**
     - `parseLine(line: string): Partial<TaskItem>` - Parse checkbox, bold, due date, person tags
     - `serializeTask(task: TaskItem): string` - Convert back to markdown line
     - `mapSectionName(heading: string): { name: string, priority: number, isKnown: boolean }` - Map H2 text to known section or custom
     - `rewriteFile(filePath: string, sections: TaskSection[]): void` - Serialize sections back to markdown, preserving non-task content

   **Parsing rules:**
   - H2 headings (`## `) define section boundaries
   - Section name mapping (case-insensitive, keyword match):
     - Now / Current / Active / In Progress → priority 0
     - Next / Up Next / Soon / Planned / Todo → priority 1
     - Waiting / Blocked / On Hold → priority 2
     - Later / Someday / Backlog / Ideas → priority 3
     - Done / Completed / Finished → priority 4
     - Unknown → priority 5+ (in order of appearance)
   - Lines matching `- [ ] ` or `- [x] ` are tasks
   - Bold text `**...**` is the task title
   - `📅 YYYY-MM-DD` pattern extracts due date
   - `[[Name]]` pattern extracts person tags (multiple allowed per task)
   - Non-task lines (blank lines, paragraphs, H1) preserved during rewrite

   **Write-back strategy (concurrent edit safety):**
   - Read file fresh before every write operation (no stale cache)
   - Use line number + text match to locate the task (not just line number alone)
   - If line content doesn't match, re-scan and find by fuzzy text match
   - Write atomically: write to temp file, then rename

3. Add IPC handlers in `electron/main/index.ts`:
   ```typescript
   ipcMain.handle('tasks:scan', async (_event, projectPath: string) => {
     validateProjectPath(projectPath)
     return taskService?.parseAllTasks(projectPath) ?? null
   })
   // Similar for tasks:update, tasks:add, tasks:delete, tasks:move, tasks:create-file
   ```

4. Add preload bridge in `electron/preload/index.ts`:
   ```typescript
   tasks: {
     scan: (projectPath: string) => ipcRenderer.invoke('tasks:scan', projectPath),
     update: (projectPath: string, update: TaskUpdate) => ipcRenderer.invoke('tasks:update', projectPath, update),
     // ...
   }
   ```

5. Extend `ElectronAPI` type in `src/types/index.ts`

**Tests:**
- `TaskService.parseTaskFile()` with the example TASKS.md format
- Section name mapping for all known aliases
- Due date and person tag extraction
- Write-back round-trip: parse → modify → serialize → parse should match
- Edge cases: empty file, no sections, only Done tasks, mixed checkbox formats

**Success criteria:** `tasks:scan` returns correctly parsed TasksData from a test TASKS.md file.

---

#### Phase 2: Store + Tab Integration

**Goal:** Wire the Tasks tab into the sidebar with data fetching.

1. Update `src/stores/projectStore.ts`:
   - Widen `fileExplorerActiveTab` type: `'files' | 'git' | 'tasks'`
   - Add state fields:
     ```typescript
     tasksData: Record<string, TasksData>        // keyed by project.id
     tasksLoading: Record<string, boolean>
     ```
   - Add actions:
     ```typescript
     setTasksData: (projectId: string, data: TasksData) => void
     setTasksLoading: (projectId: string, loading: boolean) => void
     ```
   - Already persisted via existing `partialize` (fileExplorerActiveTab)
   - Do NOT persist tasksData (reload from disk on startup)

2. Update `src/components/FileExplorer/FileExplorerTabBar.tsx`:
   - Widen type union to `'files' | 'git' | 'tasks'`
   - Add tasks tab to `allTabs`:
     ```typescript
     { id: 'tasks' as const, label: 'Tasks', icon: ListTodo, badge: taskNowCount }
     ```
   - Add `taskNowCount` prop (number, for badge)
   - Tasks tab visible for all project types (not hidden for limited projects)

3. Update `src/components/FileExplorer/FileExplorer.tsx`:
   - Import `TasksPanel`
   - Add `activeTab === 'tasks'` branch in content rendering
   - Add tasks refresh handler (calls `tasks:scan` and updates store)
   - Pass `taskNowCount` to tab bar from store
   - Extend `handleRefresh` routing for tasks tab

4. Add hotkey (`Ctrl+Shift+K`):
   - `src/types/hotkeys.ts`: Add `'fileExplorer.tasksTab'`
   - `src/utils/hotkeys.ts`: Add default config
   - `src/App.tsx`: Add handler that opens sidebar + switches to tasks tab

**Success criteria:** Tasks tab appears in sidebar, clicking it shows a placeholder panel, badge shows count, hotkey works.

---

#### Phase 3: TasksPanel - Read-Only View

**Goal:** Display tasks from TASKS.md files with section grouping, due dates, person tags.

1. Create `src/components/FileExplorer/TasksPanel.tsx`:
   - Props: `project: Project`
   - On mount: call `api.tasks.scan(project.path)` → store results in Zustand
   - Set up file watching: call `api.fs.watchFile()` for each discovered TASKS.md path
   - Listen to `api.fs.onFileChanged()` → debounce 300ms → re-scan tasks
   - Cleanup: unwatch files on unmount or project change
   - Render: loading state → section list → empty state with "Create TASKS.md" button

   **Empty state:**
   ```
   No TASKS.md found
   [Create TASKS.md] button → calls api.tasks.createFile(project.path)
   ```

2. Create `src/components/FileExplorer/TaskSection.tsx`:
   - Props: `section: TaskSection`, `defaultExpanded: boolean`
   - Collapsible header with chevron, section name, task count badge
   - Done section: collapsed by default, "[show]" toggle
   - Empty sections: collapsed by default, show "(empty)" label
   - Renders list of `TaskItem` components

3. Create `src/components/FileExplorer/TaskItem.tsx`:
   - Props: `task: TaskItem`, `onToggle`, `onEdit`, `onDelete`
   - Checkbox (not yet functional in this phase - just visual)
   - Task text (truncated with tooltip on hover for full text)
   - Due date chip: gray default, orange if today, red if overdue
   - Person tags: small pills showing extracted names
   - Source file label (subtle, only if multiple TASKS.md files)
   - Completed tasks: muted text, strikethrough

**Styling patterns** (follow GitStatusPanel):
- `text-sm` sizing
- `lucide-react` icons (ListTodo, CheckSquare, Square, Calendar, User)
- Tailwind utility classes
- `h-full flex flex-col` for proper flex layout

**Success criteria:** Tasks from all TASKS.md files display correctly grouped by section, with due dates highlighted and person tags shown.

---

#### Phase 4: Inline Editing

**Goal:** Toggle checkboxes, edit task text, add and delete tasks.

1. **Checkbox toggle** (TaskItem):
   - Click checkbox → call `api.tasks.update(projectPath, { filePath, lineNumber, action: 'toggle' })`
   - TaskService toggles `[ ]` ↔ `[x]`
   - If completing (→ `[x]`): TaskService moves task to Done section in file
   - Response returns fresh `TasksData` → update store → UI re-renders
   - Optimistic update: toggle visually immediately, revert on error

2. **Inline text editing** (TaskItem):
   - Click task text → transform to `<input>` element
   - Pre-fill with current text (without markdown formatting)
   - Save on Enter or blur, cancel on Escape
   - Call `api.tasks.update(projectPath, { filePath, lineNumber, action: 'edit', newText })`
   - Use ref pattern for stable callback (per learnings doc)

3. **Add task** (TaskSection):
   - "+" button on section header
   - Click → show inline `<input>` at top of section
   - Enter → call `api.tasks.add(projectPath, { filePath, section, text })`
   - File selection: if multiple TASKS.md files, add to root file by default
   - New tasks get `- [ ] **{text}**` format

4. **Delete task** (TaskItem):
   - Small "X" button on hover (right side of task row)
   - Confirm with a brief inline "Are you sure?" or just delete (single undo possible via Ctrl+Z in file)
   - Call `api.tasks.delete(projectPath, filePath, lineNumber)`

**Concurrent edit safety:**
- Every write operation reads the file fresh before modifying
- Task identification: match by line number AND text content
- If text doesn't match at expected line: search nearby lines (±5) for fuzzy match
- If no match found: re-scan entire file, return error if task is gone
- Atomic writes: write to `.TASKS.md.tmp` then rename to `TASKS.md`

**Success criteria:** All CRUD operations work, file changes are persisted correctly, concurrent external edits don't corrupt the file.

---

#### Phase 5: Drag-and-Drop Between Sections

**Goal:** Drag tasks between sections to reprioritize.

1. **Drag implementation** using native HTML5 drag-and-drop (no library needed for this simple case):
   - TaskItem: `draggable="true"`, `onDragStart` sets task data in `dataTransfer`
   - TaskSection: `onDragOver` shows drop indicator, `onDrop` triggers move
   - Visual feedback: drop zone highlight on the target section header
   - Drag handle: subtle grip icon on left side of task row

2. **Drop handler:**
   - Extract source task (filePath, lineNumber) from `dataTransfer`
   - Determine target section name from drop zone
   - Call `api.tasks.move(projectPath, { filePath, lineNumber, targetSection })`
   - TaskService: removes task line from source section, inserts at top of target section
   - Returns fresh `TasksData` → update store

3. **Edge cases:**
   - Drag to same section = no-op
   - Drag to Done section = mark as completed (`[x]`)
   - Drag from Done to active section = mark as open (`[ ]`)
   - Drag between sections in different TASKS.md files = move across files

**Success criteria:** Tasks can be dragged between any sections, file is updated correctly, visual feedback is clear.

---

## Alternative Approaches Considered

| Approach | Why Rejected |
|----------|-------------|
| Renderer-side parsing (use `fs:readFile` directly) | Violates 4-layer IPC pattern; parsing in renderer means no validation/security boundary |
| Dedicated file watcher service for tasks | Over-engineering; existing `fs:watchFile` infrastructure is sufficient |
| External library for markdown parsing (remark/unified) | TASKS.md format is simple enough for regex-based parsing; no need for full AST |
| Drag-and-drop library (dnd-kit, react-beautiful-dnd) | Overkill for section-to-section moves; native HTML5 DnD is sufficient |
| Real-time collaborative editing (CRDT) | Way too complex; read-fresh-before-write with fuzzy matching handles concurrent edits adequately |

## Acceptance Criteria

### Functional Requirements

- [x] Tasks tab appears in right sidebar with `ListTodo` icon
- [x] Tab badge shows count of "Now" section tasks
- [x] Tasks from root and subfolder TASKS.md files are merged and grouped by section
- [x] Known sections (Now/Next/Waiting/Later/Done) sorted by priority; custom sections appear after
- [x] Done section hidden by default, expandable
- [x] Empty sections collapsed by default
- [x] Checkbox click toggles task completion and moves to Done section
- [x] Click task text enables inline editing
- [x] "+" button adds new task to section via inline input
- [x] Delete button removes task from file
- [x] Drag-and-drop moves tasks between sections
- [x] Due dates parsed and highlighted (overdue=red, today=orange)
- [x] Person tags `[[Name]]` parsed and displayed as pills
- [x] File watcher detects external TASKS.md changes and refreshes UI
- [x] "Create TASKS.md" button shown when no file exists
- [x] `Ctrl+Shift+K` keyboard shortcut switches to Tasks tab
- [x] Multiple TASKS.md files: source file shown as subtle label per task

### Non-Functional Requirements

- [x] File write-back preserves non-task content (blank lines, paragraphs, H1 headings)
- [x] Concurrent edit safety: read-fresh-before-write, fuzzy match fallback
- [x] Atomic file writes (temp file + rename)
- [x] File watcher debounced at 300ms
- [x] No IPC flooding from rapid file changes
- [x] Tasks tab works for all project types (code, workspace, project)

### Quality Gates

- [ ] Unit tests for TaskService parsing and serialization
- [ ] Round-trip test: parse → modify → serialize → parse matches expected output
- [ ] Edge case tests: empty file, no sections, only completed tasks, nested items
- [ ] Section name alias mapping tests for all known variants

## Dependencies & Prerequisites

- No new npm dependencies required (native HTML5 DnD, existing fs watcher, regex parsing)
- Existing `fs:watchFile` / `fs:onFileChanged` infrastructure must work correctly
- `lucide-react` already includes `ListTodo`, `CheckSquare`, `Square`, `Calendar`, `User`, `GripVertical` icons

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| File corruption from concurrent edits | High | Read-fresh-before-write, line+text matching, atomic writes via temp file |
| Format destruction on write-back | High | Preserve non-task lines, comprehensive round-trip tests |
| File watcher missing changes | Medium | Debounce + manual refresh button as fallback |
| Large TASKS.md performance | Low | Unlikely for task files; add virtual scrolling later if needed |
| Section name mapping misses | Low | Start with common aliases, easy to extend keyword list |

## References

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-15-tasks-tab-brainstorm.md`
- Tab pattern: `src/components/FileExplorer/FileExplorerTabBar.tsx`
- Panel pattern: `src/components/FileExplorer/GitStatusPanel.tsx`
- IPC pattern: `docs/solutions/integration-issues/github-context-menu-integration.md`
- Security learnings: `docs/solutions/code-review/terminal-link-feature-review-fixes.md`
- Event handling learnings: `docs/solutions/logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md`
- File watcher: `electron/main/index.ts:487-518`
- Store pattern: `src/stores/projectStore.ts`

### Related Work

- Earlier brainstorm: `docs/brainstorms/2026-02-03-project-management-layer-brainstorm.md` (broader workspace vision)
- Git commit history plan: `docs/plans/2026-02-13-feat-git-commit-history-in-sidebar-plan.md` (similar 4-layer pattern)
