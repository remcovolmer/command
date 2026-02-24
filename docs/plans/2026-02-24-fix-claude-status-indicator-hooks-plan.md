---
title: "fix: Claude status indicator hooks broken on Windows"
type: fix
status: active
date: 2026-02-24
---

# fix: Claude status indicator hooks broken on Windows

## Overview

The Claude status indicator (colored dots: blue=busy, orange=permission/question, green=done, red=stopped) doesn't work. The hooks ARE installed and writing state to `~/.claude/command-center-state.json`, but the `ClaudeHookWatcher` fails to match sessions to terminals due to two bugs: case-sensitive path comparison on Windows and a state file format parsing error.

Previously, hooks were removed because Claude Code appeared to freeze when they were active. This was likely caused by excessive `node` process spawning on Windows (each hook event = new `node` process, ~150-300ms startup each).

## Problem Statement

**Symptoms:**
- Status indicator dots never change from default state
- Hooks are installed (verified in `~/.claude/settings.json`) and firing (verified in state file)
- State file has recent timestamps showing active sessions

**Root causes (confirmed via code analysis):**

1. **Case-sensitive cwd matching on Windows** (`normalizePath` bug) — `normalizePath()` at `electron/main/utils/paths.ts:4` only converts backslashes to forward slashes. It does NOT normalize drive letter case. Claude Code reports cwd inconsistently (`c:\Users\...` vs `C:\Users\...`). The `cwdToTerminals` Map in `ClaudeHookWatcher` uses strict string equality, so `c:/Users/foo` ≠ `C:/Users/foo`. **This alone completely breaks session-to-terminal matching.**

2. **Mixed state file format drops sessions** (`normalizeStateFile` bug) — The `command-center-state.json` file currently contains legacy flat fields at root level alongside proper nested session entries. `normalizeStateFile()` at `ClaudeHookWatcher.ts:207` checks `isHookStateData(rootObj)` first — since the root has `session_id`, `state`, `timestamp`, `hook_event` fields, it matches and returns only one entry. **All other nested sessions are dropped.**

3. **Missing `SessionEnd` hook** — `HookInstaller.ts:83` doesn't include `SessionEnd` in the events list, but `ClaudeHookWatcher.ts:282` handles it. Session mappings never get cleaned up when Claude exits normally, causing stale associations on session restart.

4. **Windows process spawning overhead** (secondary) — `PreToolUse` fires on every tool use, each spawning `node`. On Windows with rapid tool calls (10-50+ per response), dozens of concurrent `node` processes cause CPU/disk contention.

## Proposed Solution

Four targeted fixes, ordered by impact:

### Fix 1: Case-insensitive path normalization (Critical)

**File:** `electron/main/utils/paths.ts`

```typescript
export function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, '/')
  // Remove trailing slash (except root like C:/)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  // Windows: NTFS is case-insensitive, normalize to lowercase
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase()
  }
  return normalized
}
```

This fixes the primary bug. Both `ClaudeHookWatcher.registerTerminal()` and `ClaudeHookWatcher.processSessionState()` call `normalizePath()`, so both sides will produce matching lowercase paths.

### Fix 2: Fix `normalizeStateFile` mixed format handling (Critical)

**File:** `electron/main/services/ClaudeHookWatcher.ts`

Current logic short-circuits when root matches `isHookStateData()`. Fix: always iterate all top-level keys and collect valid session entries.

```typescript
private normalizeStateFile(parsed: unknown): MultiSessionState {
  if (!parsed || typeof parsed !== 'object') return {}
  const obj = parsed as Record<string, unknown>
  const result: MultiSessionState = {}

  // Check each top-level key for valid session data
  for (const [key, value] of Object.entries(obj)) {
    if (isHookStateData(value)) {
      result[key] = value
    }
  }

  // Handle legacy single-session format (flat fields at root)
  if (Object.keys(result).length === 0 && isHookStateData(obj)) {
    result[obj.session_id] = obj as unknown as HookStateData
  }

  return result
}
```

