---
title: "feat: Add Claude mode selector (Chat / Auto / Full Auto)"
type: feat
status: completed
date: 2026-03-24
---

# feat: Add Claude mode selector (Chat / Auto / Full Auto)

## Overview

Replace the per-project `dangerouslySkipPermissions` boolean toggle with a three-mode selector that maps to Claude Code CLI flags:

| Mode | CLI flag | Risk level |
|------|----------|------------|
| **Chat** | *(none)* | Normal — asks for every permission |
| **Auto** | `--enable-auto-mode` | Medium — auto-accepts safe actions |
| **Full Auto** | `--dangerously-skip-permissions` | High — skips all permissions |

The UI uses a segmented button group (like the existing theme selector) per project in Settings, matching the visual style from the user's reference: `[ Chat | Auto | Full Auto ]`.

## Problem Frame

Claude Code recently shipped `--enable-auto-mode` as a safer middle ground between interactive mode and `--dangerously-skip-permissions`. The app currently only supports a binary toggle (on/off for skip-permissions). Users need the ability to select auto-mode per project.

## Requirements Trace

- R1. Replace the boolean skip-permissions toggle with a 3-option mode selector
- R2. Pass the correct CLI flag (`--enable-auto-mode` or `--dangerously-skip-permissions`) when spawning Claude terminals
- R3. Persist the mode per project (backward compatible with existing `dangerouslySkipPermissions: true`)
- R4. Show a confirmation dialog when selecting "Full Auto" (existing behavior preserved)
- R5. Show a lighter confirmation/info when selecting "Auto" mode
- R6. Session restore must respect the project's current mode setting
- R7. AutomationRunner should use the project's mode setting instead of hardcoded `--dangerously-skip-permissions`

## Scope Boundaries

- Per-project only (not per-terminal) — matches existing pattern
- No changes to the hook system or state detection
- No changes to the terminal pool or eviction logic
- Automations always use `--dangerously-skip-permissions` (unchanged for now — could be a follow-up)

## Context & Research

### Relevant Code and Patterns

- **Theme selector** in `GeneralSection.tsx:92-106` — segmented button group pattern to reuse
- **Skip-permissions toggle** in `GeneralSection.tsx:175-203` — to be replaced
- **Confirmation dialog** in `GeneralSection.tsx:241-274` — to be adapted for mode changes
- **`ProjectSettings` type** — defined in 3 places (must update all):
  - `src/types/index.ts:12-16`
  - `electron/preload/index.ts:40-44`
  - `electron/main/services/ProjectPersistence.ts:17-21`
- **`CreateTerminalOptions`** — `electron/main/services/TerminalManager.ts:13-22`
- **CLI flag construction** — `TerminalManager.ts:148-151`
- **IPC handler** — `electron/main/index.ts:377-421` (reads `dangerouslySkipPermissions` from project settings)
- **Session restore** — `electron/main/index.ts:256-265` (same pattern)
- **Migration chain** — `ProjectPersistence.ts:147-208` (version 5 → 6)

### Institutional Learnings

- IPC validation: new enum values must be validated against a whitelist (from prompt injection learning)
- Windows path normalization matters for hook watcher session matching
- `spawn()` array args prevent shell injection but not prompt injection — relevant for sanitizing future user-provided flags

## Key Technical Decisions

- **Replace boolean with enum type `ClaudeMode = 'chat' | 'auto' | 'full-auto'`**: Clean replacement. The `dangerouslySkipPermissions` boolean maps to `full-auto`, `false`/undefined maps to `chat`. The new `auto` value maps to `--enable-auto-mode`.
- **Keep per-project (not per-terminal)**: Matches existing architecture. Mode is a project-level policy decision.
- **Replace `dangerouslySkipPermissions` field with `claudeMode`**: Cleaner than keeping both. Migration handles backward compatibility.
- **Keep `CreateTerminalOptions` using `claudeMode`**: Replace `dangerouslySkipPermissions: boolean` with `claudeMode?: ClaudeMode` throughout.

