---
title: "feat: Ollama-powered session titles, summaries, and metadata"
type: feat
status: active
date: 2026-04-11
---

# Ollama-powered session titles, summaries, and metadata

## Overview

Replace the empty/shallow session summaries in Command Center with rich, LLM-generated titles and summaries from a local Ollama model. Additionally, extract structured metadata (files changed, tools used, errors, duration) directly from the JSONL session files without needing an LLM. This makes the sidebar, SessionsPanel, and ProjectOverview actually useful for understanding what happened in each session.

## Problem Frame

Current session display shows almost nothing useful:
- **summary**: Empty in ~90% of sessions (only populated when Claude Code runs context compaction)
- **title**: First 40 chars of user's first message — "Add error handling to auth module" tells you the request, not the outcome
- **firstPrompt**: First 200 chars of user input — same problem

A session where Claude modified 4 files, fixed 3 bugs, and ran 10 tests shows up as just "Add error handling to auth module" with no indication of what actually happened.

Now that Ollama is available locally, we can generate real summaries at zero API cost.

## Requirements Trace

- R1. Generate a concise session title (max 60 chars) via Ollama that describes what was accomplished
- R2. Generate a 1-3 sentence summary via Ollama that captures the key actions and outcomes
- R3. Extract metadata from JSONL without LLM: files modified, tools used (with counts), session duration, error count, user message count
- R4. Trigger summary generation via personal Claude Code `Stop` hook — fires after every Claude response. First time: generate title + short summary. Later: regenerate when messageCount grows by >3.
- R5. Store generated summaries in `~/.claude/session-summaries.json` — shared between hook and Electron app
- R6. Display enriched data in TerminalListItem (sidebar), SessionsPanel, and ProjectOverview
- R7. Fail silently if Ollama is unavailable — fall back to current behavior (firstPrompt)
- R8. Summary generation must not block Claude or the Electron UI

## Scope Boundaries

- No editing of Claude Code's own session files (sessions-index.json or .jsonl files)
- No cloud API calls — Ollama only
- No real-time streaming summaries during active sessions
- No summary regeneration UI (v1 generates once per threshold, caches)

### Deferred to Separate Tasks

- Manual "regenerate summary" button per session
- Summary quality improvements (prompt tuning) after initial deployment
- Cross-session analysis ("what did I work on this week?")

## Context & Research

### Existing Pattern: claude-state-hook.cjs

The `claude-state-hook.cjs` (`electron/main/hooks/claude-state-hook.cjs`) is the direct template for the summary hook. Key patterns:

- **Standalone Node.js CJS script** — no Electron dependencies, no npm packages, only `fs`, `path`, `os`
- **Reads JSON from stdin** — `process.stdin.on('data')` + `process.stdin.on('end')`
- **Shared state file** — writes to `~/.claude/command-center-state.json`, read by Electron app via `ClaudeHookWatcher`
- **Atomic write** — temp file + `fs.promises.rename` to avoid partial reads
- **Read-merge-write** — reads existing state, adds/updates this session's entry, writes back. Last-writer-wins for concurrent writes.
- **UUID validation** — validates `session_id` format before processing
- **Skip redundant writes** — checks if state already matches before writing (saves ~80% of disk writes)
- **Silent failure** — all errors caught, `process.exit(0)` always
- **Async hook** — registered with `"async": true` in settings.json, never blocks Claude
- **Stale cleanup** — removes entries older than 1 hour on each write

The summary hook follows this exact same pattern, with the addition of an Ollama HTTP call.

### Current SessionIndexService Data Flow

```
JSONL files → parseSessionJsonl() → SessionIndexEntry { summary=firstPrompt } → cache Map → renderer
```

`parseSessionJsonl()` reads JSONL line-by-line. Extracts: firstPrompt, gitBranch, messageCount, timestamps, compactSummary. Single-pass, streamed read.

### JSONL Message Structure (from session analysis)

Messages have `type` field (not `role`). Structure:
- `type: "user"` — `message.content` is string or has content blocks
- `type: "assistant"` — `message.content[]` contains `tool_use` blocks with `name` and `input`
- `type: "user"` with `tool_result` — content blocks have `type: "tool_result"`, `is_error` field
- Tool use: `{ type: "tool_use", name: "Edit", input: { file_path: "..." } }`

