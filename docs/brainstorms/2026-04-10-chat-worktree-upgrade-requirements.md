# Command CLI — Agent Control Plane

**Date**: 2026-04-10
**Status**: Ready for planning
**Scope**: Standard

## Problem

Claude Code runs inside Command's terminals but has no way to control the app. When Claude creates a worktree mid-conversation, the sidebar shows wrong files and merge UI is missing. More broadly, Claude can't open files in the editor, read sidecar output, or give feedback to the user through the app — it's blind to its own environment.

## Goal

Build a CLI (`ccli`) that Claude Code can call from within Command terminals to control the app: manage worktrees, open files, interact with sidecar terminals, and communicate status to the user. A Claude Code skill is auto-installed in every project so Claude knows the CLI exists and how to use it.

This makes Claude a first-class citizen that can drive the UI.

## CLI Surface

### Workspace

| Command | Description |
|---------|-------------|
| `ccli worktree link <path>` | Register an externally-created worktree and upgrade the current chat to a worktree chat |
| `ccli worktree create <name> [--branch <branch>]` | Create a worktree via Command Center (full registration + terminal upgrade) |
| `ccli worktree merge` | Merge the current worktree's PR (same as the merge button in UI) |
| `ccli open <file> [--line <n>]` | Open a file in the editor tab |
| `ccli diff <file>` | Open a diff view for a file |

### Sidecar Terminals

| Command | Description |
|---------|-------------|
| `ccli sidecar create [--title <name>]` | Create a new sidecar terminal in the current context |
| `ccli sidecar list` | List open sidecar terminals (id, title, last activity) |
| `ccli sidecar read <id>` | Read recent output from a sidecar terminal |

### Sessions & Projects

| Command | Description |
|---------|-------------|
| `ccli chat list` | List all chats/sessions in the current project (id, title, state, worktreeId) |
| `ccli chat info [id]` | Show details of a specific chat (default: current) — state, worktree, session ID |
| `ccli project list` | List all projects in Command Center (id, name, path, active status) |
| `ccli project create <path> [--name <name>]` | Add a project to Command Center |
| `ccli project info [id]` | Show project details (default: current) — path, worktree count, terminal count |

### Feedback

| Command | Description |
|---------|-------------|
| `ccli notify <message>` | Show a toast notification in Command Center |
| `ccli status <message>` | Set a status message on the current terminal's tab |
| `ccli title <title>` | Rename the current chat/terminal |

## Architecture

### Communication Channel

The CLI needs to reach the running Electron app. Approach:

1. **Command Center starts a local HTTP server** on a random port at startup
2. **Port is communicated via environment variable** — `COMMAND_CENTER_PORT` is set in every PTY spawned by TerminalManager
3. **CLI reads the env var** and makes HTTP requests to `localhost:$COMMAND_CENTER_PORT`
4. **Endpoints map 1:1 to CLI commands** — thin REST API in the main process

Why HTTP over file-based (like the hook system):
- Bidirectional — CLI gets a response (success/error, sidecar output, etc.)
- Instant — no polling delay
- Structured — JSON request/response, proper error codes
- The hook system is fire-and-forget; the CLI needs responses

### Terminal Identity

The CLI needs to know which terminal it's running in. Approach:
- `COMMAND_CENTER_TERMINAL_ID` env var set per PTY
- Every CLI request includes this as context
- Server resolves project, worktree, and terminal from the ID

### CLI Distribution

The CLI is a single Node.js script bundled with the app. Command Center adds its location to `PATH` in spawned PTYs (or uses a symlink in a known location).

## Requirements

### Worktree Link/Upgrade (original problem)

When `ccli worktree link <path>` is called:
1. Validate the path is a git worktree
2. Register it as a `Worktree` in the store (extract branch, name from path)
3. Update the calling terminal's `worktreeId` from `null` to the new worktree ID
4. Update the terminal's `cwd` and title
5. Downstream effects activate automatically: file explorer, PR polling, merge UI, sidecar context

When `ccli worktree create <name>` is called:
1. Create worktree via WorktreeService (same as UI flow)
2. Perform the same link/upgrade as above

When `ccli worktree merge` is called:
1. Resolve the current terminal's worktree
2. Check for open PR, mergeable status, uncommitted changes
3. Merge via GitHubService (same as merge button)
4. Return result (merged, conflicts, no PR, etc.)

### File Operations

`ccli open <file>` and `ccli diff <file>`:
- Resolve path relative to terminal's cwd
- Open in Command Center's editor tab system
- Return success/error

### Sidecar Operations

`ccli sidecar create`:
- Create sidecar in the current context (worktree or project)
- Return the new sidecar's ID and title

