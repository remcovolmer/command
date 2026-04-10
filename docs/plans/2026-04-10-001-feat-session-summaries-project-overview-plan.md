---
title: "feat: Session summaries in sidebar + project overview for inactive projects"
type: feat
status: active
date: 2026-04-10
---

# feat: Session summaries in sidebar + project overview for inactive projects

## Overview

Add session context awareness to Command Center by leveraging Claude Code's existing `sessions-index.json` files. Two surfaces:

**A) Chat session summaries in sidebar** — each chat tab shows a short summary line below the title, giving instant context on what that session is working on.

**B) Project overview for inactive projects** — when selecting a project with no active terminals, show a panel listing recent sessions with summaries, branches, and a "resume" action.

## Problem Frame

With 15+ projects and multiple sessions per project, context switching is the biggest productivity drain. Currently, chat tabs show only an auto-generated name (e.g., "Chat 1") and a state dot. When switching projects or returning to a session after hours/days, there's no way to know what each session was about without opening it and reading the scroll-back.

## Requirements Trace

- R1. Active chat tabs in the sidebar display a summary line below the tab title
- R2. Summaries come from Claude Code's `sessions-index.json` — no extra LLM calls, no custom hooks
- R3. Summaries are loaded at app start and refreshed when sessions change state (done/stopped)
- R4. Summary data persists across app restarts via existing `PersistedSession` mechanism
- R5. When selecting a project with zero active terminals, the center area shows a project overview panel
- R6. The project overview lists recent sessions (sorted by modified, limited to ~20) with summary, branch, message count, and time
- R7. Clicking a session in the project overview resumes it (existing `--resume` functionality)
- R8. Works for both regular projects and worktrees (each has its own sessions-index.json)
- R9. No performance regression — sessions-index.json is read async, cached, and not polled in a hot loop

## Scope Boundaries

- No custom Claude Code hooks or skills — purely reading existing data
- No LLM-powered summarization — we use what Claude Code already generates
- No live-updating summaries during an active session (summary updates when session state changes to `done`/`stopped`, not on every message)
- No transcript JSONL parsing — sessions-index.json has everything we need
- No phase detection (brainstorm/plan/work/review) in v1 — the `summary` field from sessions-index.json is sufficient. Phase detection can be added later as a heuristic or hook

## Context & Research

### Key Discovery: sessions-index.json

Claude Code maintains `~/.claude/projects/{encoded-path}/sessions-index.json` per project with this structure:

```json
{
  "version": 1,
  "entries": [{
    "sessionId": "abc-123",
    "fullPath": "C:\\...\\abc-123.jsonl",
    "fileMtime": 1770154196803,
    "firstPrompt": "Fix the login page...",
    "summary": "Fix Login Page Authentication Bug",
    "messageCount": 20,
    "created": "2026-02-03T21:10:49Z",
    "modified": "2026-02-03T21:23:41Z",
    "gitBranch": "fix-login",
    "projectPath": "C:\\Users\\Remco\\Code\\myapp",
    "isSidechain": false
  }]
}
```

Path encoding: `cwd.replace(/[/\\:]/g, '-').replace(/^-/, '')` — already implemented in `verifyClaudeSessionAsync()`.

Verified: all 15+ projects have this file with real summaries. 76/97 sessions for this project alone have meaningful summaries.

### Relevant Code Patterns

- **Path encoding**: `electron/main/index.ts:161` — `cwd.replace(/[/\\:]/g, '-').replace(/^-/, '')`
- **BiMap session mapping**: `ClaudeHookWatcher` maintains `sessionToTerminal` / `terminalToSession` maps
- **State change listener**: `hookWatcher.addStateChangeListener()` returns unsubscriber — used by AutomationService for `claude-done` trigger
- **Async file reading**: ClaudeHookWatcher uses `fs.promises.readFile` + `isReading` guard + 250ms polling — follow this pattern
- **IPC push pattern**: `window.webContents.send('terminal:state', ...)` for main→renderer — add `terminal:summary` channel
- **PersistedSession**: already stores `terminalId`, `claudeSessionId`, `title`, `cwd` — extend with `summary`

### Institutional Learnings

- **Windows path normalization**: Always use `normalizePath()` before path comparison/Map lookup (from claude-status-indicator learning)
- **No readFileSync in hot paths**: Use async reads with concurrency guard (from terminal-lru-pooling learning)
- **Single active watcher pattern**: Don't watch all projects simultaneously — watch active project only (from filewatcher-memory-leak learning)
- **YAGNI**: Start minimal, expand when UI needs it (from tasks-ipc-path-traversal learning)

## Key Technical Decisions

