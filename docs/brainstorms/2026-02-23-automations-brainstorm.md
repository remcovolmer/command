# Automations for Command

**Date:** 2026-02-23
**Status:** Brainstorm
**Inspired by:** OpenAI Codex Automations

## What We're Building

An automations system for Command that lets users define recurring or event-driven Claude Code tasks that run unattended. Each automation is a Claude Code session with a prompt, triggered by a schedule or event, running in an isolated worktree, with results landing in a triage inbox for review.

### Core Concept

An automation consists of:
1. **Name** — descriptive identifier
2. **Prompt** — instructions for Claude Code
3. **Trigger** — when to run (schedule or event)
4. **Projects** — which project(s) it runs against (one automation can target multiple projects)
5. **Result** — output captured in a triage inbox

## Why This Approach

**Lean MVP (Approach A)** — build on existing infrastructure, minimize new code, ship fast.

The codebase already has most building blocks:
- `WorktreeService` for worktree isolation per run
- `ClaudeHookWatcher` for Claude state detection (done/busy/error)
- `GitHubService` for Git event polling
- `FileWatcherService` for file system events
- `TerminalManager.createTerminal()` with `initialInput` for auto-starting Claude commands
- `ProjectPersistence` for JSON config storage

What's new:
- `AutomationService.ts` — CRUD, scheduling, trigger matching, run orchestration
- Triage inbox UI — sidebar section showing automation results
- Automation management UI — create/edit/delete automations

## Key Decisions

### Triggers

**Schedule-based:**
- Cron-style: daily, weekly, custom frequency
- User picks days and time
- App must be running for scheduled automations to fire

**Event-driven (all three categories):**
- **Claude state changes** — Claude goes to `done` → trigger next automation. Builds on ClaudeHookWatcher.
- **Git events** — PR merged, branch pushed, CI status change. Builds on GitHubService polling.
- **File system events** — Specific file/dir changed → trigger. Builds on FileWatcherService (chokidar).

### Output & Review

**Triage inbox (Codex-style):**
- New section in sidebar showing automation run results
- Filter: all runs / unread only
- Runs with no findings auto-archive (no noise)
- Each result shows: automation name, project, timestamp, summary, full output expandable

### Configuration

**UI-only:**
- Settings/automation panel in the app
- No config files to manage
- Stored via ProjectPersistence pattern (JSON in userData)

### Scope

**Project-bound, multi-assignable:**
- Each automation is tied to one or more projects
- One automation definition can run against multiple projects (e.g., "dependency check" for 3 repos)
- When multi-project: runs once per project (separate worktree each)

### Isolation

**Own worktree per run:**
- Every automation run gets a fresh worktree via WorktreeService
- No conflict with user's working directory
- Cleanup: auto-remove worktree after run completes (or archive if result has changes)

### Executor

**`claude -p` (CLI pipe mode):**
- Uses `claude -p "prompt" --output-format json --dangerously-skip-permissions`
- Spawned as child process via `child_process.spawn()`
- Output is clean JSON on stdout: `{ result, session_id, structured_output }`
- No terminal/PTY needed — lighter than interactive mode
- Supports `--max-turns` and `--max-budget-usd` for cost control
- Supports `--resume <session_id>` for multi-step automations
- Can use `--append-system-prompt` to inject project-specific context

**Alternatives considered:**
- `@anthropic-ai/claude-agent-sdk` — more powerful (streaming, tool callbacks) but heavier dependency, more complex
- Terminal spawn via TerminalManager — requires output scraping, fragile

### Permissions

**Always autonomous:**
- `--dangerously-skip-permissions` flag on all automation runs
- User trusts the prompt they configured
- No interactive approval needed

## Architecture Sketch

```
AutomationService.ts (new)
├── AutomationStore       — CRUD for automation configs
├── AutomationScheduler   — Timer-based cron execution
├── AutomationTrigger     — Event matching (hooks into existing services)
├── AutomationRunner      — Worktree creation → terminal spawn → output capture
└── AutomationInbox       — Run results storage and status

Trigger flow:
  Schedule tick / Event fires
  → AutomationTrigger matches automation
  → AutomationRunner:
    1. WorktreeService.createWorktree()
    2. spawn('claude', ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'], { cwd: worktreePath })
    3. Collect stdout JSON: { result, session_id }
    4. Parse result, generate summary
    5. Store in AutomationInbox
    6. Cleanup worktree (or keep if changes produced file modifications)
  → Emit 'automation:run-complete' IPC
  → Triage inbox UI updates
```

## Data Model

```typescript
interface Automation {
  id: string                    // UUID
  name: string                  // User-friendly name
  prompt: string                // Claude Code instructions
  projectIds: string[]          // One or more projects
  trigger: AutomationTrigger
  enabled: boolean
  createdAt: string
  updatedAt: string
}

type AutomationTrigger =
  | { type: 'schedule'; cron: string }                              // e.g., "0 9 * * 1-5" (weekdays 9am)
  | { type: 'claude-done'; terminalFilter?: string }                // Claude finishes a task
  | { type: 'git-event'; event: 'pr-merged' | 'pr-opened' | 'push' | 'ci-complete' }
  | { type: 'file-change'; patterns: string[] }                     // glob patterns

interface AutomationRun {
  id: string
  automationId: string
  projectId: string             // Which project this run was for
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  completedAt?: string
  result: string                // Claude's text response from claude -p JSON output
  sessionId?: string            // Claude session ID (for --resume if needed)
  summary?: string              // First line or auto-generated summary
  read: boolean                 // For triage inbox unread/read state
  worktreePath?: string         // If worktree still exists (has changes)
  exitCode: number              // 0 = success, 1 = error
}
```

## UI Components

### Sidebar: Automations Tab
- List of configured automations with enable/disable toggle
- "New Automation" button
- Triage inbox section with unread count badge

### Create/Edit Automation Dialog
- Name field
- Prompt textarea (multi-line)
- Project selector (multi-select from existing projects)
- Trigger type selector with type-specific config:
  - Schedule: day/time picker
  - Claude done: optional terminal filter
  - Git event: event type selector
  - File change: glob pattern input
- Enable/disable toggle

### Triage Inbox
- List of automation runs, newest first
- Each entry: automation name, project, time, status, summary preview
- Click to expand full output
- Mark as read / archive actions
- Filter: all / unread

## Example Automations

1. **Daily dependency audit** — Schedule: daily 9am — Prompt: "Check for outdated dependencies, security vulnerabilities. Report findings."
2. **Post-merge release notes** — Trigger: PR merged — Prompt: "Generate release notes from the last merged PR. Include breaking changes."
3. **Auto-lint on change** — Trigger: file change `src/**/*.ts` — Prompt: "Run linting on changed files, fix any issues, report what was fixed."
4. **CI failure diagnosis** — Trigger: git event ci-complete (failed) — Prompt: "Diagnose the CI failure, identify root cause, suggest fix."

## Open Questions

*None — all key decisions resolved during brainstorm.*

## Out of Scope (for MVP)

- Cloud-based execution (runs require app to be open)
- Automation templates/marketplace
- Complex workflow chains (automation A → B → C)
- Retry logic / failure recovery
- Concurrency limits
- Skills integration ($skill-name syntax)
- Run cost tracking / token usage display
