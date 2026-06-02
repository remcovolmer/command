---
title: "AskUserQuestion attention dot shows only intermittently — async hook write-order race clobbers input states"
date: 2026-06-02
status: resolved
severity: high
category: integration-issues
platform: windows
pr_number: 129
tags:
  - status-indicator
  - hook-system
  - async-timing
  - race-condition
  - askuserquestion
  - state-detection
  - dedup
  - windows
component:
  - claude-state-hook.cjs
  - ClaudeHookWatcher
symptoms:
  - "Orange attention dot in the sidebar appears only sometimes when Claude asks a question via AskUserQuestion"
  - "Quickly-answered questions never show the indicator; slowly-answered ones eventually turn orange after ~6s"
  - "The 'question' state is silently dropped — the terminal looks 'busy' (gray) instead of 'needs input'"
root_causes:
  - "Async hooks write the shared state file in nondeterministic order; a surrounding 'busy' write lands after the input-state write and erases it"
  - "Hook timestamp captured after the async file read, so a slow 'busy' gets a higher timestamp than an earlier 'question'"
  - "ClaudeHookWatcher dedup dropped the lower-timestamp input state as 'stale'"
---

# AskUserQuestion Attention Dot Shows Only Intermittently

## Problem

When Claude Code asked a question via the **AskUserQuestion** tool, the sidebar's orange "needs your input" dot appeared only *sometimes*. The terminal frequently stayed gray (`busy`) instead of turning orange, so the user had no reliable visual cue that Claude was waiting on them. Reproduction was flaky — the same action produced different outcomes.

