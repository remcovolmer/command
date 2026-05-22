---
name: fix-tab-title-stuck-on-resuming
description: Tab title stays on "Resuming..." after starting a chat from a historical session, while the sidebar already shows the session's real title.
type: fix
status: completed
created: 2026-05-22
---

# Fix: Tab title stuck on "Resuming..." after resuming a historical session

## Summary

When a chat is started from a historical session via the project overview, the center tab title remains stuck on `Resuming...` even after Claude Code finishes resuming and the sidebar (and sessions panel) display the resumed session's title. The fix aligns the tab bar's title rendering with the existing sidebar convention and additionally seeds the initial title from the known session metadata so the tab never shows `Resuming...` in the first place.

## Problem Frame

The center-tab title and the sidebar title are read from the same `TerminalSession` object but use different fields:

- `src/components/Sidebar/TerminalListItem.tsx:44` and `src/components/FileExplorer/SessionsPanel.tsx:33` both render `terminal.generatedTitle || terminal.title`.
- `src/components/Terminal/TerminalTabBar.tsx:82` renders only `terminal.title`.

Resume flow (`src/components/Layout/TerminalArea.tsx:163`):

1. User clicks a session in `ProjectOverview`; `handleResumeSession` calls `api.terminal.create(projectId, undefined, 'claude', sessionId)`.
2. The renderer immediately calls `addTerminal({ ..., title: 'Resuming...' })`.
3. `TerminalManager` spawns the PTY and runs `claude --resume <sessionId>`. Auto-naming (`TerminalManager.handleAutoNaming`) only fires when the user types and presses Enter, so for a passive resume `terminal.title` is never updated from `'Resuming...'`.
4. Once `ClaudeHookWatcher` binds the new session ID to the terminal, `SessionIndexService.refreshAndPush` calls `pushSummaryToRenderer`, which fires `terminal:summary` and (when an Ollama-generated title exists) `terminal:generated-title`.
5. The store sets `terminal.generatedTitle`, the sidebar picks it up via `generatedTitle || title`, but the tab bar still renders the stale `title` field — hence the stuck `Resuming...`.

There is also a UX flash: even when the title eventually arrives, the tab briefly shows `Resuming...` before snapping to the real value, which is unnecessary because the calling component (`ProjectOverview`) already has the session entry with its title.

## Scope Boundaries

**In scope**
- Align `TerminalTabBar` with the established sidebar title-fallback pattern.
- Seed the initial terminal title from the resumed session entry (no `Resuming...` flash when we already know a better title).

**Out of scope**
- Auto-naming logic for fresh (non-resume) chats — already works via `handleAutoNaming`.
- Renaming `generatedTitle` / `summary` semantics or collapsing the two parallel title channels.
- Updating `terminal.title` server-side from `pushSummaryToRenderer` (still pushed as `generatedTitle`, not as `title` — keeps existing field semantics intact).

### Deferred to Follow-Up Work

- None.

## Key Technical Decisions

- **Keep `generatedTitle` and `title` as separate fields.** The renderer already has a working fallback pattern (`generatedTitle || title`) in two places. Mirroring it in the tab bar is the lowest-risk, most consistent fix.
- **Seed the initial title from the session entry at resume time, in the renderer.** `ProjectOverview` already has the full `SessionIndexEntry`; passing the chosen title up to `handleResumeSession` is cheaper and more direct than threading session metadata through the main process.
- **Initial title fallback chain reuses `ProjectOverview`'s session-display chain but keeps the existing tab-tab placeholder:** `generatedTitle || summary || firstPrompt || 'Resuming...'`. The first three terms match `ProjectOverview.tsx:118` (`generatedTitle || summary || firstPrompt || 'Untitled session'`); the final fallback intentionally diverges to `'Resuming...'` because that is the established tab placeholder in `TerminalArea.tsx:173` and reads more naturally in the active tab during a resume than `'Untitled session'` would. In practice the final fallback is reached only for sessions with no metadata at all, which does not happen for non-empty sessions.

## Implementation Units

### U1. Mirror sidebar title fallback in TerminalTabBar

**Goal:** Render the resumed session's generated title in the center tab as soon as it arrives, matching the sidebar.

