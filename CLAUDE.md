# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Run in development mode (Vite dev server + Electron)
npm run build        # Build for production (TypeScript + Vite + electron-builder)
npm run test         # Run Vitest tests
npm run rebuild      # Rebuild native modules (node-pty)
npm run release:patch  # Bump patch version, push with tags
npm run release:minor  # Bump minor version, push with tags
npm run release:major  # Bump major version, push with tags
```

## Workflow Orchestration

### 1. Plan Mode De fault

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

This is an **Electron + React + TypeScript** desktop app for managing multiple Claude Code sessions.

## Terminology

| Term | Meaning |
|------|---------|
| **Chat** | A Claude Code session (main center area) |
| **Terminal** | Plain shell in right sidebar for quick tasks (`npm install`, etc.) |
| **Worktree** | Git worktree for parallel feature development |

### Directory Structure

```
├── electron/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # App entry, window management, IPC handlers
│   │   └── services/
│   │       ├── TerminalManager.ts    # PTY spawning via node-pty
│   │       └── ProjectPersistence.ts # JSON file storage
│   └── preload/
│       └── index.ts       # Secure context bridge (window.electronAPI)
│
└── src/                   # React renderer
    ├── components/
    │   ├── Layout/        # MainLayout.tsx, TerminalArea.tsx
    │   ├── Sidebar/       # Project/worktree list
    │   └── Terminal/      # xterm.js component
    ├── stores/
    │   └── projectStore.ts  # Zustand state with persist
    ├── utils/
    │   ├── electron.ts      # API accessor
    │   └── terminalEvents.ts # Centralized IPC subscriptions
    └── types/
        └── index.ts       # TypeScript types, ElectronAPI interface
```

### Process Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (electron/main/)                              │
│  ├── index.ts         - App lifecycle, IPC handlers         │
│  └── services/                                              │
│      ├── TerminalManager.ts   - PTY spawning via node-pty   │
│      └── ProjectPersistence.ts - JSON file storage          │
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

### Data Flow

1. User adds project → `project:add` IPC → `ProjectPersistence` saves to `userData/projects.json`
2. User creates Chat → `terminal:create` IPC → `TerminalManager` spawns PTY → auto-runs `claude` command
3. Chat output → `terminal:data` event → `terminalEvents` routes to specific `Terminal` component → xterm.js renders

## Code Conventions

- Functional React components only
- TypeScript strict mode
- Tailwind CSS for styling
- Zustand for state (no Redux)
- IPC handlers validate inputs (UUID format, reasonable bounds for cols/rows)

## Windows Development

**node-pty requirement**: Requires Visual Studio Build Tools with "Desktop development with C++" workload for native compilation.

If node-pty fails to compile:

1. Install VS Build Tools from https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. Select "Desktop development with C++"
3. Run `npm run rebuild`

## File Paths

Always use complete absolute Windows paths with drive letters and backslashes for all file operations (workaround for a known bug).
