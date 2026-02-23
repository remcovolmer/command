---
title: "feat: Add automations system for scheduled and event-driven Claude Code tasks"
type: feat
status: completed
date: 2026-02-23
origin: docs/brainstorms/2026-02-23-automations-brainstorm.md
---

# feat: Add Automations System

## Overview

Add an automations system to Command that lets users define recurring or event-driven Claude Code tasks that run unattended. Each automation spawns `claude -p` in an isolated worktree, with results landing in a triage inbox for review.

Inspired by OpenAI Codex automations (see brainstorm: `docs/brainstorms/2026-02-23-automations-brainstorm.md`).

## Problem Statement / Motivation

Users currently must manually start every Claude Code session. Repetitive tasks — dependency audits, CI failure triage, code review, release notes — require the user to be present. There's no way to set up "run this prompt every morning" or "when a PR merges, generate release notes."

## Proposed Solution

A three-layer architecture:

1. **AutomationService** (main process) — CRUD, scheduling via `croner`, event trigger matching, run orchestration
2. **IPC layer** — typed channels following existing `service:kebab-case-action` convention
3. **UI layer** — new "Automations" tab in FileExplorer with create/edit dialog and triage inbox

Each automation run: creates worktree → spawns `claude -p` as child process → captures JSON output → stores result → cleans up worktree.

## Technical Approach

### Architecture

```
electron/main/services/
├── AutomationService.ts      — Orchestration, CRUD, scheduling, triggers
├── AutomationRunner.ts        — claude -p execution, output capture, timeout
└── AutomationPersistence.ts   — JSON storage for configs + run history

src/components/FileExplorer/
├── AutomationsPanel.tsx       — Main panel (automation list + triage inbox)
├── AutomationCreateDialog.tsx — Create/edit dialog
└── AutomationRunDetail.tsx    — Expanded run result view

src/utils/
└── automationEvents.ts        — Centralized IPC event subscriptions (follows terminalEvents.ts pattern)
```

### Data Model

```typescript
// src/types/index.ts — new types

interface Automation {
  id: string                          // UUID
  name: string                        // User-friendly name (max 100 chars)
  prompt: string                      // Claude Code instructions (max 50,000 chars)
  projectIds: string[]                // One or more project IDs
  trigger: AutomationTrigger
  enabled: boolean
  baseBranch?: string                 // Branch to create worktree from (default: project's default branch)
  timeoutMinutes: number              // Max execution time (default: 30)
  createdAt: string                   // ISO 8601
  updatedAt: string
  lastRunAt?: string                  // For missed-run detection
}

type AutomationTrigger =
  | { type: 'schedule'; cron: string }
  | { type: 'claude-done'; projectId?: string }
  | { type: 'git-event'; event: 'pr-merged' | 'pr-opened' | 'checks-passed' }
  | { type: 'file-change'; patterns: string[]; cooldownSeconds: number }  // default cooldown: 60s

interface AutomationRun {
  id: string                          // UUID
  automationId: string
  projectId: string                   // Which project this run targeted
  status: AutomationRunStatus
  startedAt: string
  completedAt?: string
  result?: string                     // Claude's text response
  sessionId?: string                  // Claude session ID (for --resume)
  exitCode?: number                   // 0 = success, 1 = error
  durationMs?: number
  error?: string                      // Error message if failed
  read: boolean                       // For triage inbox unread/read state
  worktreeBranch?: string             // If worktree still exists
}

type AutomationRunStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'
```

### Persistence

**Separate from ProjectPersistence** (own JSON files in `userData/`):

- `userData/automations.json` — automation configs with version migration
- `userData/automation-runs.json` — run history (max 50 per automation, auto-prune oldest)

Follows the same atomic-write pattern as `ProjectPersistence` (write to `.tmp`, rename).

`AutomationPersistence.ts`:
```typescript
interface AutomationState {
  version: number        // STATE_VERSION = 1
  automations: Automation[]
}

interface AutomationRunState {
  version: number        // STATE_VERSION = 1
  runs: AutomationRun[]  // Capped at MAX_RUNS_PER_AUTOMATION * automation count
}
```

### IPC Channels

Following existing pattern (3-file update: `index.ts`, `preload/index.ts`, `src/types/index.ts`):

