# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Run in development mode (Vite dev server + Electron)
npm run build        # Build for production (TypeScript + Vite + electron-builder)
npm run test         # Run Vitest tests
npm run test -- path/to/test.ts  # Run a single test file
npm run rebuild      # Rebuild native modules (node-pty)
npm run release:patch  # Bump patch version, push with tags
npm run release:minor  # Bump minor version, push with tags
npm run release:major  # Bump major version, push with tags
```

Tests require a pre-build step (`npm run pretest` runs automatically). E2E tests use Playwright's Electron API. Unit tests exist for `TerminalPool` and `projectStore` in `test/`.

## Workflow Guidelines

**Planning**: Enter plan mode for non-trivial tasks (3+ steps). If blocked, re-plan immediately.

**Execution**: Use subagents for research/exploration. Run tests and verify before marking done.

**Learning**: After corrections, document patterns in relevant todo files in `todos/` to prevent recurrence.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Architecture

This is an **Electron + React + TypeScript** desktop app for managing multiple Claude Code sessions. One window with a project sidebar, terminal area (center), file explorer (right), and optional sidecar shell panels.

## Terminology

| Term | Meaning |
|------|---------|
| **Chat** | A Claude Code terminal session (`type: 'claude'`), shown in the center area |
| **Terminal / Sidecar** | A plain shell (`type: 'normal'`) in a collapsible right-side panel for quick tasks |
| **Worktree** | Git worktree for parallel feature development; terminals can be scoped to a worktree |
| **Center Tab** | Either a terminal tab or an editor/diff tab in the main content area |

### Process Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (electron/main/)                              │
│  ├── index.ts         - App lifecycle, ALL IPC handlers     │
│  └── services/        - Business logic (see table below)    │
└─────────────────────────────────────────────────────────────┘
         ↕ IPC via contextBridge (secure, whitelist-based)
┌─────────────────────────────────────────────────────────────┐
│  Preload (electron/preload/index.ts)                        │
│  - Exposes window.electronAPI with typed terminal/project/  │
│    fs/git/automation/update operations                      │
└─────────────────────────────────────────────────────────────┘
         ↕
┌─────────────────────────────────────────────────────────────┐
│  Renderer (src/)                                            │
│  ├── stores/projectStore.ts  - Single Zustand store w/      │
│  │                             persist middleware            │
│  ├── hooks/                  - useHotkeys, useXtermInstance, │
│  │                             useTerminalPool, etc.         │
│  ├── utils/terminalEvents.ts - Centralized IPC dispatchers  │
│  └── components/             - React UI                     │
└─────────────────────────────────────────────────────────────┘
```

### Main Process Services (`electron/main/services/`)

| Service | Purpose |
|---------|---------|
| `TerminalManager.ts` | PTY spawning via node-pty, data routing, session resume, auto-naming |
| `ClaudeHookWatcher.ts` | Polls `~/.claude/command-center-state.json` every 250ms, maps session states to terminals via BiMap |
| `HookInstaller.ts` | Injects `claude-state-hook.cjs` into `~/.claude/settings.json` for 6 Claude Code events |
| `ProjectPersistence.ts` | JSON file storage in `userData/projects.json`, session persistence for resume |
| `WorktreeService.ts` | Git worktree CRUD (create, list, remove, has-changes) |
| `GitService.ts` | Git operations (status, fetch, pull, push, commit log/detail) |
| `GitHubService.ts` | GitHub PR status polling via `gh` CLI |
| `AutomationService.ts` | Cron-scheduled and event-triggered automations (max 3 concurrent) |
| `AutomationRunner.ts` | Executes automation runs in isolated worktrees |
| `AutomationPersistence.ts` | Stores automations and run history in `userData/automations.json` |
| `FileWatcherService.ts` | Chokidar-based file watching for file explorer and automation triggers |
| `TaskService.ts` | Scans project files for TODO/FIXME markers |
| `UpdateService.ts` | Auto-updates via electron-updater |

### Claude State Detection (Hook System)

This is the core mechanism that powers the attention indicator:

1. `HookInstaller` writes into `~/.claude/settings.json` to register `claude-state-hook.cjs` for events: `PreToolUse`, `Stop`, `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, `Notification`
2. When Claude Code fires an event, it executes the hook script which reads JSON from stdin
3. The hook maps events to states and writes atomically to `~/.claude/command-center-state.json`
4. `ClaudeHookWatcher` polls this file, matches sessions to terminals via a BiMap (session ID ↔ terminal ID), and emits `terminal:state` events
5. States: `busy` (blue), `permission` (orange), `question` (orange), `done` (green), `stopped` (red)

### Terminal Pool & LRU Eviction

xterm.js instances are expensive. `TerminalPool` (`src/utils/terminalPool.ts`) limits active instances (default 5, configurable 2-20):

- On terminal switch: `touch()` updates LRU order
- When over limit: evicts least-recently-used terminal (serializes scrollback, destroys xterm DOM)
- Protected from eviction: `busy`, `permission`, `question` states; active terminal; split-view terminals
- Eviction preference: `stopped` terminals first, then oldest by LRU
- Main process buffers PTY data for evicted terminals (1MB cap); replayed on restore

### Data Flow

1. User adds project → `project:add` IPC → `ProjectPersistence` saves to `userData/projects.json`
2. User creates Chat → `terminal:create` IPC → `TerminalManager` spawns PTY → auto-runs `claude` command (with `--resume <sessionId>` if resuming)
3. Chat output → `terminal:data` event → `TerminalEventManager` routes to specific `Terminal` component → xterm.js renders
4. Claude state changes → hook file → `ClaudeHookWatcher` → `terminal:state` event → UI shows attention indicator
5. On app close → `ClaudeHookWatcher.getTerminalSessions()` captures session IDs → persisted for resume on restart

### Key Patterns

- **IPC Communication**: All main↔renderer communication uses typed IPC via `window.electronAPI` (defined in `src/types/index.ts`). IPC channels are namespaced: `terminal:*`, `project:*`, `worktree:*`, `fs:*`, `git:*`, `github:*`, `automation:*`, `update:*`
- **State Management**: Single Zustand store (`projectStore.ts`) with persist middleware. Key limits: `MAX_TERMINALS_PER_PROJECT = 10`, `MAX_EDITOR_TABS = 15`
- **Center Tab System**: `activeCenterTabId` can point to either a terminal or an editor/diff tab. `removeTerminal` has a fallback chain (next terminal → last editor tab → null)
- **Event Dispatchers**: `terminalEvents.ts` and `fileWatcherEvents.ts` register IPC listeners ONCE globally, then dispatch to per-terminal/per-project callback maps. This prevents listener memory leaks.
- **Shell Selection**: `TerminalManager.getShell()` auto-detects Git Bash on Windows, falls back to PowerShell. Override with `COMMAND_CENTER_SHELL` env var
- **Input Validation**: UUID format validation on all IDs, path length bounds, cols/rows clamping

## Code Conventions

- Functional React components only
- TypeScript strict mode
- Tailwind CSS for styling (all colors via CSS variables for runtime theming)
- Zustand for state (no Redux)
- IPC handlers validate inputs (UUID format, reasonable bounds for cols/rows)
- **Hotkey Requirement**: All new user-facing features MUST include keyboard shortcuts. Add shortcuts to `src/utils/hotkeys.ts` (DEFAULT_HOTKEY_CONFIG with 42 actions), register handlers in `src/App.tsx`, and document in the Keyboard Shortcuts table below.

## Windows Development

**node-pty requirement**: Requires Visual Studio Build Tools with "Desktop development with C++" workload for native compilation.

If node-pty fails to compile:

1. Install VS Build Tools from https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. Select "Desktop development with C++"
3. Run `npm run rebuild`

## File Paths

Always use complete absolute Windows paths with drive letters and backslashes for all file operations (workaround for a known bug).

## Keyboard Shortcuts

All shortcuts are configurable via Settings (`Ctrl + ,`). Press `Ctrl + /` to view all shortcuts. The hotkey system supports recording custom bindings, conflict detection, and per-action enable/disable.

### Navigation
| Shortcut | Action |
|----------|--------|
| `Ctrl + ↑` | Previous project |
| `Ctrl + ↓` | Next project |
| `Ctrl + ←` | Previous terminal |
| `Ctrl + →` | Next terminal |
| `Ctrl + 1` | Focus sidebar |
| `Ctrl + 2` | Focus terminal |
| `Ctrl + 3` | Focus file explorer |

### Terminal
| Shortcut | Action |
|----------|--------|
| `Ctrl + T` | New terminal |
| `Ctrl + W` | Close terminal |
| `Ctrl + \` | Add to split view |
| `Ctrl + Shift + \` | Remove from split view |
| `Alt + 1-9` | Go to terminal 1-9 |

### File Explorer
| Shortcut | Action |
|----------|--------|
| `Ctrl + B` | Toggle file explorer |
| `Ctrl + Shift + E` | Switch to files tab |
| `Ctrl + Shift + G` | Switch to git tab |
| `Ctrl + Shift + K` | Switch to tasks tab |
| `Ctrl + Shift + A` | Switch to automations tab |
| `Ctrl + Alt + N` | New file |
| `Ctrl + Alt + Shift + N` | New folder |
| `F2` | Rename selected |
| `Delete` | Delete selected |
| `Ctrl + Shift + C` | Copy file path |

### Editor
| Shortcut | Action |
|----------|--------|
| `Ctrl + Shift + W` | Close editor tab |
| `Ctrl + Tab` | Next editor tab |
| `Ctrl + Shift + Tab` | Previous editor tab |
| `Ctrl + S` | Save file |

### Worktree
| Shortcut | Action |
|----------|--------|
| `Ctrl + Shift + N` | Create worktree |

### Sidebar
| Shortcut | Action |
|----------|--------|
| `Ctrl + Shift + I` | Toggle inactive projects section |

### UI & Settings
| Shortcut | Action |
|----------|--------|
| `Ctrl + ,` | Open settings |
| `Ctrl + Shift + T` | Toggle theme |
| `Ctrl + /` | Show shortcuts |

### Dialogs
| Shortcut | Action |
|----------|--------|
| `Escape` | Close dialog |
| `Enter` | Confirm dialog |