### Where State File Lives

- State hook writes to: `~/.claude/command-center-state.json`
- `ClaudeHookWatcher` polls this file every 250ms
- Same pattern for summaries: `~/.claude/session-summaries.json`
- Both hook and Electron app know `~/.claude/` — no Electron `userData` dependency

### Display Components

- **TerminalListItem**: `terminal.title` + `terminal.summary` (10px muted)
- **SessionsPanel**: title + summary + time + branch
- **ProjectOverview**: summary/firstPrompt + branch + messageCount + time

## Key Technical Decisions

- **Hook-only architecture**: All Ollama interaction lives in the standalone hook script (`session-summary-hook.cjs`). The Electron app only reads the cache file. No `SessionSummaryGenerator` service in the Electron app — that would duplicate logic and create two code paths to maintain.
- **Same pattern as state hook**: Standalone CJS, stdin JSON, atomic write to `~/.claude/`, silent failure. Proven pattern, zero new dependencies.
- **Cache at `~/.claude/session-summaries.json`**: Both hook and Electron app can access `~/.claude/`. Using Electron's `userData` would require the hook to know the Electron app data path — unnecessary coupling.
- **JSONL parsing in both hook and app**: The hook parses JSONL for Ollama prompt context (user messages, files, tools). The Electron app parses JSONL for display metadata (same data). This is intentional duplication — each system is independent. The hook's parsing is compact (only what Ollama needs), the app's parsing is for display.
- **`gemma4:e4b` for summaries**: Efficient, fast, good for text comprehension.
- **Compact prompt**: First 3 user messages (truncated to 200 chars each) + files modified list + tool counts + error count + duration. ~500 tokens input.
- **Single Stop hook**: Fires after every Claude response. Decision logic:
  - No cache entry → GENERATE (first title + summary after first response)
  - Cache entry but messageCount grew by >3 → REGENERATE (summary improves)
  - Otherwise → SKIP (no Ollama call, instant exit)
- **Concurrency via skip-if-busy**: If lockfile held by another hook instance → skip, next Stop retries. Same philosophy as state hook's "skip redundant busy writes".
- **`SessionIndexEntry` extended, not replaced**: New optional fields. All existing consumers backward compatible.

## Open Questions

### Resolved During Planning

- **Q: Where to store summaries?** → `~/.claude/session-summaries.json`. Accessible to both hook and Electron app.
- **Q: Ollama integration in hook or Electron app?** → Hook only. Electron app just reads cache. Same separation as state hook (hook writes state, `ClaudeHookWatcher` reads it).
- **Q: Which model?** → `gemma4:e4b`.
- **Q: When to generate?** → `Stop` hook only. First time = title + summary. Regenerate when messageCount grows by >3.
- **Q: SessionStart needed?** → No. Stop fires after first response = first useful context. SessionStart fires before any content exists.
- **Q: Block Claude?** → No. `async: true` on the hook. Fire-and-forget.

### Deferred to Implementation

- Exact prompt wording for title vs summary generation
- How to handle very long sessions (>1000 messages) — may subsample user messages
- Whether Ollama's JSON schema format works reliably with gemma4:e4b

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
Two independent systems that share a cache file (same pattern as state hook):

═══ HOOK SIDE (standalone Node.js, runs per Claude response) ═══

Claude responds → Stop hook fires → session-summary-hook.cjs (async)
         │
         ▼
Read stdin: { session_id, cwd }
Read cache: ~/.claude/session-summaries.json
         │
  ├── No entry? → GENERATE
  ├── messageCount grew by >3? → REGENERATE  
  └── Otherwise → exit 0 (skip)
         │
         ▼ (only if generating)
Acquire lockfile (~/.claude/session-summaries.lock)
  ├── Lock held → exit 0 (next Stop retries)
  └── Acquired ▼
         │
Parse JSONL: ~/.claude/projects/{encoded-cwd}/{session_id}.jsonl
  → user messages, files modified, tool counts, errors, duration
         │
POST http://localhost:11434/api/chat (gemma4:e4b, format: schema)
         │
Atomic write: read cache → merge entry → temp file → rename
Release lockfile → exit 0


═══ ELECTRON APP SIDE (reads cache, displays data) ═══