- **Read sessions-index.json, not JSONL transcripts**: The index file has pre-computed summaries, avoiding expensive transcript parsing and LLM calls. This is a free data source maintained by Claude Code itself.
- **Poll on state change, not on timer**: Read sessions-index.json when a terminal transitions to `done`/`stopped` via the existing state change listener, plus once on app startup. No additional polling loop.
- **Cache in main process, push to renderer**: A new `SessionIndexService` caches the parsed index per project. When summaries change, it pushes updates via IPC. The renderer never reads the file directly.
- **Extend PersistedSession for restart persistence**: Add `summary` field to `PersistedSession` so summaries survive app restarts without needing to re-read the index file at startup (though we do re-read to refresh).

## Open Questions

### Resolved During Planning

- **How to get session summaries?** → sessions-index.json already has them, maintained by Claude Code
- **How to map sessions to terminals?** → ClaudeHookWatcher BiMap already does this
- **Path encoding?** → `cwd.replace(/[/\\:]/g, '-').replace(/^-/, '')`, already in codebase
- **Performance concern with 15+ projects?** → Only read index for active project + on-demand for project overview. Cache results.

### Deferred to Implementation

- Exact visual design of the summary line in sidebar (font size, truncation, max chars)
- Exact layout of the project overview panel (card layout vs. list)
- Whether `firstPrompt` or `summary` is more useful as the primary display text (likely `summary` with `firstPrompt` as fallback)
- Exact number of sessions to show in project overview (start with 20, adjust based on UX)
- Whether to verify session file existence before offering resume in the overview panel (async check adds latency but prevents "resume" clicking into a blank session)

## Implementation Units

- [ ] **Unit 1: SessionIndexService — read and cache sessions-index.json**

  **Goal:** Create a main-process service that reads, parses, and caches `sessions-index.json` for a given project path. Provides a lookup method: `getSessionSummary(sessionId)` → `{ summary, firstPrompt, messageCount, gitBranch, modified }`.

  **Requirements:** R2, R3, R9

  **Dependencies:** None

  **Files:**
  - Create: `electron/main/services/SessionIndexService.ts`
  - Modify: `electron/main/index.ts` (instantiate service, wire up)
  - Test: `test/sessionIndexService.test.ts`

  **Approach:**
  - Reuse the path encoding from `verifyClaudeSessionAsync()` — extract to a shared utility
  - Use `fs.promises.readFile` with try/catch (file may not exist for new projects)
  - Cache parsed entries in a `Map<sessionId, SessionIndexEntry>`
  - Expose `loadForProject(projectPath)` and `getSessionSummary(sessionId)`
  - Register as state change listener on `hookWatcher` — on `done`/`stopped`, re-read index for the terminal's project
  - Cap file read at a reasonable size (sessions-index.json is small — typically <100KB — but guard against edge cases)

  **Patterns to follow:**
  - `ClaudeHookWatcher` async file read pattern with `isReading` guard
  - `AutomationService.registerEventTriggers()` callback/unsubscriber pattern
  - Path encoding from `electron/main/index.ts:161`

  **Test scenarios:**
  - Happy path: parse valid sessions-index.json, lookup by sessionId returns correct entry
  - Happy path: re-read after state change updates cache with new/modified entries
  - Edge case: sessions-index.json does not exist → returns empty, no crash
  - Edge case: sessions-index.json is malformed JSON → returns empty, logs warning
  - Edge case: sessionId not found in index → returns undefined
  - Edge case: concurrent reads (two state changes fire rapidly) → isReading guard prevents double-read
  - Integration: path encoding produces correct directory name for Windows paths with drive letters and backslashes

  **Verification:**
  - Service can read and cache the sessions-index.json from disk
  - `getSessionSummary()` returns correct data for known session IDs
  - State change triggers re-read

---

