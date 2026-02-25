---
title: "Claude status indicator broken on Windows — case-sensitive cwd matching and mixed state file format"
date: 2026-02-25
status: resolved
severity: high
category: integration-issues
platform: windows
pr_number: 50
tags:
  - status-indicator
  - windows
  - case-sensitivity
  - path-normalization
  - hook-system
  - state-file-parsing
  - performance
component:
  - ClaudeHookWatcher
  - HookInstaller
  - claude-state-hook.cjs
  - paths utility
symptoms:
  - Status indicator dots never change from default state
  - Hooks are installed and firing (verified in state file) but UI shows no state changes
  - Multiple concurrent sessions not tracked correctly
root_causes:
  - Case-sensitive path comparison on Windows (normalizePath missing toLowerCase)
  - normalizeStateFile short-circuits on mixed-format JSON, dropping nested sessions
  - Missing SessionEnd hook event in HookInstaller
  - Excessive PreToolUse process spawning on Windows
---

# Claude Status Indicator Broken on Windows

## Problem

The Claude status indicator (colored dots: blue=busy, orange=permission/question, green=done) was completely non-functional. The dots never changed from their default state despite hooks being correctly installed in `~/.claude/settings.json` and actively writing state to `~/.claude/command-center-state.json`.

**Observable symptoms:**
- Status indicator dots stuck in default state regardless of Claude activity
- State file had recent timestamps showing active sessions (hooks were firing)
- Multiple Claude sessions showed the same static state

## Investigation

1. **Verified hooks were installed** — `~/.claude/settings.json` contained hook registrations with `async: true`
2. **Verified hooks were firing** — `~/.claude/command-center-state.json` had recent timestamps
3. **Traced the data flow** — Hook fires → script writes state → ClaudeHookWatcher polls → matches session to terminal via cwd → emits IPC event
4. **Found the break point** — Session-to-terminal matching failed silently because `cwdToTerminals` Map lookups returned `undefined`
5. **Identified four interconnected bugs** (see Root Causes below)

## Root Causes

### Bug 1: Case-sensitive path comparison on Windows (Critical)

`normalizePath()` only converted backslashes to forward slashes. It did NOT normalize case. Claude Code reports cwd inconsistently (`c:\Users\...` vs `C:\Users\...`). The `cwdToTerminals` Map uses strict string equality, so `c:/Users/foo` !== `C:/Users/foo`.

**Before:**
```typescript
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}
```

**After:**
```typescript
export function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, '/')
  if (normalized.length > 1 && normalized.endsWith('/') && !/^[a-zA-Z]:\/$/.test(normalized)) {
    normalized = normalized.slice(0, -1)
  }
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase()
  }
  return normalized
}
```

**File:** `electron/main/utils/paths.ts`

### Bug 2: Mixed state file format drops sessions (Critical)

The state file evolved from single-session (flat fields at root) to multi-session (nested by session_id). During transition, files contained both formats simultaneously. `normalizeStateFile()` checked `isHookStateData(rootObj)` first — since the root had all required fields, it short-circuited and returned only one entry, dropping all nested sessions.

**Real-world corrupted file:**
```json
{
  "session_id": "50bf7487-...",
  "cwd": "c:\\Users\\RemcoVolmer\\Code\\command",
  "state": "busy",
  "timestamp": 1770294770449,
  "hook_event": "UserPromptSubmit",
  "0b5bf2fb-...": {
    "session_id": "0b5bf2fb-...",
    "state": "done",
    "timestamp": 1771949058826
  },
  "a15d1620-...": {
    "session_id": "a15d1620-...",
    "state": "busy",
    "timestamp": 1771949160554
  }
}
```

Old code returned only the root entry. Fixed by iterating all keys first, collecting nested sessions, then falling back to legacy format only if no nested entries found.

**File:** `electron/main/services/ClaudeHookWatcher.ts`

### Bug 3: Missing SessionEnd hook event (Important)

`HookInstaller` registered 6 events but omitted `SessionEnd`. `ClaudeHookWatcher` had a handler for it (`clearSessionMappingBySession`), but it was never triggered. Session mappings were never cleaned up on normal exit, causing stale associations on restart.

**Fix:** Added `'SessionEnd'` to `hookEvents` array in `HookInstaller.ts` and `SessionEnd` case in `claude-state-hook.cjs`.