SessionIndexService.loadForProject()
  │
  ├── parseSessionJsonl() — EXTENDED with metadata
  │   (filesModified, toolCounts, errorCount, durationMs)
  │
  ├── Read ~/.claude/session-summaries.json
  │   Merge generatedTitle + generatedSummary into entries
  │
  └── fs.watch(session-summaries.json) → push updates to renderer

Renderer shows:
  TerminalListItem: generatedTitle || title + generatedSummary || summary
  SessionsPanel:    + metadata badges (files, duration, errors)
  ProjectOverview:  + metadata badges
```

## Implementation Units

- [ ] **Unit 1: Extend JSONL parser with metadata extraction**

  **Goal:** Extract files modified, files read, tool usage counts, error count, duration, and assistant message count from session JSONL files during the existing Electron app scan.

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Modify: `electron/main/services/SessionIndexService.ts` — extend `parseSessionJsonl()` and `SessionIndexEntry`
  - Modify: `src/types/index.ts` — extend `SessionIndexEntry` interface

  **Approach:**
  - Add fields to `SessionIndexEntry`: `filesModified`, `filesRead`, `toolCounts`, `errorCount`, `durationMs`, `assistantMessageCount`
  - In the existing `for await (const line of rl)` loop:
    - Track `tool_use` blocks in assistant messages (`message.content[]` where `type: "tool_use"`): extract `name` for toolCounts, extract `input.file_path` for Edit/Write/Read
    - Track `tool_result` blocks in user messages (content blocks with `type: "tool_result"`): count `is_error: true`
    - Count assistant-type messages
    - Duration: diff between first and last timestamp (already tracked as `created`/`modified`)
  - Deduplicate file lists (Set → Array)
  - All new fields optional with defaults for backward compat

  **Patterns to follow:**
  - Existing `parseSessionJsonl()` — extend the same loop, same message structure handling

  **Test scenarios:**
  - Happy path: Session with 3 Edit calls on 2 unique files → `filesModified` has 2 entries, `toolCounts.Edit = 3`
  - Happy path: Session with `is_error: true` results → `errorCount > 0`
  - Edge case: Empty session (only system/attachment lines) → all metadata at defaults
  - Edge case: Malformed JSONL lines → skipped without crashing (existing behavior)

  **Verification:**
  - Log metadata for a real session, spot check against manual JSONL inspection
  - Existing ProjectOverview and SessionsPanel still work, no regressions

- [ ] **Unit 2: Stop hook script — summary generation via Ollama**

  **Goal:** Create a standalone Node.js hook script that generates session titles and summaries via Ollama, writing to a shared cache file.

  **Requirements:** R1, R2, R4, R5, R7, R8

  **Dependencies:** None (standalone script, no app dependency)

  **Files:**
  - Create: `~/.claude/hooks/session-summary-hook.cjs`

  **Approach:**
  - Follow `electron/main/hooks/claude-state-hook.cjs` pattern exactly:
    - Read JSON from stdin (`session_id`, `cwd`)
    - Validate `session_id` UUID format
    - Read cache file `~/.claude/session-summaries.json` (read-merge-write)
    - Silent failure throughout (`try/catch`, `process.exit(0)`)
  - **Decision logic** (cheap, no Ollama call):
    1. No cache entry for `session_id` → GENERATE
    2. Entry exists, fast-count user messages in JSONL. If grew by >3 since `cachedMessageCount` → REGENERATE
    3. Otherwise → exit 0
  - **Generation** (only when needed):
    1. Acquire lockfile (`~/.claude/session-summaries.lock` with PID + timestamp). If held → exit 0
    2. Parse JSONL at `~/.claude/projects/{encoded-cwd}/{session_id}.jsonl`:
       - First 3 user messages (truncated 200 chars each)
       - Files modified (from `tool_use` Edit/Write blocks)
       - Tool name counts
       - Total user message count
    3. HTTP POST to `http://localhost:11434/api/chat` via Node.js `http` module:
       - Model: `gemma4:e4b`
       - Format: JSON schema `{ title: string, summary: string }`
       - `stream: false`, `temperature: 0`
       - Timeout: 15 seconds
    4. Atomic write: read cache → add `{ title, summary, messageCount, generatedAt }` → temp file → rename
    5. Release lockfile
  - `encodeProjectPath()`: inline the same regex as state hook uses (`cwd.replace(/[/\\:]/g, '-').replace(/^-/, '')`)
  - Stale lockfile cleanup: if lockfile PID is dead or timestamp >60s old, clean up and proceed

  **Patterns to follow:**
  - `electron/main/hooks/claude-state-hook.cjs` — stdin reading, atomic write, read-merge-write, UUID validation, silent failure, stale cleanup

  **Test scenarios:**
  - Happy path: First Stop → no cache entry → parses JSONL → calls Ollama → writes cache with title + summary
  - Happy path: 5th Stop → messageCount grew by 4 → regenerates with richer context
  - Happy path: 6th Stop → grew by 1 → skips (threshold not met)
  - Edge case: Ollama not running → HTTP connection refused → exit 0 silently
  - Edge case: JSONL file doesn't exist yet → skip gracefully
  - Edge case: Two sessions Stop simultaneously → lockfile serializes, second skips
  - Edge case: Stale lockfile (crashed process) → PID check, clean up, proceed
  - Edge case: Cache file doesn't exist → create new one
  - Edge case: Cache file corrupted JSON → start fresh
  - Error path: Ollama returns non-JSON → caught, exit 0
  - Error path: Ollama timeout → caught, exit 0

  **Verification:**
  - Manual test: `echo '{"session_id":"...","cwd":"...","hook_event_name":"Stop"}' | node ~/.claude/hooks/session-summary-hook.cjs`
  - Check `~/.claude/session-summaries.json` has entry with title + summary
  - Kill Ollama → hook exits cleanly, cache unchanged