`ccli sidecar list`:
- Return JSON array of sidecars for the current context
- Fields: id, title, lastActivity

`ccli sidecar read <id>`:
- Return recent terminal output (scrollback buffer, last N lines)
- Useful for Claude to check on running processes

### Session & Project Operations

`ccli chat list`:
- Return JSON array of all chats in the current project
- Fields: id, title, state (busy/done/permission/etc.), worktreeId, lastActivity
- Useful for Claude to understand what else is running in the project

`ccli chat info [id]`:
- Return details of a specific chat (defaults to current terminal)
- Fields: id, title, state, worktreeId, worktreePath, sessionId, type
- Lets Claude understand its own context

`ccli project list`:
- Return JSON array of all projects in Command Center
- Fields: id, name, path, terminalCount, worktreeCount

`ccli project create <path>`:
- Add a new project to Command Center from a directory path
- Auto-detect name from directory or `--name` override
- Return the new project's ID

`ccli project info [id]`:
- Return details of a project (defaults to current)
- Fields: id, name, path, worktrees, active terminals

### Feedback Operations

`ccli notify <message>`:
- Show toast in Command Center UI
- Return immediately

`ccli status <message>`:
- Set status text on the terminal's tab
- Cleared on next status call or after timeout

`ccli title <title>`:
- Rename the terminal in the store
- Persisted across sessions

## Scope

### In scope
- CLI binary/script (`ccli`) with the commands listed above
- Local HTTP server in Electron main process
- Env vars for terminal identity and server port
- Worktree upgrade flow (the original problem)
- Claude Code skill auto-installed in every Command project

### Out of scope
- Split view control
- Automation triggers
- File explorer refresh commands
- Authentication/security (localhost only, trusted environment)
- CLI usage outside Command terminals

## Claude Code Skill

### Purpose

A skill file (`.claude/commands/ccli.md`) is automatically written into every project that gets added to Command. This teaches Claude Code that the `ccli` CLI exists, what it can do, and when to use it.

### Auto-Install Mechanism

When Command adds or opens a project:
1. Check if `.claude/commands/ccli.md` exists in the project directory
2. If missing or outdated (version mismatch), write/update it
3. The skill file is generated from a template bundled with the app
4. Add `.claude/commands/ccli.md` to `.gitignore` if not already present (this is tooling, not project code)

### Skill Content (template)

The skill should instruct Claude Code to:
- Use `ccli worktree create` instead of `git worktree add` — this creates the worktree AND upgrades the chat in one step
- Use `ccli worktree link` only as fallback for pre-existing worktrees not created via `ccli`
- Use `ccli worktree merge` when a PR is ready to merge
- Use `ccli open` to show relevant files to the user in the editor
- Use `ccli notify` to alert the user when long-running tasks complete
- Use `ccli status` to communicate what it's currently doing
- Use `ccli title` to give the chat a descriptive name based on the task
- Use `ccli sidecar` to run background processes and check their output
- Use `ccli chat list` to understand what other sessions are active
- **Never use `git worktree add` directly** — always use `ccli worktree create` so the app stays in sync

The skill should NOT instruct Claude to use the CLI preemptively — only when the action adds value to the current task.

### Skill Versioning

The skill file includes a version comment (e.g., `<!-- ccli-skill-v1 -->`). When the CLI surface changes, the version bumps and Command overwrites outdated skill files on project open.

## Key Technical Considerations

- `worktreeId` on `TerminalSession` must become mutable (store action + IPC)
- TerminalManager already sets env vars per PTY — adding two more is trivial
- The HTTP server should be lightweight (no Express dependency — use Node's built-in `http`)
- Sidecar read requires buffering terminal output in TerminalManager (similar to evicted terminal buffer)
- CLI should have clear exit codes and JSON output mode for programmatic use
- Skill auto-install should be idempotent and fast (file exists check + version compare)
- `.claude/commands/` may not exist yet — create it if needed

## Success Criteria

- Claude Code can run `ccli worktree link .worktrees/feat-foo` and the chat upgrades automatically
- Claude Code can run `ccli open src/App.tsx --line 42` and the file opens in the editor
- Claude Code can run `ccli sidecar list` and get structured output of open sidecars
- Claude Code can run `ccli sidecar read <id>` and read the output of a running process
- All commands return structured responses (JSON with `--json` flag)
- The CLI is automatically available in all Command terminals (no manual PATH setup)
- Every project in Command has a `.claude/commands/ccli.md` skill file
- Claude Code uses the CLI proactively when relevant (e.g., links worktree after creating one)
