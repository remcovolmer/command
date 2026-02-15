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

## Workflow Guidelines

**Planning**: Enter plan mode for non-trivial tasks (3+ steps). If blocked, re-plan immediately.

**Execution**: Use subagents for research/exploration. Run tests and verify before marking done.

**Learning**: After corrections, document patterns in `tasks/lessons.md` to prevent recurrence.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Architecture

This is an **Electron + React + TypeScript** desktop app for managing multiple Claude Code sessions.

## Terminology

| Term | Meaning |
|------|---------|
| **Chat** | A Claude Code session (main center area) |
| **Terminal** | Plain shell in right sidebar for quick tasks (`npm install`, etc.) |
| **Worktree** | Git worktree for parallel feature development |

### Main Process Services (`electron/main/services/`)

| Service | Purpose |
|---------|---------|
| `TerminalManager.ts` | PTY spawning via node-pty, terminal state management |
| `ClaudeHookWatcher.ts` | Watches Claude Code hooks to detect state changes (busy/permission/question/done) |
| `HookInstaller.ts` | Installs Claude Code hooks for state detection |
| `ProjectPersistence.ts` | JSON file storage in `userData/projects.json` |
| `WorktreeService.ts` | Git worktree management (create, list, remove) |
| `GitService.ts` | Git operations (status, fetch, pull, push) |
| `GitHubService.ts` | GitHub PR status polling via `gh` CLI |
| `UpdateService.ts` | Auto-updates via electron-updater |

### Process Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (electron/main/)                              │
│  ├── index.ts         - App lifecycle, IPC handlers         │
│  └── services/        - See table above                     │
└─────────────────────────────────────────────────────────────┘
         ↕ IPC via contextBridge (secure)
┌─────────────────────────────────────────────────────────────┐
│  Preload (electron/preload/index.ts)                        │
│  - Exposes window.electronAPI with terminal/project/app ops │
│  - Whitelist-based channel security                         │
└─────────────────────────────────────────────────────────────┘
         ↕
┌─────────────────────────────────────────────────────────────┐
│  Renderer (src/)                                            │
│  ├── stores/projectStore.ts  - Zustand with persist         │
│  ├── utils/terminalEvents.ts - Centralized IPC subscriptions│
│  └── components/Terminal/    - xterm.js integration         │
└─────────────────────────────────────────────────────────────┘
```

### Key Patterns

- **IPC Communication**: All main↔renderer communication uses typed IPC via `window.electronAPI` (defined in `src/types/index.ts`)
- **State Management**: Zustand store (`projectStore.ts`) persists layouts; terminals recreated on startup
- **Terminal Events**: Centralized subscription manager in `terminalEvents.ts` prevents listener leaks
- **Shell Selection**: `TerminalManager.getShell()` auto-detects Git Bash on Windows, falls back to PowerShell. Override with `COMMAND_CENTER_SHELL` env var
- **Claude State Detection**: `ClaudeHookWatcher` monitors hook files to detect 5 states:
  - `busy` (blue) - Claude is working
  - `permission` (orange) - Needs tool/command permission
  - `question` (orange) - Asked a question via AskUserQuestion
  - `done` (green) - Finished, awaiting new prompt
  - `stopped` (red) - Terminal stopped or error

### Data Flow

1. User adds project → `project:add` IPC → `ProjectPersistence` saves to `userData/projects.json`
2. User creates Chat → `terminal:create` IPC → `TerminalManager` spawns PTY → auto-runs `claude` command
3. Chat output → `terminal:data` event → `terminalEvents` routes to specific `Terminal` component → xterm.js renders
4. Claude state changes → `ClaudeHookWatcher` detects hook file updates → `terminal:state` event → UI shows attention indicator

## Code Conventions

- Functional React components only
- TypeScript strict mode
- Tailwind CSS for styling
- Zustand for state (no Redux)
- IPC handlers validate inputs (UUID format, reasonable bounds for cols/rows)
- **Hotkey Requirement**: All new user-facing features MUST include keyboard shortcuts. Add shortcuts to `src/utils/hotkeys.ts` (DEFAULT_HOTKEY_CONFIG), register handlers in `src/App.tsx`, and document in the Keyboard Shortcuts table below.

## Windows Development

**node-pty requirement**: Requires Visual Studio Build Tools with "Desktop development with C++" workload for native compilation.

If node-pty fails to compile:

1. Install VS Build Tools from https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. Select "Desktop development with C++"
3. Run `npm run rebuild`

## File Paths

Always use complete absolute Windows paths with drive letters and backslashes for all file operations (workaround for a known bug).

## Keyboard Shortcuts

All shortcuts are configurable via Settings (`Ctrl + ,`). Press `Ctrl + /` to view all shortcuts.

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
