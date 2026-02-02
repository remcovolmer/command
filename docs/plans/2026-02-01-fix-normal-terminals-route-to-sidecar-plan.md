---
title: "fix: Route non-Claude terminals to sidecar panel instead of main area"
type: fix
date: 2026-02-01
---

# fix: Route non-Claude terminals to sidecar panel instead of main area

## Problem Statement

Normal (non-Claude) terminals appear in the main terminal area (center panel) alongside Claude terminals. They should instead appear exclusively in the right sidebar's sidecar terminal panel as collapsible tabs.

The sidecar terminal infrastructure already exists (`SidecarTerminalPanel.tsx`, `createSidecarTerminal` in store), but there's no routing logic that sends non-Claude terminals to the sidecar. Currently:

- `TerminalArea.tsx:54` always creates terminals with `type: 'claude'`
- `Sidebar.tsx:152` always creates terminals with `type: 'claude'`
- Only `createSidecarTerminal` (store) creates `type: 'normal'` terminals, but it's only triggered from the sidecar panel's "+" button

## Proposed Solution

1. **Filter non-Claude terminals out of the main TerminalArea** — `TerminalArea` should only render terminals where `type === 'claude'`
2. **Ensure the sidecar panel is always visible** when there's an active project (even with 0 terminals), so users can see the "+" button and create normal terminals
3. **Auto-open the right sidebar** when a sidecar terminal is created (if it's collapsed)

## Acceptance Criteria

- [x] Non-Claude (`type: 'normal'`) terminals never appear in the center terminal area
- [x] Non-Claude terminals appear as tabs in the right sidebar's sidecar terminal panel
- [x] The sidecar terminal panel header ("Terminal" + "+" button) is always visible in the right sidebar when a project is active
- [x] Creating a sidecar terminal auto-opens the right sidebar if it was collapsed
- [x] Existing Claude terminals are unaffected — they stay in the center area

## Implementation

### 1. Filter main TerminalArea (`src/components/Layout/TerminalArea.tsx`)

In the terminal list rendering, filter to only show `type === 'claude'` terminals. Look at how terminal IDs are selected and rendered — add a filter.

### 2. Always show sidecar panel header (`src/components/FileExplorer/SidecarTerminalPanel.tsx`)

The panel header with "Terminal" label and "+" button should render even when `terminals.length === 0`. Currently `hasTerminals` gates the tab bar but the header is always shown — verify this is working correctly.

### 3. Auto-open right sidebar (`src/stores/projectStore.ts`)

In `createSidecarTerminal`, after creating the terminal, check if `fileExplorerVisible` is false and set it to true. Also ensure `sidecarTerminalCollapsed` is set to false.

## References

- `src/components/FileExplorer/SidecarTerminalPanel.tsx` — sidecar terminal UI
- `src/components/FileExplorer/FileExplorer.tsx:160` — conditional rendering of sidecar panel
- `src/components/Layout/TerminalArea.tsx:54` — terminal creation in main area
- `src/stores/projectStore.ts:141-176` — `createSidecarTerminal` action
- `src/types/index.ts:29-30` — `TerminalType` definition