- [ ] **Unit 3: Register Stop hook in personal settings**

  **Goal:** Add the Stop hook to `~/.claude/settings.json`.

  **Requirements:** R4

  **Dependencies:** Unit 2

  **Files:**
  - Modify: `~/.claude/settings.json`

  **Approach:**
  - Add to existing `hooks.Stop` array (alongside the Command Center state hook)
  - `async: true` — fire-and-forget, never block Claude
  - Timeout: 30 seconds (generous for Ollama cold start)
  - Both hooks in the Stop array fire independently

  **Test scenarios:**
  - Happy path: Claude responds → both state hook and summary hook fire
  - Edge case: Summary hook fails → state hook unaffected (independent entries in array)
  - Integration: End a Claude session → `session-summaries.json` has new entry

  **Verification:**
  - `cat ~/.claude/settings.json | jq '.hooks.Stop'` shows both hooks
  - Start Claude session, send message → cache file gets populated

  **Test expectation: none** — pure config, verified manually

- [ ] **Unit 4: Electron app reads hook-generated summaries**

  **Goal:** Make SessionIndexService read from the hook's cache file and merge generated titles/summaries into session entries. Watch for changes.

  **Requirements:** R5, R6, R8

  **Dependencies:** Unit 1, Unit 2

  **Files:**
  - Modify: `electron/main/services/SessionIndexService.ts` — read + watch cache, merge into entries
  - Modify: `src/types/index.ts` — add `generatedTitle`, `generatedSummary` to types

  **Approach:**
  - On `loadForProject()` / `scanJsonlFiles()`: after JSONL scan, read `~/.claude/session-summaries.json`
  - For each `SessionIndexEntry`: if cache has entry for `sessionId`, set `generatedTitle` and `generatedSummary`
  - `fs.watch('~/.claude/session-summaries.json')` — on change, re-read cache and push updates to renderer
  - Extend `pushSummaryToRenderer()` to prefer `generatedTitle`/`generatedSummary` over raw firstPrompt
  - Extend types: `SessionIndexEntry` and `TerminalSession` get optional `generatedTitle?: string`, `generatedSummary?: string`
  - Fallback: cache missing or unreadable → existing firstPrompt behavior

  **Patterns to follow:**
  - `ClaudeHookWatcher` pattern — polls/watches a file written by a hook, pushes state to renderer
  - Existing `pushSummaryToRenderer()` for the IPC channel

  **Test scenarios:**
  - Happy path: Cache has summary for session → entry shows generatedTitle + generatedSummary
  - Happy path: Cache updated by hook while app running → fs.watch fires → UI updates
  - Edge case: Cache file missing → graceful fallback to firstPrompt
  - Edge case: Cache has entry for unknown sessionId → ignored
  - Edge case: Cache file written atomically (temp+rename) → no partial reads

  **Verification:**
  - Generate summary via hook → restart Command Center → sessions show generated titles
  - Generate summary while app running → sidebar updates within a few seconds