**Request/response (`ipcMain.handle`):**

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `automation:list` | renderer → main | List all automations |
| `automation:create` | renderer → main | Create new automation |
| `automation:update` | renderer → main | Update automation config |
| `automation:delete` | renderer → main | Delete automation (stops if running) |
| `automation:toggle` | renderer → main | Enable/disable automation |
| `automation:trigger` | renderer → main | Manually trigger a run |
| `automation:stop-run` | renderer → main | Stop a running automation |
| `automation:list-runs` | renderer → main | List runs (with pagination) |
| `automation:mark-read` | renderer → main | Mark run as read |
| `automation:delete-run` | renderer → main | Delete a run result |

**Events (`BrowserWindow.webContents.send`):**

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `automation:run-started` | main → renderer | Run started (show in triage) |
| `automation:run-completed` | main → renderer | Run finished (update triage) |
| `automation:run-failed` | main → renderer | Run failed (update triage) |

Add event channels to `ALLOWED_LISTENER_CHANNELS` in preload.

### Implementation Phases

#### Phase 1: Foundation — Data & Execution (Backend)

**Goal:** Automation configs can be created/stored, and `claude -p` can be spawned in a worktree.

**Files to create:**

1. `electron/main/services/AutomationPersistence.ts`
   - CRUD for automation configs
   - CRUD for automation runs
   - Atomic write pattern (`.tmp` → rename)
   - Version migration
   - Auto-prune: max 50 runs per automation

2. `electron/main/services/AutomationRunner.ts`
   - `runAutomation(automation, projectPath): Promise<AutomationRun>`
   - Creates worktree via `WorktreeService.createWorktree()`
   - Branch naming: `auto-{automationName}-{timestamp}` (kebab-case, max 50 chars)
   - Spawns `claude -p` via `child_process.spawn`:
     ```
     claude -p "<prompt>" --output-format json --dangerously-skip-permissions
     ```
   - Captures stdout JSON, parses `{ result, session_id }`
   - Timeout via `setTimeout` + process kill (default 30 min)
   - Windows process tree kill: `taskkill /pid ${pid} /T /F`
   - AbortController support for user-initiated stops
   - Worktree cleanup after run (remove if no changes, keep branch name in run if changes exist)
   - Output size limit: 10MB stdout buffer

3. `electron/main/services/AutomationService.ts`
   - Holds references to `AutomationPersistence`, `AutomationRunner`, `WorktreeService`
   - `BrowserWindow` reference for `sendToRenderer()`
   - CRUD methods that delegate to persistence + update schedulers
   - Active run tracking: `Map<string, { process: ChildProcess, controller: AbortController }>`
   - Concurrency: max 3 simultaneous runs globally, skip if same automation already running
   - `destroy()` for cleanup (kill all running processes, wait 500ms for Windows handle release)

**Files to modify:**

4. `electron/main/index.ts`
   - Import and instantiate `AutomationService` in `createWindow()`
   - Register all `automation:*` IPC handlers
   - Add `automationService?.destroy()` to `before-quit` handler (before fileWatcherService cleanup)
   - Add to close confirmation: warn if automations are running

5. `src/types/index.ts`
   - Add `Automation`, `AutomationTrigger`, `AutomationRun`, `AutomationRunStatus` types
   - Extend `ElectronAPI` with `automation` namespace

6. `electron/preload/index.ts`
   - Add `automation` methods to `contextBridge.exposeInMainWorld`
   - Add event channels to `ALLOWED_LISTENER_CHANNELS`

**Acceptance criteria:**
- [x] `AutomationPersistence` can CRUD automations and runs to `userData/automations.json`
- [x] `AutomationRunner` can spawn `claude -p` in a worktree and capture JSON output
- [x] `AutomationRunner` handles timeout, abort, and process cleanup
- [x] IPC channels registered and typed
- [x] App startup initializes AutomationService
- [x] App shutdown kills running automations gracefully

#### Phase 2: Scheduling — Cron Triggers

**Goal:** Schedule-based automations fire at configured times.

**New dependency:**

```bash
npm install croner
```

Zero dependencies, native TypeScript, `nextRun()` for UI display.

**Files to modify:**

1. `electron/main/services/AutomationService.ts`
   - Add `schedulerMap: Map<string, Cron>` for active cron instances
   - `startScheduler(automation)`: creates `Cron` instance that calls `runAutomation()`
   - `stopScheduler(automationId)`: calls `cron.stop()`
   - On app startup: start schedulers for all enabled schedule-based automations
   - On enable/disable: start/stop scheduler
   - On edit: stop old scheduler, start new one if still schedule-type

2. `electron/main/index.ts`
   - Add `app.commandLine.appendSwitch('disable-background-timer-throttling')` before `app.whenReady()` — prevents Chromium from throttling timers when window is minimized
   - Add `powerMonitor` listeners:
     - `suspend`: record timestamp
     - `resume`: call `automationService.checkMissedRuns()`

