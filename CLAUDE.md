# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Run in development mode (Vite dev server + Electron)
npm run build        # Build for production (TypeScript + Vite + electron-builder)
npm run test         # Run Vitest tests
npm run rebuild      # Rebuild native modules (node-pty)
```

## Architecture

This is an **Electron + React + TypeScript** desktop app for managing multiple Claude Code terminal instances.

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
    │   ├── Sidebar/       # Project/terminal list
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
2. User creates terminal → `terminal:create` IPC → `TerminalManager` spawns PTY → auto-runs `claude` command
3. Terminal output → `terminal:data` event → `terminalEvents` routes to specific `Terminal` component → xterm.js renders

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