- [ ] **Unit 5: Update UI components to show enriched data**

  **Goal:** Display LLM-generated titles, summaries, and metadata badges in sidebar, SessionsPanel, and ProjectOverview.

  **Requirements:** R6

  **Dependencies:** Unit 1, Unit 4

  **Files:**
  - Modify: `src/components/Sidebar/TerminalListItem.tsx`
  - Modify: `src/components/FileExplorer/SessionsPanel.tsx`
  - Modify: `src/components/ProjectOverview.tsx`

  **Approach:**
  - **TerminalListItem**: Show `generatedTitle || terminal.title` as primary line, `generatedSummary || terminal.summary` as secondary
  - **SessionsPanel**: Add metadata row below summary: files changed count, duration, error count (if >0)
  - **ProjectOverview**: Add metadata badges alongside existing gitBranch + messageCount: files changed, duration, errors (if >0)
  - Badges: `text-[10px] text-muted-foreground`, icon + number format
  - Graceful degradation: no generatedTitle → show firstPrompt (current behavior unchanged)

  **Patterns to follow:**
  - Existing badge pattern in `ProjectOverview.tsx` (gitBranch + messageCount with lucide icons)
  - Existing conditional rendering (`{terminal.summary && (...)}`)

  **Test scenarios:**
  - Happy path: Session with generated summary → shows LLM title + summary + metadata
  - Happy path: Session without summary → falls back to firstPrompt
  - Edge case: 0 files modified → no files badge
  - Edge case: Session with errors → error badge shown
  - Edge case: Very short session → "<1m" duration or skip badge

  **Verification:**
  - Visual: sidebar shows meaningful titles instead of first user message
  - Visual: ProjectOverview shows metadata badges
  - Visual: sessions without summaries look identical to current behavior

## System-Wide Impact

- **Interaction with existing state hook**: Both hooks in `Stop` array, fire independently. Summary hook adds a second entry, doesn't interfere with state tracking.
- **Shared file pattern**: `~/.claude/session-summaries.json` follows same pattern as `~/.claude/command-center-state.json`. Electron app watches file, hook writes file.
- **SessionIndexEntry**: Extended with optional fields. All existing consumers backward compatible.
- **JSONL parsing**: Both hook and app parse JSONL independently. Hook extracts prompt context for Ollama. App extracts metadata for display. Different purposes, acceptable duplication.
- **Ollama resource usage**: ~2s per generation on gemma4:e4b, ~500 input tokens. Most Stop events skip (cache hit or threshold not met). Model stays in memory after first call.
- **Performance**: Hook is async, never blocks Claude. App reads cache on scan + watches for changes. No blocking UI operations.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Ollama not running | Fall back to firstPrompt (current behavior). No degradation. |
| Too many Ollama calls (Stop fires every response) | Skip unless no cache entry or messageCount grew by >3. Most Stops do zero work. |
| Bad quality summaries | Can swap model later. Title + summary schema is model-independent. |
| Cache file corruption | Read in try/catch, start fresh on error. Atomic writes prevent partial corruption. |
| Concurrent sessions (parallel Stop hooks) | Lockfile serializes Ollama calls. Skip if locked — next Stop retries. |
| Old sessions without summaries | Get one when resumed (Stop fires after first response). Or: one-time backfill script. |
| fs.watch unreliable on some platforms | Debounce + periodic re-read as fallback |

## Sources & References

- State hook pattern: `electron/main/hooks/claude-state-hook.cjs`
- Hook watcher pattern: `electron/main/services/ClaudeHookWatcher.ts`
- Current session service: `electron/main/services/SessionIndexService.ts`
- Display components: `src/components/Sidebar/TerminalListItem.tsx`, `src/components/FileExplorer/SessionsPanel.tsx`, `src/components/ProjectOverview.tsx`
- Types: `src/types/index.ts`
- Ollama API: `POST /api/chat` with structured JSON format
- Prerequisite: Ollama installed (0.20.4), gemma4:e4b model available