**Files:**
- Modify: `src/components/Terminal/TerminalTabBar.tsx`

**Approach:**
- Change line 82 to render `terminal.generatedTitle || terminal.title` instead of `terminal.title`.
- No other behavior changes; this is a one-character pattern change consistent with `TerminalListItem` and `SessionsPanel`.

**Patterns to follow:**
- `src/components/Sidebar/TerminalListItem.tsx:44`
- `src/components/FileExplorer/SessionsPanel.tsx:33`

**Test scenarios:**
- Resumed Claude terminal where `generatedTitle` is set after async push → tab bar shows the generated title, not `terminal.title`.
- Fresh Claude terminal with auto-named `title` and no `generatedTitle` → tab bar shows `terminal.title` (unchanged behavior).
- Normal (non-Claude) terminal where `generatedTitle` is never set → tab bar shows `terminal.title` (unchanged behavior).

**Verification:**
- Manually resuming any session with an Ollama-generated title updates the active tab title to match the sidebar after the hook push completes.

### U2. Seed initial terminal title from session entry at resume time

**Goal:** Avoid the visible `Resuming...` flash by passing the known session title from `ProjectOverview` into `handleResumeSession` so the new `TerminalSession` starts with a meaningful title.

**Files:**
- Modify: `src/components/Layout/TerminalArea.tsx` — extend `handleResumeSession` to accept the session title (or full entry) and use it as the initial `title`.
- Modify: `src/components/ProjectOverview.tsx` — pass the session title through `onResumeSession`.
- Modify (types only, if needed): `src/types/index.ts` is unaffected; only the `onResumeSession` prop signature in `ProjectOverview` changes.

**Approach:**
- Change the `onResumeSession` prop signature in `ProjectOverview` from `(sessionId: string) => void` to `(sessionId: string, initialTitle: string) => void`.
- In `ProjectOverview`, compute the title using the same first three terms as its display chain (`session.generatedTitle || session.summary || session.firstPrompt`) and fall back to `'Resuming...'` only when all three are empty — the display chain on line 118 falls back to `'Untitled session'`, but the tab-bar context calls for the existing `'Resuming...'` placeholder as documented in Key Technical Decisions. Pass the computed string to `onResumeSession`.
- In `TerminalArea.handleResumeSession`, accept the new argument and use it as the `title` field on `addTerminal`. Keep the literal `'Resuming...'` only as the final default if the caller somehow passes an empty string.
- No changes needed in the main process: `api.terminal.create` already does not set an `initialTitle` for resume, and we deliberately keep the rendererside `title` decoupled from `generatedTitle` so the async hook push (U1) still works for sessions whose generated title arrives after creation.

**Patterns to follow:**
- The existing title fallback chain in `ProjectOverview.tsx:118` is the source of truth for "what should this session be called right now".

**Test scenarios:**
- Resume a session with `generatedTitle` → tab opens directly with `generatedTitle`; no `Resuming...` ever shown.
- Resume a session with no `generatedTitle` but a `summary` → tab opens with `summary`; later generated title (if produced) replaces it via U1's fallback.
- Resume a session with only `firstPrompt` → tab opens with `firstPrompt`.
- Resume an effectively empty session (no metadata at all) → tab still falls back to `Resuming...` (matches today's worst case; no regression).

**Verification:**
- Resuming any session from `ProjectOverview` shows the session's title in the active tab from the first paint, with no visible `Resuming...` interstitial.

## Risk

- **Low.** All changes are in the renderer; the main process and IPC contract are untouched. The fallback chain is conservative and only adds preference for already-known data over a placeholder. If `ProjectOverview` is later changed to expose alternate entry points (e.g., resume from sessions panel), each entry point must pass an initial title or the literal `'Resuming...'` placeholder will reappear — kept as the documented final fallback rather than removed.

## System-Wide Impact

- `TerminalTabBar` now follows the same title-fallback pattern as the two other terminal-list components, which removes a small inconsistency in the renderer.
- The `onResumeSession` callback signature gains a second argument; only `ProjectOverview` calls it today, so propagation is local. If `SessionsPanel` or another component grows a resume affordance later, that caller is responsible for supplying an initial title.
