# Agent-Native Reactivity

**Date:** 2026-02-16
**Status:** Brainstorm
**Phase:** 1 of 2 (Reactivity → Parity)

## What We're Building

Make Command Center's UI reactive to filesystem changes so that when Claude Code (or any agent) creates files, modifies code, or adds worktrees, the UI reflects this immediately without manual refresh.

This is the first step toward making the app truly agent-native. The second phase (parity - agent can control the app) comes later.

## Why This Matters

Command Center manages Claude Code sessions, but currently the UI is **deaf** to what the agent does:

- Claude creates files → file explorer doesn't update
- Claude adds a worktree → sidebar doesn't show it
- Claude modifies a file open in editor → editor shows stale content
- Claude changes git state → git status panel is outdated

For an app built around AI agents, this is a fundamental gap. The UI should feel like it's part of the same workspace the agent operates in.

## Framing: Agent-Native Principles

Per the Agent-Native Architecture guide, we're addressing **reactivity** — the UI's ability to observe and respond to agent actions on the filesystem. This is prerequisite to **parity** (agent controlling the app) because reactive UI means the app already understands what's happening.

| Principle | How This Applies |
|-----------|-----------------|
| Parity | Phase 2 - not in scope yet |
| Granularity | Events are atomic (`file:created`, `file:changed`, not `refresh-everything`) |
| Composability | Each UI consumer subscribes to events it cares about |
| Emergent Capability | Reactive UI enables future features we haven't thought of yet |

## Chosen Approach: Centralized FileWatcher Service

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  FileWatcherService (electron/main/services/)               │
│  - One chokidar watcher per project                         │
│  - Emits granular events via IPC                            │
│  - Debounces rapid changes                                  │
│  - Ignores node_modules, .git, build output                 │
└────────────────────────┬────────────────────────────────────┘
                         │ IPC events
         ┌───────────────┼───────────────────────┐
         ▼               ▼                       ▼
┌──────────────┐ ┌──────────────┐ ┌────────────────────────┐
│ File Explorer│ │ Git Status   │ │ Editor Tabs            │
│ - tree       │ │ - changed    │ │ - reload on external   │
│   refresh on │ │   files list │ │   change (with dirty   │
│   add/delete │ │ - refresh on │ │   check)               │
│              │ │   any change │ │                        │
└──────────────┘ └──────────────┘ └────────────────────────┘
         ┌───────────────┼───────────────────────┐
         ▼               ▼                       ▼
┌──────────────┐ ┌──────────────┐ ┌────────────────────────┐
│ Worktree     │ │ Tasks Tab    │ │ Future consumers       │
│ Sidebar      │ │ - TASKS.md   │ │ - search index         │
│ - detect new │ │   live       │ │ - file previews        │
│   worktrees  │ │   reload     │ │ - etc.                 │
└──────────────┘ └──────────────┘ └────────────────────────┘
```

### Technology Choice: chokidar

- Proven library with good Windows support
- Built-in recursive watching and ignore patterns
- Debouncing and ready-state detection
- Standard in Electron apps (used by VS Code's predecessor)

### Event Design

Granular IPC events from main → renderer:

```typescript
// Main process emits
'fs:watch:file-added'    → { projectId, path, isDirectory: false }
'fs:watch:file-changed'  → { projectId, path }
'fs:watch:file-removed'  → { projectId, path }
'fs:watch:dir-added'     → { projectId, path, isDirectory: true }
'fs:watch:dir-removed'   → { projectId, path }
'fs:watch:ready'         → { projectId }
'fs:watch:error'         → { projectId, error }
```

### Consumer Behavior

| Consumer | Reacts to | Action |
|----------|-----------|--------|
| File Explorer | `file-added`, `file-removed`, `dir-added`, `dir-removed` | Invalidate affected directory cache, re-render tree |
| Git Status | `file-changed`, `file-added`, `file-removed` | Debounced re-run of `git status` (500ms) |
| Editor Tabs | `file-changed` | Reload file content if not dirty; show "file changed externally" if dirty |
| Worktree Sidebar | `dir-added` in project root | Check if new dir is a worktree, add to list |
| Tasks Tab | `file-changed` where filename matches `TASKS.md` | Reload tasks |

### Ignore Patterns

```
node_modules/
.git/
dist/
build/
*.log
.DS_Store
Thumbs.db
```

### Resource Management

- Watcher starts when project is active (selected/has open terminals)
- Watcher stops when project is removed or app closes
- Debounce rapid events (100ms batch window)
- Max one watcher per project root

## Key Decisions

1. **chokidar over native fs.watch** — reliability on Windows, recursive support, ignore patterns
2. **Granular events over full refresh** — each consumer refreshes only what it needs
3. **Centralized service** — one watcher per project, not per component
4. **All consumers in scope** — file explorer, git, editor, worktrees, tasks
5. **Reactivity before parity** — make UI responsive first, agent control comes in phase 2

## Resolved Questions

1. **Worktree detection**: Run `git worktree list` when a `dir-added` event fires in the project root. No need to watch parent directory.
2. **Large projects**: Trust chokidar with good ignore patterns. No fallback to polling needed.
3. **Editor dirty state**: Implement auto-save (save on every change with short debounce) so dirty state rarely occurs. If an external change arrives while there are unsaved edits, silently preserve the user's version.

## Open Questions

None remaining.

## Out of Scope (Phase 2: Parity)

- Agent can create terminals/chats via MCP tools or file interface
- Agent can open files in the editor
- Agent can trigger UI actions (switch project, create worktree via app)
- App exposes MCP server for agent control