## Open Questions

### Resolved During Planning

- **Should auto-mode require confirmation?** Yes, a brief informational note (not a warning like full-auto). Auto mode is safer but users should understand what it does.
- **Should mode be visible on terminal tabs?** Not in this iteration — mode is per-project, not per-terminal, so it would be redundant with project context.

### Deferred to Implementation

- **Exact wording for auto-mode info dialog**: Will be refined during implementation.
- **AutomationRunner mode support**: Currently hardcodes `--dangerously-skip-permissions`. Follow-up work.

## Implementation Units

- [ ] **Unit 1: Type definitions and migration**

  **Goal:** Define `ClaudeMode` type, replace `dangerouslySkipPermissions` with `claudeMode` in all `ProjectSettings` interfaces, add data migration.

  **Requirements:** R1, R3

  **Dependencies:** None

  **Files:**
  - Modify: `src/types/index.ts`
  - Modify: `electron/preload/index.ts`
  - Modify: `electron/main/services/ProjectPersistence.ts`

  **Approach:**
  - Add `export type ClaudeMode = 'chat' | 'auto' | 'full-auto'` to `src/types/index.ts`
  - Replace `dangerouslySkipPermissions?: boolean` with `claudeMode?: ClaudeMode` in all 3 `ProjectSettings` definitions
  - Add migration from version 5 → 6 in `ProjectPersistence.migrateState`: convert `dangerouslySkipPermissions: true` → `claudeMode: 'full-auto'`, otherwise leave as undefined (defaults to `'chat'`)
  - Bump `STATE_VERSION` to 6

  **Patterns to follow:**
  - Existing migration chain in `ProjectPersistence.ts:147-208`
  - `AuthMode` type definition pattern

  **Test scenarios:**
  - Migration converts `{ dangerouslySkipPermissions: true }` → `{ claudeMode: 'full-auto' }`
  - Migration converts `{ dangerouslySkipPermissions: false }` → `{}` (no claudeMode, defaults to chat)
  - Migration preserves other settings fields (authMode, profileId)
  - Fresh installs get version 6 with default state

  **Verification:**
  - All 3 `ProjectSettings` interfaces are in sync
  - No remaining references to `dangerouslySkipPermissions` in type definitions

- [ ] **Unit 2: Main process — CLI flag construction**

  **Goal:** Update `TerminalManager` and IPC handlers to use `claudeMode` instead of `dangerouslySkipPermissions`.

  **Requirements:** R2, R6

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `electron/main/services/TerminalManager.ts`
  - Modify: `electron/main/index.ts`

  **Approach:**
  - Replace `dangerouslySkipPermissions?: boolean` with `claudeMode?: ClaudeMode` in `CreateTerminalOptions`
  - Update flag construction in `createTerminal()`:
    - `claudeMode === 'auto'` → push `'--enable-auto-mode'`
    - `claudeMode === 'full-auto'` → push `'--dangerously-skip-permissions'`
    - `claudeMode === 'chat'` or undefined → no flag
  - Update both call sites in `index.ts` (terminal:create handler and session restore) to read `project?.settings?.claudeMode` instead of `dangerouslySkipPermissions`

  **Patterns to follow:**
  - Existing flag construction at `TerminalManager.ts:148-151`
  - Existing project settings read at `index.ts:418`

  **Test scenarios:**
  - Terminal created with `claudeMode: 'auto'` spawns `claude --enable-auto-mode`
  - Terminal created with `claudeMode: 'full-auto'` spawns `claude --dangerously-skip-permissions`
  - Terminal created with `claudeMode: 'chat'` spawns `claude` (no flag)
  - Terminal created with no claudeMode spawns `claude` (no flag)
  - Session restore respects current project mode

  **Verification:**
  - `grep -r dangerouslySkipPermissions electron/` returns no results (except possibly AutomationRunner which is out of scope)