This is the same subsystem as the earlier Windows status-indicator fix ([claude-status-indicator-hook-watcher-session-matching.md](./claude-status-indicator-hook-watcher-session-matching.md), PR #50) but a **distinct** bug: that one was case-sensitive `cwd` matching and mixed state-file format (dots *never* changed); this one is an async write-order race that suppresses *input* states specifically (dots change for everything except, intermittently, `question`/`permission`).

## Symptoms

- AskUserQuestion often failed to turn the indicator orange, or flickered orange then immediately went gray.
- The session read as "busy" rather than "needs your input."
- Intermittent and timing-dependent — not reproducible on demand by reading code.

## Investigation

The original hook carried an explicit assumption that turned out to be the bug:

> "Last-writer-wins race is acceptable here because state is self-healing — the next hook event will overwrite with fresh state within milliseconds."

That assumption is invisible when reading the code. The diagnostic step that cracked it was **temporarily instrumenting the global hook** to append every raw event (`hook_event_name`, `tool_name`, `notification_type`, `session_id`) to a log file, then triggering a *real* AskUserQuestion and reading the capture. (Editing `claude-state-hook.cjs` takes effect immediately — Claude execs it fresh per event — so no reinstall is needed to instrument it.)

The capture revealed that a single AskUserQuestion fires **three** events in rapid succession, not one:

```
t+0ms    PreToolUse        tool=AskUserQuestion      -> 'question'
t+8ms    PermissionRequest tool=AskUserQuestion      -> 'permission'
t+6s     Notification      ntype=permission_prompt   -> 'permission'   (delayed self-heal)
t+...    PreToolUse        tool=<next tool>          -> 'busy'         (after the user answers)
```

All three are orange, so the order *between them* is harmless. The damage comes from a surrounding `busy` write (a preceding tool call, or `UserPromptSubmit`) racing with them.

## Root Cause

The state file (`~/.claude/command-center-state.json`) is used as an **IPC channel between independent, async hook processes**. Hooks are registered `async: true`, and node-process startup on Windows varies ~150–300 ms — *larger* than the watcher's 250 ms poll interval. So:

1. A `busy` write from a near-simultaneous `PreToolUse`/`UserPromptSubmit` can land **after** the `question`/`permission` write and overwrite it — file-write order is determined by process scheduling, not event fire-order.
2. The hook timestamp is captured **after** the async file read (`timestamp: Date.now()` mid-handler), so a slow `busy` process gets a **higher** timestamp than a `question` that wrote earlier.
3. `ClaudeHookWatcher`'s dedup then dropped the lower-timestamp `question` as "stale," so even a correctly-written input state could be suppressed.

The +6s `Notification(permission_prompt)` **self-healed** slow-answered questions (it re-wrote `permission` once the race had settled), which is exactly why only *quickly-answered* questions — the ones answered before the heal — looked broken. That self-heal is what disguised a deterministic race as intermittent behavior.

## Solution

Two coordinated changes; neither alone is sufficient (the hook keeps the file from being clobbered; the watcher keeps an already-written input state from being dropped).

### 1. Hook (`claude-state-hook.cjs`) — protect freshly-surfaced input states

Decision logic extracted into pure functions (`mapEventToState`, `shouldSkipWrite`) behind `require.main === module`, so it is unit-testable without spawning processes.

**Before** — the only protection was redundant-busy suppression:

```js
if (hookEvent === 'PreToolUse' && state === 'busy') {
  if (allStates[data.session_id]?.state === 'busy') {
    process.exit(0); // Already busy, skip write
  }
}
```

**After** — a freshly-surfaced input state is protected, and downgrade writes re-read just before committing:

```js
const INPUT_STATE_GUARD_MS = 2500;
const INPUT_STATES = new Set(['question', 'permission']);

function shouldSkipWrite(current, incoming, now, guardMs = INPUT_STATE_GUARD_MS) {
  if (!current) return false;
  const cur = current.state;
  // 1. Redundant busy from PreToolUse — already busy.
  if (incoming.hook_event === 'PreToolUse' && incoming.state === 'busy' && cur === 'busy') return true;
  // 2. Protect a freshly-surfaced input state.
  if (INPUT_STATES.has(cur)) {
    const age = now - (current.timestamp || 0);
    if (incoming.state === 'busy' && age < guardMs) return true;             // racing busy, not a resume
    if (incoming.state === 'done' && incoming.hook_event === 'Notification') return true; // idle 'done' while input pending
  }
  return false;
}

// In the handler: skip on first read, then re-read before any downgrade write
// to catch an input state another hook process wrote AFTER our first read.
if (state === 'busy' || state === 'done') {
  const fresh = await readStates();
  if (shouldSkipWrite(fresh[data.session_id], stateData, Date.now())) process.exit(0);
  allStates = fresh;
}
```

Note the asymmetry: a real `Stop`/`SessionEnd` `done` is allowed through (it clears the dot once Claude truly finishes); only an **idle** `Notification` `done` is blocked while an input state is pending. An incoming input state is never skipped.

### 2. Watcher (`ClaudeHookWatcher.ts`) — don't drop input states as stale

**Before:**

```ts
if (hookState.timestamp < last.timestamp) {
  return  // Stale event
}
if (hookState.timestamp === last.timestamp && /* same event+state */) {
  return  // Duplicate re-read
}
```

**After** — the exact-duplicate check stays first (no spam); the stale check exempts a *new* input state:

```ts
if (hookState.timestamp === last.timestamp && hookState.hook_event === last.hookEvent && hookState.state === last.state) {
  return  // Duplicate re-read of unchanged session
}
const isInputState = hookState.state === 'question' || hookState.state === 'permission'
const surfacingNewInputState = isInputState && last.state !== hookState.state
if (hookState.timestamp < last.timestamp && !surfacingNewInputState) {
  return  // Stale event
}
```

### Summary

| Layer | File | Change | Why |
|-------|------|--------|-----|
| Hook | `claude-state-hook.cjs` | Skip a racing `busy` over a fresh input state (2.5s guard) + re-read before downgrade writes; block idle `done` over pending input | Keeps the file from being clobbered |
| Watcher | `ClaudeHookWatcher.ts` | Surface an input state even if a racing `busy` was seen first with a higher timestamp | Keeps an already-written input state from being dropped |
| Testability | `claude-state-hook.cjs` | Extract pure `mapEventToState`/`shouldSkipWrite` behind `require.main === module` | Race logic is unit-testable without processes |

## Why This Works

With last-writer-wins over an async IPC file, write order follows process scheduling, not event fire-order — so a routine `busy` could erase a rare `question`. The fix keys decisions on the **semantic state transition** (`last.state !== hookState.state`, "is the current on-disk state an input state"), not on timestamps — because post-read timestamps cannot be trusted to reconstruct fire-order across independent processes. A genuine "Claude resumed" `busy` fires only after the user answers (well beyond the 2.5s guard), so it still clears the dot.

## Key Design Decisions

1. **Guard window of 2.5 s** — covers node-startup variance plus several 250 ms poll cycles. A quickly-answered question leaves the dot orange for at most ~2.5 s before the next `busy` clears it; showing the dot reliably is worth that small lingering.
2. **Key on state transition, not timestamp** — timestamps are assigned at write time by whichever process runs first; the transition is the trustworthy signal.
3. **Re-read before downgrade writes only** — the extra read happens only on genuine `busy`/`done` transitions (consecutive `busy` are skipped early), preserving the ~80% write reduction from the original optimization.
4. **Asymmetric `done` handling** — block idle `Notification` `done` over a pending input state, allow real `Stop`/`SessionEnd` `done`.

## Prevention

- **User-input states must be sticky and take priority over transient `busy`.** `busy` is a routine high-frequency signal; `question`/`permission` is a rare signal the user must see. When they race, the input state wins for a guard window — never the reverse.
- **Never trust post-read timestamps to infer fire-order across async processes.** Decide on the semantic transition, not the clock.
- **Unit-test pure decision functions.** Extracting `mapEventToState`/`shouldSkipWrite` made the race logic testable without spawning processes.
- **Instrument the raw hook events when state behaves oddly.** The 3-event AskUserQuestion sequence was undocumented and only visible by logging raw `hook_event_name`/`tool_name`/`notification_type` from a live event.

## Test Coverage

- `test/claudeStateHook.test.ts` (new, 16 tests): event→state mapping (incl. `AskUserQuestion`→`question` and `PermissionRequest`→`permission`); `shouldSkipWrite` — racing `busy` over a fresh input state is skipped, an *old* input state lets `busy` through (genuine resume), idle `done` blocked, real `Stop` `done` allowed, an incoming input state is never skipped.
- `test/claudeHookWatcher.test.ts` (+2 tests): a `question` at `timestamp 1500` arriving after a `busy` at `timestamp 2000` still emits `terminal:state … 'question'`; an exact/older re-read of the same `permission` is not re-emitted (no spam).

## Related Documents

- **Sibling (same subsystem, different bug):** [claude-status-indicator-hook-watcher-session-matching.md](./claude-status-indicator-hook-watcher-session-matching.md) — its "Bug 4: skip redundant busy writes" optimization is the code this race exposed; its "last-writer-wins is acceptable" assumption is refined here. That doc is a refresh candidate.
- **PR:** #129
- **Prior art:** PR #50 (status indicator on Windows), PR #49 (window-freeze prerequisite).

## Files Modified

| File | Change |
|------|--------|
| `electron/main/hooks/claude-state-hook.cjs` | Extract pure `mapEventToState`/`shouldSkipWrite`; input-state guard + re-read before downgrade; idle-`done` block; `require.main` guard |
| `electron/main/services/ClaudeHookWatcher.ts` | Dedup no longer drops a newly-surfacing input state as stale |
| `test/claudeStateHook.test.ts` | New — 16 tests for the hook decision functions |
| `test/claudeHookWatcher.test.ts` | +2 tests for the watcher race + no-spam |