**Files:** `electron/main/services/HookInstaller.ts`, `electron/main/hooks/claude-state-hook.cjs`

### Bug 4: Excessive PreToolUse process spawning (Secondary)

`PreToolUse` fires on every tool call. Each spawns a new `node` process (~150-300ms startup on Windows). During active work with 10-50+ tool calls per response, this caused CPU/disk contention.

**Fix:** Skip redundant writes when session state is already `busy`. Reduces file writes by ~80%.

**File:** `electron/main/hooks/claude-state-hook.cjs`

## Solution Summary

| Bug | File | Fix | Impact |
|-----|------|-----|--------|
| Case sensitivity | `paths.ts` | `.toLowerCase()` on Windows | Critical — breaks all matching |
| Mixed format | `ClaudeHookWatcher.ts` | Iterate all keys, fallback only if empty | Critical — drops sessions |
| Missing SessionEnd | `HookInstaller.ts` + `claude-state-hook.cjs` | Add to events + handler | Important — stale mappings |
| PreToolUse overhead | `claude-state-hook.cjs` | Skip redundant busy writes | Secondary — ~80% fewer writes |

## Key Design Decisions

1. **Full `.toLowerCase()` on Windows** — Applied to entire path, not just drive letter. NTFS is case-insensitive, so this is safe and prevents any future case mismatch.
2. **Iterate-first, fallback-second** — `normalizeStateFile()` always iterates all keys to collect nested sessions. Legacy format is only used as fallback when zero nested entries are found. This handles mixed format correctly.
3. **Single file read in hook script** — The skip-busy optimization reuses the already-parsed state from the read-merge-write pattern, avoiding a double file read.
4. **Exported functions for testability** — `isHookStateData()` and `normalizeStateFile()` are exported as standalone functions, enabling comprehensive unit testing without mocking the class.

## Prevention Strategies

### Windows path comparison
- Always use `normalizePath()` before any path comparison or Map lookup
- Consider a branded `NormalizedPath` type to enforce normalization at compile time
- Test with both `c:` and `C:` drive letter variants

### External JSON format handling
- Add `format_version` field to external JSON files
- Never short-circuit parsing when multiple formats are possible — iterate all keys first
- Include real-world corrupted data in test suites

### Hook event registration completeness
- Define `MONITORED_HOOK_EVENTS` constant in one shared location
- Both installer and watcher should reference the same constant
- Pair lifecycle events: every `SessionStart` needs a `SessionEnd`

### High-frequency event performance
- Identify high-frequency events at design time (PreToolUse fires per tool call)
- Implement redundancy detection: skip writes when state hasn't changed
- Use `async: true` with timeout guards for hook execution

## Test Coverage

- **9 tests** for `normalizePath` — case normalization, trailing slashes, drive roots, UNC paths
- **13 tests** for `isHookStateData` + `normalizeStateFile` — valid/invalid data, mixed format, legacy format, real-world corrupted file

## Related Documents

- **Plan:** `docs/plans/2026-02-24-fix-claude-status-indicator-hooks-plan.md`
- **PR:** [#50](https://github.com/remcovolmer/command/pull/50)
- **Prerequisite:** [#49](https://github.com/remcovolmer/command/pull/49) — Window freeze fix (eliminated 3-10s startup freeze that previously made hooks unusable)
- **Related todo:** `todos/043-pending-p1-hookwatcher-dropped-state-changes.md` — pendingRead flag fix (already applied)
- **Related todo:** `todos/025-pending-p3-paths-match-case-sensitivity.md` — path case sensitivity
- **Related solution:** `docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md` — Promise-chain serialization pattern

## Files Modified

| File | Change |
|------|--------|
| `electron/main/utils/paths.ts` | Case-insensitive normalization, trailing slash + drive root handling |
| `electron/main/services/ClaudeHookWatcher.ts` | Fix `normalizeStateFile()`, export functions for testing |
| `electron/main/services/HookInstaller.ts` | Add `SessionEnd` to hook events |
| `electron/main/hooks/claude-state-hook.cjs` | Add `SessionEnd` case, skip redundant busy writes, single file read |
| `test/paths.test.ts` | 9 new tests |
| `test/claudeHookWatcher.test.ts` | 13 new tests |