- [ ] **Unit 3: Settings UI — mode selector**

  **Goal:** Replace the skip-permissions toggle with a segmented button group `[ Chat | Auto | Full Auto ]` and adapt the confirmation dialogs.

  **Requirements:** R1, R4, R5

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `src/components/Settings/GeneralSection.tsx`
  - Modify: `src/stores/projectStore.ts` (if `updateProject` needs type adjustments)

  **Approach:**
  - Replace the toggle switch (lines 175-203) with a segmented button group matching the theme selector pattern (lines 92-104)
  - Three buttons: `Chat` (default), `Auto` (blue/cyan accent), `Full Auto` (yellow accent, existing warning color)
  - When clicking `Full Auto`: show existing confirmation dialog (adapted text)
  - When clicking `Auto`: show a lighter info dialog explaining what auto-mode does
  - When clicking `Chat`: apply immediately (no dialog needed, it's the safest option)
  - Update `handleToggle` → `handleModeChange(projectId, newMode)`
  - Description text below the selector explains the current mode

  **Patterns to follow:**
  - Theme selector segmented buttons in `GeneralSection.tsx:92-106`
  - Existing confirmation dialog at `GeneralSection.tsx:241-274`

  **Test scenarios:**
  - Mode selector shows current project mode as active
  - Clicking "Full Auto" shows confirmation dialog
  - Confirming "Full Auto" persists `claudeMode: 'full-auto'`
  - Clicking "Auto" shows info dialog
  - Confirming "Auto" persists `claudeMode: 'auto'`
  - Clicking "Chat" immediately persists `claudeMode: 'chat'`
  - Mode change only applies to new chats (existing behavior preserved)
  - Keyboard shortcuts (Escape to cancel, Enter to confirm) work on dialogs

  **Verification:**
  - No remaining skip-permissions toggle UI
  - All three modes are selectable and persist correctly
  - Visual style matches theme selector pattern

- [ ] **Unit 4: Cleanup references**

  **Goal:** Remove all remaining references to `dangerouslySkipPermissions` across the codebase (except AutomationRunner).

  **Requirements:** R1

  **Dependencies:** Units 1-3

  **Files:**
  - Search and modify: any remaining files referencing `dangerouslySkipPermissions`

  **Approach:**
  - Global search for `dangerouslySkipPermissions` and `skipPermissions`
  - Update or remove each reference
  - AutomationRunner keeps its hardcoded `--dangerously-skip-permissions` (out of scope)

  **Test scenarios:**
  - `grep -r dangerouslySkipPermissions` only returns AutomationRunner
  - App builds without type errors

  **Verification:**
  - Clean build (`npm run build`)
  - Existing tests pass (`npm run test`)

## System-Wide Impact

- **Interaction graph:** Settings UI → projectStore → IPC `project:update` → ProjectPersistence → `terminal:create` IPC → TerminalManager → PTY spawn
- **Error propagation:** Invalid mode values should fall back to `'chat'` (safest default)
- **State lifecycle risks:** Mid-session mode change only affects new terminals (existing behavior). No partial-write risk.
- **API surface parity:** AutomationRunner still hardcodes `--dangerously-skip-permissions` — follow-up ticket
- **Integration coverage:** End-to-end test: change mode in settings → create new chat → verify correct CLI flag is passed

## Risks & Dependencies

- **Claude CLI `--enable-auto-mode` availability**: The flag must be available in the user's installed Claude Code version. If not available, Claude will error on startup. Consider: should we validate Claude version? → Deferred, user responsibility.
- **Three duplicate `ProjectSettings` types**: All 3 must be updated in sync. This is an existing tech debt pattern — no new risk.

## Sources & References

- Related plan: `docs/plans/2026-02-06-feat-per-project-skip-permissions-setting-plan.md`
- Claude Code CLI: `--enable-auto-mode` flag (shipped March 2026)
- Existing patterns: theme selector UI, migration chain