3. `electron/main/services/AutomationService.ts` (missed-run detection)
   - `checkMissedRuns()`: for each enabled schedule automation, compare `lastRunAt` with `croner.nextRun()`. If a run was missed within the last 24 hours, fire once.
   - Called on: app startup (after schedulers init) + `powerMonitor.resume`

**Acceptance criteria:**
- [x] Cron automations fire at scheduled times
- [x] Timers survive window minimize (background timer throttling disabled)
- [x] Missed runs detected on app startup and wake-from-sleep
- [x] Missed run policy: run-once (most recent missed only, max 24h age)
- [x] Enable/disable correctly starts/stops schedulers

#### Phase 3: Event Triggers

**Goal:** Automations can trigger on Claude done, Git events, and file changes.

**Files to modify:**

1. `electron/main/services/ClaudeHookWatcher.ts`
   - Extend with `EventEmitter`:
     ```typescript
     export class ClaudeHookWatcher extends EventEmitter { ... }
     ```
   - In `processStateForTerminal()`: emit `'state-change'` event with `{ terminalId, state, hookEvent }`
   - AutomationService subscribes to `hookWatcher.on('state-change', ...)`
   - Trigger condition: `state === 'done'`

2. `electron/main/services/GitHubService.ts`
   - Extend with `EventEmitter`
   - In `pollOnce()`: detect state transitions (OPEN→MERGED, checks failed→passed, review pending→approved)
   - Emit `'pr-event'` with `{ projectPath, event: 'pr-merged' | 'checks-passed' | ... }`
   - AutomationService subscribes to `githubService.on('pr-event', ...)`

3. `electron/main/services/FileWatcherService.ts`
   - Add callback registration: `onChanges(callback: (changes: FileChange[]) => void): Unsubscribe`
   - AutomationService registers callback, matches file change paths against automation `patterns` globs
   - **Limitation**: only watches active project. Automations for inactive projects won't trigger on file changes. Document this.

4. `electron/main/services/AutomationService.ts`
   - `registerEventTriggers()`: subscribe to all three services
   - Match incoming events against enabled automations' trigger configs
   - Cooldown/debounce: file-change triggers have configurable `cooldownSeconds` (default 60s). Track `lastTriggeredAt` per automation, skip if within cooldown.

**Acceptance criteria:**
- [x] Claude "done" state triggers matching automations
- [x] PR merged / checks passed triggers matching automations
- [x] File change triggers with glob matching and cooldown
- [x] Event triggers respect enabled/disabled state
- [x] No duplicate triggers within cooldown window

#### Phase 4: UI — Automations Tab & Triage Inbox

**Goal:** Users can create, manage, and review automations through the UI.

**Files to create:**

1. `src/components/FileExplorer/AutomationsPanel.tsx`
   - Two sections: **Automations** (list) and **Triage Inbox** (run results)
   - Automation list: name, trigger summary, enabled toggle, next run time (for cron), project badges
   - "New Automation" button (+ icon)
   - Triage inbox: list of runs, newest first, unread highlighted
   - Each run entry: automation name, project, time, status badge, summary preview
   - Click run → expand to `AutomationRunDetail`
   - Filter: All / Unread
   - Empty state: "No automations yet. Create one to get started."

2. `src/components/FileExplorer/AutomationCreateDialog.tsx`
   - Follows `CreateWorktreeDialog.tsx` pattern (backdrop, header/content/footer, `useDialogHotkeys`)
   - Fields:
     - Name (text input, required, max 100 chars)
     - Prompt (textarea, required, max 50,000 chars)
     - Project selector (multi-select checkboxes from project list, at least one required)
     - Trigger type (radio: Schedule / Claude Done / Git Event / File Change)
     - Type-specific config:
       - Schedule: cron expression input with human-readable preview (using `croner.nextRuns(3)`)
       - Claude Done: optional project filter dropdown
       - Git Event: event type select (PR Merged / Checks Passed)
       - File Change: glob patterns input + cooldown seconds
     - Timeout (number input, default 30 minutes)
   - Validation: name required, prompt required, valid cron expression (if schedule), at least one project

3. `src/components/FileExplorer/AutomationRunDetail.tsx`
   - Expanded view of a single run result
   - Shows: full output text (scrollable, monospace), duration, exit code, error if failed
   - Actions: Mark as read, Delete, Open worktree (if changes exist)

**Files to modify:**

