---
date: 2026-02-15
topic: tasks-tab
related: 2026-02-03-project-management-layer-brainstorm.md
---

# Tasks Tab in Right Sidebar

## What We're Building

A **Tasks tab** in the right sidebar (alongside Files and Git) that displays todos parsed from `TASKS.md` files in the project root and all subfolders. Tasks are grouped by section (Now, Next, Waiting, Later, Done) with inline editing, drag-and-drop between sections, and live file watching.

This is the first concrete step toward the broader workspace dashboard vision from the earlier brainstorm, focused specifically on task visibility within code projects.

## Why This Approach

- **TASKS.md is already the source of truth** - maintained by `/productivity`, used in Obsidian, plain markdown
- **Right sidebar is the natural home** - follows established Files/Git tab pattern, no new UI paradigm needed
- **Inline editing keeps flow** - no context switch to edit tasks, changes write back to TASKS.md
- **File watching enables external tool interop** - `/productivity` or Obsidian can update TASKS.md and the UI reflects changes immediately

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Display grouping | By section (Now/Next/Waiting/Later/Done) | Merges all TASKS.md files, sections are the natural priority grouping |
| Done tasks | Hidden by default, collapsible | Reduces noise, focus on actionable items |
| Editing model | Inline editing | Click to edit text, checkbox to complete, add button per section |
| Reprioritization | Drag between sections | Intuitive, updates TASKS.md on drop |
| File sync | File system watcher | Auto-refresh on external changes (from /productivity, Obsidian, etc.) |
| Format parsing | Flexible | Handle H2/H3 sections, bold/non-bold text, nested items, varied section names |
| Tab badge | Count of "Now" tasks | Quick visibility of urgent items |
| Due dates | Parse and highlight | Overdue = red, due today = orange, parsed from emoji date format |
| Person tags | Parse [[Name]] syntax | Show as tags, enable filtering by person |

## Feature Specification

### TASKS.md Parsing

**Supported format:**
```markdown
# Tasks (or any H1)

## Now (or similar: Current, Active, In Progress)
- [ ] **Task description** optional extra text
- [ ] Task without bold also works
- [x] Completed task in active section

## Next (or: Up Next, Soon, Planned)
- [ ] Task with due date text here 2026-02-20
- [ ] Task mentioning [[Person Name]]

## Waiting (or: Blocked, On Hold)
- [ ] [[Someone]]: What they're doing

## Later (or: Someday, Backlog, Ideas)

## Done (or: Completed, Finished)
- [x] Completed task with date 2026-02-13
```

**Parsing rules:**
- H2 headings define sections, mapped to priority buckets by keyword matching
- Checkbox syntax: `- [ ]` (open), `- [x]` (completed)
- Bold text (`**...**`) treated as task title, rest as description
- Due dates: emoji calendar followed by date (`YYYY-MM-DD`)
- Person tags: `[[Name]]` syntax extracted as tags
- Nested items (indented) treated as subtasks or notes

### Task Panel UI

```
┌──────────────────────────────────┐
| [Files] [Git] [Tasks (3)]       |  <- Badge shows Now count
├──────────────────────────────────┤
| [Search/filter...]          [+]  |  <- Not in v1 (filter deferred)
├──────────────────────────────────┤
| NOW                          (2) |  <- Section header, collapsible
| ┌──────────────────────────────┐ |
| | [ ] Data validatie uitvoer.. | |  <- Checkbox + truncated text
| |     due: Feb 20  from: root  | |  <- Due date + source file
| | [ ] LexNieuwsbrieven bugs.. | |
| |     due: Feb 17  overdue!    | |  <- Red highlight if overdue
| └──────────────────────────────┘ |
├──────────────────────────────────┤
| NEXT                         (8) |
| ┌──────────────────────────────┐ |
| | [ ] Acceptatiecriteria bep..| |
| | [ ] BPNR ophalen via data..  | |
| | ...                          | |
| └──────────────────────────────┘ |
├──────────────────────────────────┤
| WAITING                      (6) |
| ┌──────────────────────────────┐ |
| | [ ] Jurjan Mol: Planning..   | |  <- Person tag extracted
| | [ ] Dirk Steyn: Uitzoeken.. | |
| └──────────────────────────────┘ |
├──────────────────────────────────┤
| LATER                        (0) |  <- Collapsed if empty
├──────────────────────────────────┤
| DONE                      [show] |  <- Hidden by default
└──────────────────────────────────┘
```

### Interactions

| Action | Trigger | Effect |
|--------|---------|--------|
| Complete task | Click checkbox | Toggle `- [ ]` / `- [x]`, move to Done section in file |
| Edit task | Click task text | Inline text input, save on blur/Enter, cancel on Escape |
| Add task | "+" button per section header | New inline input at top of section |
| Delete task | Right-click > Delete (or icon) | Remove line from TASKS.md |
| Move section | Drag task to different section | Update position in TASKS.md |
| View details | Hover or expand | Show full text, due date, source file, person tags |

### File System Integration

- **Discovery**: On project load, scan for `TASKS.md` (case-insensitive) in root and all subdirectories
- **Watching**: Use `fs.watch` or chokidar to monitor discovered TASKS.md files
- **Write-back**: All edits write back to the source TASKS.md file, preserving formatting
- **Multi-file**: Tasks from multiple files merged, source file shown as subtle label
- **Debounce**: Watcher debounced to handle rapid external edits (e.g., /productivity batch updates)

### IPC API

New IPC channels needed:
- `tasks:scan` - Scan project for TASKS.md files, return parsed tasks
- `tasks:watch` - Start watching TASKS.md files for changes
- `tasks:unwatch` - Stop watching
- `tasks:update` - Update a specific task (toggle, edit text, move section)
- `tasks:add` - Add new task to specific section/file
- `tasks:delete` - Remove a task
- `tasks:changed` - Event: tasks changed externally

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + Shift + K` | Switch to tasks tab |

## Scope Boundaries

### In scope (v1)
- Tasks tab with section-grouped view
- Inline editing (complete, rename, add, delete)
- Drag between sections
- File watching with auto-refresh
- Tab badge (Now count)
- Due date parsing and highlighting
- Person tag parsing and display

### Deferred (v2+)
- Filter/search bar
- Filter by person tag
- Subtask support (nested checkboxes)
- Task creation from terminal output
- Cross-project task aggregation (workspace dashboard)
- Task templates

## Resolved Questions

1. **Section name mapping**: Unknown H2 headings are shown as custom collapsible sections, placed after the known ones (Now/Next/Waiting/Later/Done). This means any TASKS.md structure works.
2. **Completed task placement**: Checking a task moves it from its current section to the Done section in TASKS.md. Clean separation of active vs completed work.
3. **Empty TASKS.md**: Show a "Create TASKS.md" button that generates a template file with Now/Next/Waiting/Later/Done sections. Low friction to get started.