- [ ] **Unit 2: IPC channel + store integration for terminal summaries**

  **Goal:** Wire `SessionIndexService` data through IPC to the renderer. Add `summary` field to `TerminalSession` and `PersistedSession`. Store receives and exposes summaries.

  **Requirements:** R1, R3, R4

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `src/types/index.ts` (add `summary` to `TerminalSession`, `PersistedSession`)
  - Modify: `electron/preload/index.ts` (add `terminal:summary` to allowed listener channels)
  - Modify: `electron/main/index.ts` (emit `terminal:summary` when SessionIndexService has data, include summary in session persistence)
  - Modify: `src/stores/projectStore.ts` (add `updateTerminalSummary` action)
  - Modify: `src/utils/terminalEvents.ts` (register `terminal:summary` listener, dispatch to store)
  - Test: `test/projectStore.test.ts` (extend existing tests)

  **Approach:**
  - Add `summary?: string` to `TerminalSession` in types
  - Add `summary?: string` to `PersistedSession`
  - New IPC channel: `terminal:summary` (main→renderer) with payload `{ terminalId, summary }`
  - `SessionIndexService` emits summary via `window.webContents.send('terminal:summary', ...)` when data is available
  - On app startup during session restore: look up summary from SessionIndexService and include it in the restored terminal data
  - `terminalEvents.ts` registers listener and calls `projectStore.getState().updateTerminalSummary(terminalId, summary)`

  **Patterns to follow:**
  - `terminal:state` IPC channel pattern (preload whitelist, event dispatcher, store action)
  - `PersistedSession` serialization in `electron/main/index.ts:1441-1469`

  **Test scenarios:**
  - Happy path: store receives `updateTerminalSummary` → terminal's summary field updates
  - Happy path: persisted session includes summary → restored terminal has summary on startup
  - Edge case: `updateTerminalSummary` for unknown terminal ID → no-op, no crash
  - Edge case: summary is empty string or undefined → terminal shows no summary (graceful)
  - Integration: full flow from SessionIndexService read → IPC emit → store update

  **Verification:**
  - `projectStore` terminals have populated `summary` field after SessionIndexService loads
  - Summary survives app restart via PersistedSession

---

- [ ] **Unit 3: Sidebar summary display in TerminalListItem**

  **Goal:** Show the session summary as a second line below the terminal title in the sidebar.

  **Requirements:** R1

  **Dependencies:** Unit 2

  **Files:**
  - Modify: `src/components/Sidebar/TerminalListItem.tsx`
  - Modify: `src/components/Sidebar/SortableProjectItem.tsx` (inline terminal rendering)

  **Approach:**
  - In `TerminalListItem`, add a truncated summary line below the existing title
  - Use `text-xs text-text-secondary truncate` styling (consistent with existing secondary text patterns)
  - Only show for `type: 'claude'` terminals (not sidecar/normal terminals)
  - If no summary, show nothing (no placeholder text — keep clean)
  - `SortableProjectItem` inline terminal rendering follows same pattern

  **Patterns to follow:**
  - Existing `TerminalListItem` memo pattern and prop structure
  - Sidebar text truncation with `truncate` class

  **Test scenarios:**
  - Happy path: terminal with summary shows title + summary on two lines
  - Happy path: terminal without summary shows only title (no empty line)
  - Edge case: very long summary → truncated with ellipsis
  - Edge case: normal/sidecar terminal → no summary line shown

  **Verification:**
  - Claude terminal tabs in sidebar display summary text below the title
  - Layout doesn't break with long summaries or missing summaries

---

- [ ] **Unit 4: Project overview panel for inactive projects**

  **Goal:** When selecting a project with no active terminals, show a panel in the center area listing recent sessions from that project's sessions-index.json.

  **Requirements:** R5, R6, R7, R8

  **Dependencies:** Unit 1, Unit 2

  **Files:**
  - Create: `src/components/ProjectOverview.tsx`
  - Modify: `electron/main/index.ts` (add IPC handler `session-index:getForProject`)
  - Modify: `electron/preload/index.ts` (expose `session-index:getForProject` invoke)
  - Modify: `src/types/index.ts` (add `SessionIndexEntry` type for renderer)
  - Modify: `src/components/TerminalArea.tsx` or equivalent center area component (render ProjectOverview when no active terminal)

  **Approach:**
  - New IPC invoke channel: `session-index:getForProject(projectPath)` → returns recent sessions from SessionIndexService
  - `ProjectOverview` component: lists sessions sorted by `modified` desc, limited to 20
  - Each row shows: summary (or firstPrompt fallback), gitBranch badge, messageCount, relative time ("2 days ago")
  - Click on a session → triggers existing resume flow (`terminal:create` with `--resume sessionId`)
  - Render this component in the center area when `activeCenterTabId` is null and the active project has no terminals
  - Works for worktrees too — the encoded path includes the worktree path, so each worktree has its own index

  **Patterns to follow:**
  - Existing empty state patterns in center area
  - IPC invoke pattern from `fs:readFile` handler
  - Session resume flow from `ProjectPersistence.restoreSessions()`

  **Test scenarios:**
  - Happy path: project with 10 recent sessions → overview shows all 10 with correct summary/branch/time
  - Happy path: click session → new terminal created with `--resume sessionId`
  - Edge case: project with no sessions-index.json → show empty state ("No recent sessions")
  - Edge case: project with sessions but all have empty summaries → show firstPrompt as fallback
  - Edge case: worktree project → reads correct sessions-index.json for worktree path
  - Edge case: sessions-index.json updates while panel is visible → panel should reflect reasonably current data (re-fetch on project switch, not live-poll)

  **Verification:**
  - Selecting an inactive project shows the overview panel instead of empty center area
  - Sessions are listed with correct metadata
  - Clicking a session resumes it in a new terminal