### Fix 3: Add `SessionEnd` hook event (Important)

**File:** `electron/main/services/HookInstaller.ts` — add `'SessionEnd'` to `hookEvents` array.

**File:** `electron/main/hooks/claude-state-hook.cjs` — add `SessionEnd` case:
```javascript
case 'SessionEnd':
  state = 'done';
  break;
```

### Fix 4: Reduce hook overhead on Windows (Secondary)

Two options (choose one):

**Option A: Batch/debounce in hook script** — Instead of read-modify-write per event, use a simple append-only format and batch processing in the watcher. More invasive change.

**Option B: Skip redundant `PreToolUse` busy events** — In the hook script, skip writing if the session's state is already `busy` (read-only check before write). Reduces writes by ~80% during active Claude work.

**Recommended: Option B** — Minimal change. In `claude-state-hook.cjs`, after determining `state = 'busy'` from `PreToolUse`, check if the session's existing state is already `busy` and skip the write:

```javascript
// For PreToolUse with non-question state, skip if already busy
if (hookEvent === 'PreToolUse' && state === 'busy') {
  try {
    const existing = await fs.promises.readFile(stateFile, 'utf-8');
    const parsed = JSON.parse(existing);
    if (parsed[data.session_id]?.state === 'busy') {
      process.exit(0); // Already busy, skip write
    }
  } catch (e) {
    // File doesn't exist or can't parse, proceed with write
  }
}
```

## Acceptance Criteria

- [ ] Status indicator shows correct colors when Claude is busy/done/asking/needs-permission
- [ ] Status works with multiple concurrent Claude sessions in different projects
- [x] Case-insensitive path matching on Windows (drive letter `c:` vs `C:`)
- [x] Mixed-format state file parsed correctly (no dropped sessions)
- [x] `SessionEnd` hook installed and cleaned up on session exit
- [x] No observable performance degradation or freezing from hooks
- [x] Existing tests pass (`npm run test`)
- [x] New tests for `normalizePath` case normalization
- [x] New tests for `normalizeStateFile` mixed format handling

## Files to Modify

| File | Change |
|------|--------|
| `electron/main/utils/paths.ts` | Case-insensitive normalization, trailing slash removal |
| `electron/main/services/ClaudeHookWatcher.ts` | Fix `normalizeStateFile()` mixed format handling |
| `electron/main/services/HookInstaller.ts` | Add `SessionEnd` to hook events |
| `electron/main/hooks/claude-state-hook.cjs` | Add `SessionEnd` case, skip redundant busy writes |

## Dependencies & Risks

- **Risk:** Full `.toLowerCase()` on Windows paths could break case-sensitive comparisons elsewhere. Mitigated by: only applying in `normalizePath()` which is already the single normalization point.
- **Risk:** Hooks may still cause issues with newer Claude Code versions. Mitigated by: `async: true` + timeout, plus skip-redundant-busy optimization.
- **Risk:** Cleaning the state file of legacy entries could briefly lose state for an active session. Mitigated by: next hook event self-heals within milliseconds.

## Sources & References

- `electron/main/utils/paths.ts:4` — normalizePath only does backslash→forward slash
- `electron/main/services/ClaudeHookWatcher.ts:207-227` — normalizeStateFile short-circuits on legacy format
- `electron/main/services/HookInstaller.ts:83-90` — hookEvents array missing SessionEnd
- `~/.claude/command-center-state.json` — verified mixed format with legacy root fields
- `~/.claude/settings.json` — verified hooks are installed with async:true, timeout:5
- `docs/plans/2026-02-24-fix-window-freeze-on-startup-and-restore-plan.md` — previous startup freeze fix
- `todos/043-pending-p1-hookwatcher-dropped-state-changes.md` — related dropped state fix (already applied)