4. `src/types/index.ts` (or `src/types/hotkeys.ts`)
   - Add `'automations'` to `FileExplorerTab` type union
   - Add hotkey actions: `'fileExplorer.automationsTab'`, `'automations.create'`

5. `src/components/FileExplorer/FileExplorerTabBar.tsx`
   - Add automations tab: `{ id: 'automations', label: 'Auto', icon: Zap, badge: unreadRunCount }`

6. `src/components/FileExplorer/FileExplorer.tsx`
   - Add routing for `automations` tab → `<AutomationsPanel />`

7. `src/stores/projectStore.ts`
   - Add `fileExplorerActiveTab` type update to include `'automations'`

8. `src/utils/hotkeys.ts` — `DEFAULT_HOTKEY_CONFIG`
   - `'fileExplorer.automationsTab'`: `{ key: 'a', modifiers: ['ctrl', 'shift'], description: 'Switch to automations tab', category: 'fileExplorer' }`
   - `'automations.create'`: `{ key: 'n', modifiers: ['ctrl', 'shift', 'alt'], description: 'New automation', category: 'fileExplorer' }` (if there's a free slot, otherwise pick available combo)

9. `src/App.tsx`
   - Register hotkey handlers for automation tab switch and create dialog

10. `src/utils/automationEvents.ts` (new)
    - Centralized event subscription manager following `terminalEvents.ts` pattern
    - Subscribes to `automation:run-started`, `automation:run-completed`, `automation:run-failed`
    - Dispatches to `AutomationsPanel` component

**Acceptance criteria:**
- [x] Automations tab visible in FileExplorer with badge for unread runs
- [x] Create dialog validates all inputs and saves automation
- [x] Edit existing automation (re-open dialog with pre-filled values)
- [x] Delete automation with confirmation
- [x] Enable/disable toggle works inline
- [x] Triage inbox shows run results with status badges
- [x] Run detail view shows full output
- [x] Manual trigger button ("Run now") on each automation
- [x] Stop button on running automations
- [x] Hotkey `Ctrl+Shift+A` switches to automations tab
- [x] All UI follows existing Tailwind/dialog/component patterns

#### Phase 5: Integration & Polish

**Goal:** Robust lifecycle management, error recovery, cleanup.

**Files to modify:**

1. `electron/main/services/AutomationService.ts`
   - Worktree garbage collection: on startup, scan for `auto-*` branches older than 24h, remove
   - Cascade on project delete: disable automations targeting deleted project. If automation has no remaining projectIds, disable entirely.
   - Persist running state on shutdown: mark running automations as `failed` with error "App closed during execution"

2. `electron/main/index.ts`
   - `project:remove` handler: call `automationService.onProjectDeleted(projectId)`
   - Close confirmation: include running automation count in message

3. `src/components/FileExplorer/AutomationsPanel.tsx`
   - Show "next run" time for schedule automations (from `croner.nextRun()`)
   - Show "running" indicator with elapsed time for active runs
   - Auto-refresh when runs complete (via IPC events)

**Acceptance criteria:**
- [x] Orphaned worktrees cleaned up on startup
- [x] Project deletion cascades to automations
- [x] App close warns about running automations
- [x] Running automations marked as failed on unexpected shutdown
- [x] Next run time displayed for cron automations

## System-Wide Impact

### Interaction Graph

1. User creates automation → `automation:create` IPC → `AutomationService.create()` → `AutomationPersistence.addAutomation()` → if schedule: `Cron` instance created → if event: trigger listener registered
2. Cron fires / Event matched → `AutomationRunner.runAutomation()` → `WorktreeService.createWorktree()` → `child_process.spawn('claude', ['-p', ...])` → stdout collected → JSON parsed → `AutomationPersistence.addRun()` → `sendToRenderer('automation:run-completed')` → triage inbox updates
3. `ClaudeHookWatcher` state change → emits to `AutomationService` → matches triggers → may spawn new run
4. `GitHubService` PR status change → emits to `AutomationService` → matches triggers → may spawn new run

### Error Propagation

- `claude -p` exit code 1 → run marked `failed` with stderr as error message
- Worktree creation fails → run marked `failed`, no process spawned
- Timeout → process killed, run marked `timeout`
- App crash during run → on next startup, orphaned worktrees GC'd, interrupted runs not recovered (marked failed on next startup by checking for `running` status runs with no active process)

### State Lifecycle Risks

- **Orphaned worktrees**: Mitigated by GC on startup + 24h age limit
- **Orphaned processes**: Mitigated by `destroy()` on shutdown + `taskkill /T` on Windows
- **Stale run data**: Mitigated by max 50 runs per automation, auto-prune
- **Concurrent worktree creation**: `git worktree add` is NOT atomic on the same repo. Serialized via promise chain lock (see learnings from FileWatcher memory leak fix).

### API Surface Parity

New IPC namespace `automation:*` follows existing patterns:
- Uses `ipcMain.handle` for request/response (like `terminal:*`, `project:*`)
- Uses `webContents.send` for events (like `terminal:state`, `github:pr-status-update`)
- Preload whitelist updated
- Types added to `ElectronAPI`

## Acceptance Criteria

### Functional Requirements

- [x] Users can create automations with name, prompt, trigger, and target project(s)
- [x] Schedule triggers fire at configured cron times
- [x] Event triggers fire on Claude done, PR merged/checks passed, file changes
- [x] Each run executes `claude -p` in an isolated worktree
- [x] Run results appear in triage inbox with status and output
- [x] Users can enable/disable, edit, delete automations
- [x] Users can manually trigger, stop running, and review results
- [x] Missed cron runs detected and fired once on app startup/resume

### Non-Functional Requirements

- [x] Max 3 concurrent automation runs
- [x] Default 30-minute timeout per run (configurable)
- [x] Output buffer capped at 10MB
- [x] Max 50 runs retained per automation
- [x] Worktree GC on startup (remove `auto-*` branches >24h old)
- [x] File change triggers debounced with configurable cooldown (default 60s)
- [x] App close warns about running automations

### Quality Gates

- [x] All new IPC handlers validate inputs (UUID format, string lengths)
- [x] Path validation on worktree creation (existing `validateFilePathInProject` pattern)
- [x] Process cleanup on Windows uses `taskkill /T /F` for process trees
- [x] Promise chain serialization for concurrent worktree operations
- [x] Tests for AutomationPersistence CRUD + migration
- [x] Tests for AutomationRunner timeout + abort + output parsing

## Dependencies & Prerequisites

- **croner** npm package (zero dependencies, ~50KB)
- Existing services: `WorktreeService`, `ClaudeHookWatcher`, `GitHubService`, `FileWatcherService`
- `claude` CLI must be on PATH (already required for Chat terminals)
- Projects must be `code` type (git repos) for worktree isolation

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Process leak on Windows | Medium | High | `taskkill /T /F` for tree kill, `destroy()` on shutdown |
| Runaway API costs | Medium | Medium | `--max-turns` and timeout limit per run |
| Worktree accumulation | Low | Medium | GC on startup, 24h max age, cap at 50 runs |
| Concurrent git operations corrupt repo | Low | High | Promise chain serialization lock |
| File change trigger storm | Medium | Low | Cooldown/debounce (60s default) |

## Future Considerations (Out of Scope)

- Cloud-based execution (runs without app open)
- Automation templates / marketplace
- Chained workflows (A → B → C)
- Retry logic / automatic re-run on failure
- Skills integration (`$skill-name` in prompts)
- Run cost tracking / token usage display
- Dry-run mode for prompt testing
- Import/export automation configs

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-02-23-automations-brainstorm.md](docs/brainstorms/2026-02-23-automations-brainstorm.md) — Key decisions carried forward: `claude -p` executor, triage inbox, worktree isolation, UI-only config, project-bound multi-assignable

### Internal References

- Service pattern: `electron/main/services/TerminalManager.ts`, `electron/main/services/GitHubService.ts`
- Persistence pattern: `electron/main/services/ProjectPersistence.ts`
- IPC pattern: `electron/preload/index.ts` (whitelist), `src/types/index.ts` (ElectronAPI)
- Dialog pattern: `src/components/Worktree/CreateWorktreeDialog.tsx`
- Tab pattern: `src/components/FileExplorer/FileExplorerTabBar.tsx`
- Event manager pattern: `src/utils/terminalEvents.ts`
- Process cleanup lesson: `docs/solutions/runtime-errors/ebusy-worktree-removal-terminal-handles.md`
- FileWatcher memory leak lesson: `docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md`
- IPC security lesson: `docs/solutions/security-issues/tasks-ipc-path-traversal-and-review-fixes.md`

### External References

- [Croner cron library](https://croner.56k.guru/) — zero deps, native TypeScript
- [Claude Code headless mode](https://code.claude.com/docs/en/headless) — `claude -p` documentation
- [Electron powerMonitor API](https://www.electronjs.org/docs/latest/api/power-monitor) — sleep/wake handling
- [OpenAI Codex automations](https://developers.openai.com/codex/app/automations/) — inspiration/reference
