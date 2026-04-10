---
title: "fix: Auto-switch to project after worktree creation from another project"
type: fix
status: active
date: 2026-04-10
---

# fix: Auto-switch to project after worktree creation from another project

## Overview

When the user creates a worktree in project B while viewing project A, the app creates the terminal but stays on project A. The user expects to land on the new worktree terminal immediately.

## Problem Frame

The sidebar shows all projects regardless of which is active. A user can click the worktree button on any project and create a worktree. After creation, `handleWorktreeCreated()` calls `addWorktree()` and `createTerminal()`, but never switches the active project. The new terminal is invisible until the user manually clicks on the target project.

## Requirements Trace

- R1. After worktree creation, the active project must switch to the worktree's project
- R2. The newly created terminal must become the active terminal and center tab
- R3. If the worktree is created in the already-active project, behavior should remain unchanged (no unnecessary re-render)

## Scope Boundaries

- Not changing worktree creation logic itself
- Not changing the CreateWorktreeDialog
- Not adding new hotkey behavior

## Context & Research

### Relevant Code and Patterns

- `src/components/Sidebar/Sidebar.tsx:237-241` — `handleWorktreeCreated()` is the callback after successful creation
- `src/hooks/useCreateTerminal.ts` — `createTerminal()` already calls `setActiveTerminal()` for existing worktree terminals (line 39), but does NOT set active terminal for newly created ones
- `src/stores/projectStore.ts:1100-1119` — `setActiveProject()` switches project and picks first visible terminal
- `src/stores/projectStore.ts` — `setActiveTerminal()` already handles cross-project switching (sets `activeProjectId` to the terminal's project)

## Key Technical Decisions

- **Use `setActiveTerminal` on the new terminal ID rather than `setActiveProject`**: The `setActiveTerminal` action already handles setting the active project when the terminal belongs to a different project. This is the established pattern and avoids a race condition where `setActiveProject` picks an arbitrary terminal before the new one is added.
- **Handle it in `handleWorktreeCreated` callback, not in `useCreateTerminal`**: The hook is shared and used in other contexts where auto-switching may not be desired. The Sidebar callback is the right place for this specific UX behavior.

## Implementation Units

- [ ] **Unit 1: Auto-switch to new worktree terminal after creation**

**Goal:** After worktree creation, switch active project and terminal to the newly created worktree terminal.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `src/components/Sidebar/Sidebar.tsx`

**Approach:**
- In `handleWorktreeCreated()`, use the `onCreated` callback option of `createTerminal()` to call `setActiveTerminal(terminalId)` after the terminal is added to the store
- `setActiveTerminal` already handles switching `activeProjectId` when the terminal belongs to a different project (existing pattern in the store)

**Patterns to follow:**
- `useCreateTerminal` already supports `onCreated` callback (line 9, 87)
- `setActiveTerminal` already handles cross-project switching in `projectStore.ts`

**Test scenarios:**
- Happy path: Create worktree in project B while project A is active → active project switches to B, new terminal is active and visible
- Happy path: Create worktree in currently active project → terminal is created and becomes active, no project switch needed
- Edge case: Worktree terminal already exists (1:1 coupling) → existing terminal is selected via `setActiveTerminal` (already handled in hook line 39)

**Verification:**
- Creating a worktree in a non-active project immediately shows the new terminal in the center area
- Creating a worktree in the active project still works as before

## System-Wide Impact

- **Interaction graph:** Only changes the post-creation callback in Sidebar. No impact on `CreateWorktreeDialog`, `useCreateTerminal`, or `projectStore` logic.
- **Unchanged invariants:** `useCreateTerminal` behavior unchanged. `setActiveProject` and `setActiveTerminal` store actions unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Low — minimal change to one callback | Single callback change using existing patterns |
