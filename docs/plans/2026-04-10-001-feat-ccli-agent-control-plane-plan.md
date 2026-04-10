---
title: "feat: Add ccli agent control plane"
type: feat
status: completed
date: 2026-04-10
origin: docs/brainstorms/2026-04-10-chat-worktree-upgrade-requirements.md
---

# feat: Add ccli agent control plane

## Overview

Add a CLI (`ccli`) that Claude Code can call from within Command terminals to control the app. A local HTTP server in the Electron main process receives commands; the CLI communicates via env vars injected into every PTY. A Claude Code skill is auto-installed in every project so Claude knows the CLI exists and when to use it.

This replaces the need for Claude to use raw `git worktree add` (which Command can't track) and gives Claude read/write access to sidecars, file tabs, notifications, and project/session metadata.

## Problem Frame

Claude Code runs inside Command's terminals but is blind to the app. Creating a worktree via `git worktree add` leaves the terminal unlinked — sidebar shows wrong files, no PR polling, no merge UI. More broadly, Claude can't open files, read sidecar output, or communicate status. (see origin: `docs/brainstorms/2026-04-10-chat-worktree-upgrade-requirements.md`)

## Requirements Trace

- R1. Claude can create a worktree and the chat auto-upgrades (sidebar, PR polling, merge UI)
- R2. Claude can link an existing external worktree to the current chat
- R3. Claude can merge a worktree's PR via CLI
- R4. Claude can open files and diffs in the editor
- R5. Claude can create, list, read from, and execute commands in sidecar terminals
- R6. Claude can list active chats and their states
- R7. Claude can list projects and create new ones
- R8. Claude can show notifications, set status messages, and rename chats
- R9. A skill file is auto-installed in every project teaching Claude the CLI
- R10. All commands return structured JSON responses
- R11. The CLI is automatically available in all Command terminals (no manual setup)

## Scope Boundaries

- Only `.worktrees/` directory worktrees (not arbitrary paths)
- No split view control
- No automation triggers
- No file explorer refresh commands
- OS-level notifications only (no in-app toast system — future follow-up)
- Localhost-only HTTP server with token auth (no network exposure)

## Context & Research

### Relevant Code and Patterns

- `electron/main/services/TerminalManager.ts` — PTY spawning, env override via `CreateTerminalOptions.envOverrides`, eviction buffering pattern (reusable for sidecar read)
- `electron/main/index.ts` — All IPC handlers, `isValidUUID()`, `validateFilePathInProject()`, service init order
- `electron/main/services/ProjectPersistence.ts` — `addWorktree()`, `addProject()`, atomic write pattern
- `electron/main/services/WorktreeService.ts` — `createWorktree()`, worktree CRUD
- `electron/main/services/GitHubService.ts` — `mergePR()` at line 163, `getPRForBranch()`
- `src/stores/projectStore.ts` — `openEditorTab()`, `addTerminal()`, `updateTerminalState()`, `createSidecarTerminal()`
- `electron-builder.json` — `extraResources` pattern for bundled files (hooks dir)
- `electron/preload/index.ts` — contextBridge whitelist pattern

### Institutional Learnings

- **Path validation**: Use `startsWith(parent + path.sep)` not just `startsWith(parent)` to prevent prefix-overlap attacks (from `docs/solutions/security-issues/`)
- **Windows path casing**: `normalizePath()` must `.toLowerCase()` on Windows for all comparisons (from `docs/solutions/integration-issues/`)
- **Windows EBUSY**: Close PTY handles before filesystem ops; 500ms delay after termination (from `docs/solutions/runtime-errors/`)
- **Worktree serialization**: Use promise-chain lock for concurrent worktree operations (from `docs/solutions/integration-issues/`)
- **IPC naming**: Follow `service:kebab-case-action` convention; never leak paths in error messages (from `docs/solutions/code-review/`)

## Key Technical Decisions

- **HTTP over file-based IPC**: The CLI needs bidirectional communication (responses from sidecar read, merge status, etc.). File-based is fire-and-forget only. Node's built-in `http` module — no Express dependency.
- **Token auth**: Random token generated at startup, passed via `COMMAND_CENTER_TOKEN` env var, required in `Authorization` header. Blocks casual abuse from other local processes.
- **CLI name `ccli`**: `command` conflicts with bash builtin. `ccli` is short, unique, and available.
- **Shell cwd after worktree create**: The CLI returns the worktree path; the skill instructs Claude to `cd` to it. No PTY input injection (fragile and security-risky).
- **Post-merge behavior**: CLI returns merge result. No auto-cleanup of worktree/terminal — Claude or user handles that, matching existing merge button behavior.
- **OS notifications for `ccli notify`**: No in-app toast system exists. OS notifications work today. Toast is a future enhancement.
- **Sidecar output buffer**: Rolling buffer maintained in TerminalManager for all `type: 'normal'` terminals (not just evicted ones). Capped at 1MB per sidecar, matching existing eviction buffer pattern.

## Open Questions

### Resolved During Planning

- **Shell cwd after worktree upgrade**: CLI returns path, skill says `cd` to it. Injecting into PTY is fragile.
- **Sidecar write**: Added `ccli sidecar exec` — without it the feature is useless.
- **Security model**: Token auth via env var. Minimal effort, blocks lateral access.
- **Binary name**: `ccli` avoids bash builtin conflict with `command`.
- **Silent failures**: All commands return explicit errors (HTTP 4xx) for limits (sidecar cap, editor tab cap, terminal cap).

### Deferred to Implementation

- Exact HTTP route structure (flat vs nested, path params vs query params)
- Rolling buffer implementation details for sidecar read (ring buffer vs string truncation)
- Skill file exact wording (depends on testing real Claude Code behavior)
- Whether `ccli` script should be TypeScript compiled or plain JavaScript

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code (running in PTY)                           │
│  Has env: COMMAND_CENTER_PORT, _TERMINAL_ID, _TOKEN     │
│                                                         │
│  $ ccli worktree create feat-auth                       │
│  $ ccli open src/App.tsx --line 42                      │
│  $ ccli sidecar exec abc123 "npm test"                  │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP POST localhost:$PORT
                        │ Authorization: Bearer $TOKEN
                        ▼
┌─────────────────────────────────────────────────────────┐
│  CommandServer (electron/main/services/)                 │
│  Node http.createServer on random port, 127.0.0.1       │
│                                                         │
│  Routes:                                                │
│  POST /worktree/create    POST /sidecar/create          │
│  POST /worktree/link      POST /sidecar/exec            │
│  POST /worktree/merge     GET  /sidecar/list            │
│  POST /open               GET  /sidecar/read/:id        │
│  POST /diff               POST /notify                  │
│  GET  /chat/list           POST /status                  │
│  GET  /chat/info           POST /title                   │
│  GET  /project/list        POST /project/create          │
│  GET  /project/info                                      │
│                                                         │
│  Resolves terminalId -> projectId, worktreeId            │
│  Delegates to existing services                          │
│  Sends IPC events to renderer for UI updates             │
└───────────────────────┬─────────────────────────────────┘
                        │ win.webContents.send()
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Renderer (Zustand store)                               │
│  New IPC listeners for:                                 │
│  - terminal:worktree-updated (worktreeId mutation)      │
│  - editor:open-file (open file in editor tab)           │
│  - notification:toast (future)                          │
└─────────────────────────────────────────────────────────┘
```

## Implementation Units

- [ ] **Unit 1: CommandServer skeleton + token auth**

**Goal:** HTTP server that starts on a random port, binds to 127.0.0.1, validates Bearer token, routes requests, and returns JSON responses. Foundation for all subsequent commands.

**Requirements:** R10, R11

**Dependencies:** None

**Files:**
- Create: `electron/main/services/CommandServer.ts`
- Modify: `electron/main/index.ts` (init server in createWindow, pass service refs)
- Test: `test/commandServer.test.ts`

**Approach:**
- Node `http.createServer` with JSON body parsing
- Generate random token via `crypto.randomBytes(32).toString('hex')` at startup
- Route table: Map of `method:path` -> handler function
- Each handler receives parsed body + terminalId (from header) + service references
- Return JSON with consistent shape: `{ ok: boolean, data?: T, error?: string }`
- Start server before TerminalManager init (need port number for env vars)
- Store port and token on server instance for TerminalManager to read

**Patterns to follow:**
- Input validation style from `electron/main/index.ts` (isValidUUID, type checks)
- Service class pattern from existing services (constructor with deps, init/destroy lifecycle)

**Test scenarios:**
- Happy path: server starts on random port, responds to valid requests with 200
- Happy path: valid Bearer token passes authentication
- Error path: missing Authorization header returns 401
- Error path: invalid token returns 401
- Error path: unknown route returns 404
- Error path: malformed JSON body returns 400
- Edge case: server port is available in getPort()/getToken() after start

**Verification:**
- Server starts, accepts authenticated requests, rejects unauthenticated ones
- Port and token are accessible for env var injection

---

- [ ] **Unit 2: CLI script (`ccli`) with subcommand routing**

**Goal:** Standalone Node.js script that parses subcommands, reads env vars, makes HTTP requests to CommandServer, and formats output.

**Requirements:** R10, R11

**Dependencies:** Unit 1

**Files:**
- Create: `electron/main/cli/ccli.js`
- Test: `test/ccli.test.ts`

**Approach:**
- Plain JavaScript (no build step — bundled as extraResource)
- Read `COMMAND_CENTER_PORT`, `COMMAND_CENTER_TERMINAL_ID`, `COMMAND_CENTER_TOKEN` from env
- Subcommand routing via simple argv parsing: `ccli <group> <action> [args] [--flags]`
- HTTP client using Node `http.request`
- Output: JSON by default (Claude reads it), human-readable with `--pretty`
- Exit code 0 on success, 1 on error
- Graceful error when env vars are missing (e.g., "ccli must be run inside a Command terminal")

**Patterns to follow:**
- Minimal dependencies — Node builtins only (http, path, process)
- Similar to `electron/main/hooks/claude-state-hook.cjs` in distribution approach

**Test scenarios:**
- Happy path: `ccli worktree create foo` sends correct HTTP request with auth header
- Happy path: successful response is printed as JSON to stdout
- Error path: missing COMMAND_CENTER_PORT prints helpful error message and exits 1
- Error path: server returns error — CLI prints error message and exits 1
- Edge case: `--pretty` flag formats output for human readability

**Verification:**
- CLI parses all subcommand groups (worktree, open, diff, chat, project, sidecar, notify, status, title)
- Env var absence produces clear error

---

- [ ] **Unit 3: Env var injection + PATH setup**

**Goal:** Every PTY spawned by TerminalManager gets `COMMAND_CENTER_PORT`, `COMMAND_CENTER_TERMINAL_ID`, `COMMAND_CENTER_TOKEN`, and the CLI directory prepended to `PATH`.

**Requirements:** R11

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `electron/main/services/TerminalManager.ts` (env injection in createTerminal)
- Modify: `electron/main/index.ts` (pass server ref to TerminalManager or provide port/token)
- Test: `test/terminalManager.test.ts`

**Approach:**
- TerminalManager receives CommandServer reference (or port/token getter)
- In `createTerminal`, add to env: `COMMAND_CENTER_PORT`, `COMMAND_CENTER_TERMINAL_ID` (= terminal UUID), `COMMAND_CENTER_TOKEN`
- Prepend CLI directory to `PATH` env var (extraResources path at runtime)
- Use `app.getPath('exe')` or resource path to locate the CLI script directory
- On Windows: handle both Git Bash PATH format (colon-separated with forward slashes) and PowerShell PATH format (semicolon-separated with backslashes)

**Patterns to follow:**
- Existing `envOverrides` pattern in `CreateTerminalOptions`
- Shell detection in `TerminalManager.getShell()` for PATH format

**Test scenarios:**
- Happy path: new terminal has all three COMMAND_CENTER_* env vars set
- Happy path: PATH includes the CLI directory
- Edge case: existing PATH entries are preserved (prepend, don't replace)
- Edge case: works with both Git Bash and PowerShell PATH formats on Windows

**Verification:**
- `echo $COMMAND_CENTER_PORT` in a new terminal returns a valid port number
- `which ccli` or `where ccli` resolves to the bundled script

---

- [ ] **Unit 4: Terminal worktreeId mutation**

**Goal:** Enable changing a terminal's `worktreeId` after creation — the core mechanism for upgrading a plain chat to a worktree chat.

**Requirements:** R1, R2

**Dependencies:** None (can be built independently)

**Files:**
- Modify: `electron/main/services/TerminalManager.ts` (add `updateTerminalWorktree` method)
- Modify: `electron/main/index.ts` (new IPC handler `terminal:update-worktree`)
- Modify: `src/stores/projectStore.ts` (new `updateTerminalWorktree` action)
- Modify: `src/types/index.ts` (add `updateTerminalWorktree` to ElectronAPI)
- Modify: `electron/preload/index.ts` (expose new channel)
- Test: `test/projectStore.test.ts`

**Approach:**
- TerminalManager: `updateTerminalWorktree(terminalId, worktreeId, newCwd)` — updates instance fields, sends event to renderer
- IPC handler: validates terminalId + worktreeId, calls TerminalManager, sends `terminal:worktree-updated` to renderer
- Store action: `updateTerminalWorktree(terminalId, worktreeId)` — updates `terminals[id].worktreeId`
- Renderer listener: on `terminal:worktree-updated`, call store action
- 1:1 coupling: check no other terminal already claims this worktreeId before upgrading
- Session persistence: `before-quit` handler already reads from TerminalManager instances, so the mutation is automatically persisted

**Patterns to follow:**
- `updateTerminalState` in store (similar mutation pattern)
- `terminal:state` IPC event flow in ClaudeHookWatcher (event -> renderer -> store update)

**Test scenarios:**
- Happy path: terminal with `worktreeId: null` gets updated to a valid worktreeId
- Happy path: store reflects new worktreeId after update
- Error path: updating to a worktreeId already claimed by another terminal returns error
- Error path: invalid terminalId returns error
- Edge case: file explorer switches to worktree path after mutation (integration)
- Edge case: sidecar context key changes to worktreeId after mutation

**Verification:**
- A terminal's worktreeId can be changed from null to a valid worktree ID
- The 1:1 worktree-terminal constraint is enforced
- Downstream UI (file explorer, sidecar context) reacts to the change

---

- [ ] **Unit 5: Worktree commands (create, link, merge)**

**Goal:** HTTP endpoints for `ccli worktree create`, `ccli worktree link`, and `ccli worktree merge`.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1, Unit 4

**Files:**
- Modify: `electron/main/services/CommandServer.ts` (add route handlers)
- Test: `test/commandServer.worktree.test.ts`

**Approach:**

`POST /worktree/create`:
1. Parse `name`, optional `branch`, optional `sourceBranch` from body
2. Resolve terminalId -> projectId via TerminalManager
3. Call `WorktreeService.createWorktree(projectPath, branch, name, sourceBranch)`
4. Call `ProjectPersistence.addWorktree(...)` with new UUID
5. Call `TerminalManager.updateTerminalWorktree(terminalId, worktreeId, worktreePath)`
6. Send `worktree:added` event to renderer via webContents
7. Return `{ worktreeId, path, branch }` — CLI prints path so Claude can `cd` to it

`POST /worktree/link`:
1. Parse `path` from body
2. Validate path is a git worktree (check `.git` file content)
3. Validate path is under the project's `.worktrees/` directory
4. Extract branch name from worktree
5. Register in persistence + send to renderer + update terminal (same as create minus git operations)

`POST /worktree/merge`:
1. Resolve terminalId -> worktreeId -> worktree (branch, path)
2. Resolve project path
3. Call `GitHubService.getPRForBranch(projectPath, branch)`
4. Validate: PR exists, is open, is mergeable
5. Check for uncommitted changes via `WorktreeService.hasChanges(worktreeId)`
6. Call `GitHubService.mergePR(projectPath, prNumber)`
7. Return merge result

**Patterns to follow:**
- Existing `worktree:create` IPC handler in index.ts (validation, persistence flow)
- Existing merge flow in `WorktreeItem.tsx` (prereq checks)
- Worktree serialization lock from learnings

**Test scenarios:**
- Happy path: create worktree registers it and upgrades terminal
- Happy path: link existing worktree directory upgrades terminal
- Happy path: merge succeeds and returns PR details
- Error path: create with duplicate branch name returns clear error
- Error path: link with non-worktree path returns 400
- Error path: link with path outside `.worktrees/` returns 400
- Error path: merge with no PR returns structured error
- Error path: merge with uncommitted changes returns 409
- Error path: merge with conflicts returns 409 with details
- Edge case: terminal already has a worktreeId (re-link scenario)
- Integration: after create, file explorer shows worktree files

**Verification:**
- Full create-upgrade-verify cycle works end-to-end
- Link works with a manually created git worktree
- Merge matches behavior of the existing UI merge button

---

- [ ] **Unit 6: File commands (open, diff)**

**Goal:** HTTP endpoints for `ccli open <file>` and `ccli diff <file>`.

**Requirements:** R4

**Dependencies:** Unit 1

**Files:**
- Modify: `electron/main/services/CommandServer.ts` (add route handlers)
- Modify: `src/stores/projectStore.ts` (add IPC listener for `editor:open-file`)
- Modify: `src/types/index.ts` (if new IPC event types needed)
- Test: `test/commandServer.file.test.ts`

**Approach:**

`POST /open`:
1. Parse `file` (absolute path) and optional `line` from body
2. Validate file path is within the project or worktree boundary using `validateFilePathInProject` + separator-aware check
3. Verify file exists via `fs.access`
4. Send `editor:open-file` event to renderer via `webContents.send`
5. Renderer listener calls `openEditorTab(filePath, fileName, projectId)`
6. If `line` provided, include in event for scroll-to-line behavior
7. Return `{ ok: true }`

`POST /diff`:
1. Same validation as `/open`
2. Send `editor:open-diff` event to renderer
3. Renderer opens diff view for the file (against git HEAD)

Note: the CLI resolves relative paths to absolute using its own `process.cwd()` before sending to server. Server validates the absolute path.

**Patterns to follow:**
- `openEditorTab` in projectStore (deduplication, MAX_EDITOR_TABS enforcement)
- `validateFilePathInProject` in index.ts

**Test scenarios:**
- Happy path: open file sends correct IPC event to renderer
- Happy path: open with line number includes line in event data
- Error path: file path outside project boundary returns 403
- Error path: file does not exist returns 404
- Edge case: tab limit reached — return success but note that oldest tab was evicted
- Edge case: file already open — deduplicates and focuses existing tab

**Verification:**
- `ccli open src/App.tsx --line 42` opens the file in the editor
- Path traversal attempts are blocked

---

- [ ] **Unit 7: Sidecar commands + output buffer**

**Goal:** HTTP endpoints for `ccli sidecar create`, `list`, `read`, and `exec`. Add rolling output buffer to TerminalManager for sidecar terminals.

**Requirements:** R5

**Dependencies:** Unit 1

**Files:**
- Modify: `electron/main/services/TerminalManager.ts` (sidecar output buffer, write-to-PTY method)
- Modify: `electron/main/services/CommandServer.ts` (add route handlers)
- Test: `test/commandServer.sidecar.test.ts`

**Approach:**

**Output buffer** (TerminalManager):
- New `sidecarBuffers: Map<string, string>` for all `type: 'normal'` terminals
- On PTY data event, append to buffer (for sidecar terminals only)
- Cap at 1MB per terminal; truncate from front when exceeded
- Clean up buffer on terminal dispose

**`POST /sidecar/create`**:
1. Resolve terminalId -> projectId + worktreeId (for context key)
2. Check sidecar limit (5 per context) — return 429 if exceeded
3. Create terminal via TerminalManager with `type: 'normal'`
4. Register in store via IPC event
5. Return `{ id, title }`

**`GET /sidecar/list`**:
1. Resolve context key (worktreeId or projectId)
2. Return JSON array of sidecars: `{ id, title, lastActivity }`

**`GET /sidecar/read/:id`**:
1. Validate sidecar belongs to caller's context
2. Read from `sidecarBuffers`
3. Optional `lines` query param to limit output (default: last 100 lines)
4. Return `{ output: string, totalLines: number }`

**`POST /sidecar/exec`**:
1. Parse `id` and `command` from body
2. Validate sidecar exists and belongs to caller's context
3. Write `command + '\n'` to PTY via `terminal.pty.write()`
4. Return `{ ok: true }` — output is asynchronous, read via `sidecar read`

**Patterns to follow:**
- Eviction buffer pattern in TerminalManager (`evictedBuffers`)
- `createSidecarTerminal` in projectStore

**Test scenarios:**
- Happy path: create sidecar returns valid ID
- Happy path: exec writes command to PTY
- Happy path: read returns recent output from buffer
- Error path: create when at sidecar limit returns 429
- Error path: read from non-existent sidecar returns 404
- Error path: exec on sidecar from different context returns 403
- Edge case: buffer truncation at 1MB preserves most recent data
- Edge case: read with `lines=10` returns last 10 lines only
- Integration: create -> exec "echo hello" -> read returns "hello"

**Verification:**
- Full create-exec-read cycle works
- Buffer doesn't grow unbounded
- Context isolation (can't read other project's sidecars)

---

- [ ] **Unit 8: Chat & Project query commands**

**Goal:** HTTP endpoints for `ccli chat list/info` and `ccli project list/create/info`.

**Requirements:** R6, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `electron/main/services/CommandServer.ts` (add route handlers)
- Test: `test/commandServer.query.test.ts`

**Approach:**

**`GET /chat/list`**:
1. Resolve terminalId -> projectId
2. Get all terminals for project from TerminalManager
3. Return `{ chats: [{ id, title, state, worktreeId, type, lastActivity }] }`

**`GET /chat/info`**:
1. Optional `id` query param (default: caller's terminalId)
2. Return full terminal info: `{ id, title, state, worktreeId, worktreePath, type, projectId }`

**`GET /project/list`**:
1. Get all projects from ProjectPersistence
2. Return `{ projects: [{ id, name, path, terminalCount, worktreeCount }] }`

**`POST /project/create`**:
1. Parse `path` and optional `name` from body
2. Validate path exists and is a directory
3. Auto-detect name from directory name if not provided
4. Call ProjectPersistence.addProject (following existing `project:add` IPC handler pattern)
5. Send `project:added` event to renderer
6. Trigger skill auto-install (Unit 9)
7. Return `{ projectId, name, path }`

**`GET /project/info`**:
1. Optional `id` query param (default: caller's projectId)
2. Return project details with worktree list and terminal count

**Patterns to follow:**
- Existing `project:add` IPC handler in index.ts
- `getTerminalInfo` in TerminalManager

**Test scenarios:**
- Happy path: chat list returns all chats for the project
- Happy path: project create registers new project
- Happy path: project list returns all projects
- Error path: project create with non-existent path returns 400
- Error path: project create with duplicate path returns 409
- Edge case: chat info with no ID returns caller's own info
- Edge case: project info includes worktree count and terminal count

**Verification:**
- Claude can discover its own terminal's context via `ccli chat info`
- New project created via CLI appears in sidebar

---

- [ ] **Unit 9: Feedback commands (notify, status, title)**

**Goal:** HTTP endpoints for `ccli notify`, `ccli status`, and `ccli title`.

**Requirements:** R8

**Dependencies:** Unit 1

**Files:**
- Modify: `electron/main/services/CommandServer.ts` (add route handlers)
- Modify: `src/stores/projectStore.ts` (add `terminalStatus` state if needed for status messages)
- Test: `test/commandServer.feedback.test.ts`

**Approach:**

**`POST /notify`**:
1. Parse `message` and optional `title` from body
2. Show OS notification via `new Notification({ title, body: message })`
3. Return `{ ok: true }`

**`POST /status`**:
1. Parse `message` from body
2. Send `terminal:status` event to renderer
3. Renderer displays status on the terminal tab (new UI element: small text below title)
4. Auto-clear after 30 seconds or on next status call
5. Return `{ ok: true }`

**`POST /title`**:
1. Parse `title` from body
2. Update in TerminalManager
3. Send `terminal:title` event to renderer
4. Store updates terminal title (persisted)
5. Return `{ ok: true }`

**Patterns to follow:**
- Existing `notification:show` IPC handler
- Existing `terminal:title` event flow in TerminalManager

**Test scenarios:**
- Happy path: notify triggers OS notification
- Happy path: title updates terminal name in store
- Happy path: status sets message on terminal tab
- Edge case: status auto-clears after timeout
- Edge case: title with empty string is rejected
- Error path: notify with empty message returns 400

**Verification:**
- `ccli title "Auth refactor"` renames the chat in the sidebar
- `ccli notify "Tests passed"` shows OS notification

---

- [ ] **Unit 10: Skill template + auto-install**

**Goal:** Auto-write `.claude/commands/ccli.md` into every project that Command manages.

**Requirements:** R9

**Dependencies:** Unit 2 (CLI surface must be finalized)

**Files:**
- Create: `electron/main/services/SkillInstaller.ts`
- Create: `electron/main/templates/ccli-skill.md` (template)
- Modify: `electron/main/index.ts` (trigger install on project add/open)
- Test: `test/skillInstaller.test.ts`

**Approach:**
- Template file bundled via extraResources
- `SkillInstaller` class with `installOrUpdate(projectPath)` method
- Check for `.claude/commands/ccli.md` — read first line for version comment `<!-- ccli-skill-v1 -->`
- If missing or version mismatch: create `.claude/commands/` dir if needed, write template
- Add `.claude/commands/ccli.md` to `.gitignore` if not already present (check before appending)
- Trigger on: `project:add` IPC handler, app startup (for all registered projects)
- Idempotent: skip if version matches

**Skill content should instruct Claude to:**
- Use `ccli worktree create` instead of `git worktree add` (and `cd` to the returned path)
- Use `ccli open` to show relevant files in the editor
- Use `ccli notify` when long tasks complete
- Use `ccli status` to communicate current activity
- Use `ccli title` to name the chat based on the task
- Use `ccli sidecar exec` to run background processes
- Use `ccli chat list` to understand other active sessions
- Use `ccli worktree merge` when a PR is ready
- Never use `git worktree add` directly

**Patterns to follow:**
- `HookInstaller` service pattern (writes files to external locations)
- extraResources pattern in electron-builder.json

**Test scenarios:**
- Happy path: skill file is created on project add
- Happy path: outdated version is overwritten with new version
- Happy path: `.gitignore` gets the entry added
- Edge case: `.claude/commands/` directory doesn't exist — gets created
- Edge case: current version matches — file is not rewritten
- Edge case: `.gitignore` already contains the entry — no duplicate
- Error path: project path doesn't exist — skip gracefully

**Verification:**
- Every project in Command has `.claude/commands/ccli.md` after startup
- Version bumping causes automatic update

---

- [ ] **Unit 11: Build configuration + bundling**

**Goal:** Bundle the CLI script and skill template with the Electron app. Ensure `ccli` is on PATH in all terminals.

**Requirements:** R11

**Dependencies:** Unit 2, Unit 10

**Files:**
- Modify: `electron-builder.json` (extraResources for CLI + template)
- Modify: `electron/main/services/TerminalManager.ts` (PATH injection using resource path)
- Test: `test/e2e/ccli.e2e.test.ts`

**Approach:**
- Add `electron/main/cli/` and `electron/main/templates/` to extraResources in electron-builder.json
- Create a `ccli.cmd` wrapper (Windows) that runs `node ccli.js` with the bundled Node
- TerminalManager resolves resource path via `app.isPackaged ? process.resourcesPath : __dirname` pattern
- Prepend CLI directory to PATH in env vars (before existing PATH)
- Handle Git Bash (colon-separated, forward slashes) vs PowerShell (semicolon-separated, backslashes) PATH formats based on detected shell

**Patterns to follow:**
- Existing `extraResources` config for hooks directory
- Shell detection in `TerminalManager.getShell()`

**Test scenarios:**
- Happy path: `ccli` is resolvable from a new terminal
- Happy path: `ccli --version` returns current app version
- Edge case: PATH injection works in Git Bash
- Edge case: PATH injection works in PowerShell
- Integration: full end-to-end `ccli worktree create` from a terminal in the built app

**Verification:**
- In a packaged build, `ccli` is available in all terminals
- Works in both Git Bash and PowerShell on Windows

## System-Wide Impact

- **Interaction graph:** CommandServer -> TerminalManager, ProjectPersistence, WorktreeService, GitHubService, renderer (via webContents.send). New IPC events: `terminal:worktree-updated`, `editor:open-file`, `terminal:status`. Skill installer hooks into `project:add` and app startup.
- **Error propagation:** CLI receives HTTP status + JSON error body. CLI maps to exit codes (0/1) and stderr. Server catches service exceptions and returns 500 with safe error message (no path leaking per learnings).
- **State lifecycle risks:** Terminal worktreeId mutation must be atomic across TerminalManager + renderer store. Race: two requests upgrading the same terminal simultaneously — mitigate with a per-terminal lock in CommandServer. Worktree operations serialized via existing promise-chain lock.
- **API surface parity:** The CLI surface parallels existing IPC surface. Existing IPC handlers for worktree/project/terminal operations remain unchanged — the HTTP server delegates to the same services.
- **Unchanged invariants:** All existing IPC channels, keyboard shortcuts, UI interactions, and store actions remain unchanged. The HTTP server is a new entry point that delegates to existing infrastructure.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `ccli` name collision on some systems | Check at startup, warn if another `ccli` exists on PATH. Name is uncommon enough that collision risk is low. |
| HTTP server port blocked by firewall/antivirus | Bind to 127.0.0.1 only. Most firewalls allow localhost. Log warning if port bind fails. |
| Sidecar buffer memory usage | 1MB cap per sidecar. Max 5 sidecars per context. Worst case: 5MB per project — acceptable. |
| Skill file conflicts with user's own commands | Use `.claude/commands/ccli.md` (specific name). Add to `.gitignore`. Version check prevents overwriting user modifications unless version is outdated. |
| Windows EBUSY on worktree operations after merge | Don't auto-remove worktree after merge. Let user/Claude handle cleanup when terminal is closed. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-10-chat-worktree-upgrade-requirements.md](docs/brainstorms/2026-04-10-chat-worktree-upgrade-requirements.md)
- Security learnings: `docs/solutions/security-issues/tasks-ipc-path-traversal-and-review-fixes.md`
- Path normalization: `docs/solutions/integration-issues/claude-status-indicator-hook-watcher-session-matching.md`
- Windows EBUSY: `docs/solutions/runtime-errors/ebusy-worktree-removal-terminal-handles.md`
- Worktree serialization: `docs/solutions/integration-issues/automations-system-architecture-patterns.md`
