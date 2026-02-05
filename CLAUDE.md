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

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy to keep main context window clean

- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop

- After ANY correction from the user: update 'tasks/lessons.md' with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -> then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to 'tasks/todo.md' with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review to 'tasks/todo.md'
6. **Capture Lessons**: Update 'tasks/lessons.md' after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Architecture

This is an **Electron + React + TypeScript** desktop app for managing multiple Claude Code terminal instances.

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
- **Claude State Detection**: `ClaudeHookWatcher` monitors hook files to detect 5 states: `busy`, `permission`, `question`, `done`, `stopped`

### Data Flow

1. User adds project → `project:add` IPC → `ProjectPersistence` saves to `userData/projects.json`
2. User creates terminal → `terminal:create` IPC → `TerminalManager` spawns PTY → auto-runs `claude` command
3. Terminal output → `terminal:data` event → `terminalEvents` routes to specific `Terminal` component → xterm.js renders
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