---

- [ ] **Unit 5: Hotkey for project overview + polish**

  **Goal:** Add keyboard shortcut to access project overview. Polish summary refresh timing.

  **Requirements:** R3, R9

  **Dependencies:** Unit 3, Unit 4

  **Files:**
  - Modify: `src/utils/hotkeys.ts` (add action for project overview)
  - Modify: `src/App.tsx` (register hotkey handler)

  **Approach:**
  - Add hotkey action (e.g., `Ctrl+Shift+O` or next available) for "Show project overview"
  - Ensure summaries refresh when switching projects (not just on state change)
  - Verify no performance regression with 15+ projects by profiling the index read timing

  **Test expectation:** none — hotkey registration follows established mechanical pattern, no behavioral logic to test

  **Verification:**
  - Hotkey opens project overview panel
  - No noticeable lag when switching between projects

## Flow Analysis: Edge Cases & Mitigations

### Race condition: terminal created before sessions-index.json updated
When a user starts a new chat, the terminal is created immediately, but Claude Code updates `sessions-index.json` asynchronously (seconds later, or after the first response). During this window, there's no matching entry in the index file. **Mitigation:** Show auto-named title until summary becomes available, then transition. The state change listener re-reads the index on `done`/`stopped`, which is when the summary will exist.

### BiMap only covers active terminals
The `ClaudeHookWatcher` BiMap only maps active `sessionId → terminalId`. Feature B (project overview) shows historical sessions with no active terminals. **Mitigation:** Feature B bypasses the BiMap entirely — it reads `sessions-index.json` directly via an IPC invoke call, not through the state change listener. The BiMap is only used for Feature A (matching active terminals to their summaries).

### Session file may not exist for historical sessions
If a user clicks "resume" in the overview but the session's JSONL file was deleted, Claude Code falls back to a fresh session. **Mitigation:** Acceptable for v1 — Claude Code handles this gracefully. Can add session file existence check in a future iteration.

### Summary vs. auto-named title timing
`terminal.title` is set by auto-naming within ~1 second. The `summary` from sessions-index.json may take longer. **Mitigation:** Display `summary` when available, fall back to `title`. No visual "jump" because the summary line is a separate element below the title — both can coexist.

### Polling strategy for 15+ projects
Only read sessions-index.json for: (a) the active project on state change events, (b) a specific project on-demand when it's selected for the overview panel. No continuous polling for inactive projects. This keeps file reads to ~1-2 per project switch, not 15+ per interval.

## System-Wide Impact

- **Interaction graph:** SessionIndexService listens to ClaudeHookWatcher state changes → reads sessions-index.json → pushes via IPC → projectStore updates → TerminalListItem/ProjectOverview re-render
- **Error propagation:** SessionIndexService errors (file not found, parse failure) are logged and result in missing summaries — never crash the app or block terminal functionality
- **State lifecycle risks:** sessions-index.json is written by an external process (Claude Code). We are read-only. Risk of reading a partially-written file — mitigate with try/catch on JSON parse
- **API surface parity:** New IPC channels (`terminal:summary`, `session-index:getForProject`) follow existing patterns and must be added to preload whitelist
- **Unchanged invariants:** Terminal creation, state detection, session resume, and all existing Claude Code functionality remain unmodified. This feature is purely additive read-only access to existing data

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| sessions-index.json format changes in future Claude Code versions | Validate schema on read, gracefully degrade to no-summary state |
| Large sessions-index.json for very active projects | Cap entries read to 100 most recent, file is typically <100KB |
| Partial JSON write by Claude Code during read | Try/catch on JSON.parse, retry on next state change |
| Path encoding mismatch between our code and Claude Code | Verified identical encoding in `verifyClaudeSessionAsync()` — extract to shared utility |
| Summary not yet available for brand-new session | Show firstPrompt as fallback, or no summary — both acceptable |

## Sources & References

- Path encoding: `electron/main/index.ts:161`
- BiMap session mapping: `electron/main/services/ClaudeHookWatcher.ts`
- State change listener: `electron/main/services/AutomationService.ts:152-163`
- Session persistence: `electron/main/services/ProjectPersistence.ts:44-59`
- Sidebar rendering: `src/components/Sidebar/TerminalListItem.tsx`
- Learnings: `docs/solutions/integration-issues/claude-status-indicator-hook-watcher-session-matching.md`
- Learnings: `docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md`
- Learnings: `docs/solutions/performance-issues/terminal-lru-pooling-memory-optimization.md`
- Claude Code sessions-index.json: `~/.claude/projects/{encoded-path}/sessions-index.json`
