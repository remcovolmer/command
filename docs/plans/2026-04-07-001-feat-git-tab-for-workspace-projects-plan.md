---
title: "feat: Enable git tab and sidecar terminals for workspace projects"
type: feat
status: active
date: 2026-04-07
---

# feat: Enable git tab and sidecar terminals for workspace projects

## Overview

Workspace projects (`type: 'workspace'`) currently hide the git tab and sidecar terminal panel behind an `isLimitedProject` gate. Since workspace directories are git repos, they should have full git tab and sidecar terminal support — identical to `code` projects. Only `project` type should remain limited.

## Problem Frame

Workspace projects are pinned at the top of the sidebar as high-level overview entries. They point to directories that are git repositories, but the `isLimitedProject` boolean groups both `workspace` and `project` types together, hiding the git tab, sidecar terminals, and forcing the files tab. This means workspace users can't see git status, stage/commit, manage branches, or open a quick shell — they have to switch to a `code` project for that.

## Requirements Trace

- R1. Workspace projects show the git tab with full functionality (status, staging, commit, branch management, diffs)
- R2. Workspace projects show the sidecar terminal panel
- R3. Only `project` type remains limited (no git tab, no sidecar)
- R4. No behavioral change for `code` projects
- R5. Git data flow (gitContextId, gitPath) works correctly for workspace projects

## Scope Boundaries

- Only changes the feature gating — no new git operations or UI components
- Does not add worktree support to workspace projects (that remains a `code` project feature)
- Does not change how workspace projects are rendered in the sidebar

## Context & Research

### Relevant Code and Patterns

- `src/components/FileExplorer/FileExplorer.tsx:92-95` — `isLimitedProject` definition gates both workspace and project types
- `src/components/FileExplorer/FileExplorer.tsx:273` — Forces files tab when `isLimitedProject && activeTab === 'git'`
- `src/components/FileExplorer/FileExplorer.tsx:280` — `showGitTab={!isLimitedProject}` hides git tab
- `src/components/FileExplorer/FileExplorer.tsx:294` — `isLimitedProject || activeTab === 'files'` forces FileTree
- `src/components/FileExplorer/FileExplorer.tsx:307` — `!isLimitedProject` hides sidecar terminal panel

### Git Data Flow Already Works

The git context derivation in `FileExplorer.tsx` already handles workspace projects correctly:
- `gitContextId = activeWorktree?.id ?? activeProjectId` → uses `activeProjectId` (correct)
- `gitContextPath = activeWorktree?.path` → undefined for workspace (no worktrees)
- `gitPath = gitContextPath ?? activeProject?.path` → falls back to workspace's path (correct)
- `GitStatusPanel` receives `project`, `gitContextId`, and `gitPath` — all will be correct

No changes needed in the data layer, git service, or IPC handlers.

### Institutional Learnings

- **Tasks tab had the exact same `isLimitedProject` gating problem** (`docs/solutions/security-issues/tasks-ipc-path-traversal-and-review-fixes.md`). The fix reordered the conditional chain so `activeTab === 'tasks'` is checked *before* the `isLimitedProject` fallback. The current code already has this fix applied — tasks is checked before `isLimitedProject`, and git falls through correctly when `isLimitedProject` is false.
- **Git IPC handlers are path-based and type-agnostic** (`docs/solutions/code-review/git-tab-multi-agent-review-findings.md`). GitService takes a `projectPath` string with no project type checking. Any valid filesystem path works.
- **Workspace projects use separate sidebar rendering** (`Sidebar.tsx` lines 309-386) that doesn't go through `SortableProjectItem`. GitHub context menu and worktree buttons are gated in `SortableProjectItem` only — not affected by this change.

## Key Technical Decisions

- **Change `isLimitedProject` condition**: Remove `workspace` from the limited set. The simplest change: `activeProject?.type === 'project'` instead of `activeProject?.type === 'workspace' || activeProject?.type === 'project'`. This is a 1-line change with 0 risk of breaking the existing git tab flow.
- **Update comment**: The current comment says "Both 'workspace' and 'project' types have limited functionality" — update to reflect only `project` type is limited.

## Implementation Units

- [ ] **Unit 1: Change isLimitedProject to exclude workspace**

**Goal:** Enable git tab and sidecar terminals for workspace projects by narrowing the `isLimitedProject` condition.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** None

**Files:**
- Modify: `src/components/FileExplorer/FileExplorer.tsx`

**Approach:**
- Change line 92-94: `isLimitedProject` from `activeProject?.type === 'workspace' || activeProject?.type === 'project'` to `activeProject?.type === 'project'`
- Update the comment on line 91 to say `'project' type has limited functionality`
- All 5 usages of `isLimitedProject` (lines 273, 280, 294, 307) automatically benefit from this single change

**Patterns to follow:**
- The existing `isLimitedProject` pattern — just narrowing its scope

**Test scenarios:**
- Happy path: Workspace project shows git tab in FileExplorerTabBar
- Happy path: Workspace project git tab renders GitStatusPanel with correct project path
- Happy path: Workspace project shows sidecar terminal panel
- Happy path: `project` type still hides git tab and sidecar terminals
- Happy path: `code` type behavior unchanged
- Edge case: Switching from workspace (git tab active) to project type falls back to files tab (existing line 273 logic)
- Integration: Git status refresh via file watcher works for workspace projects (same `activeProjectId` flow)

**Verification:**
- Workspace project shows Files, Git, Tasks, Auto tabs
- Clicking Git tab shows git status, staged/modified/untracked files, commit form, branch info
- Sidecar terminal panel visible and functional
- `project` type still only shows Files, Tasks, Auto tabs

## System-Wide Impact

- **Interaction graph:** No new interactions — all existing git tab components (GitStatusPanel, CommitForm, BranchDropdown, DiffEditorView) already work with any project that has a valid `gitPath`. The file watcher git-status subscription uses `activeProjectId` which is already set for workspace projects.
- **Unchanged invariants:** Worktree operations (create, list, remove) remain gated to `code` projects via the Sidebar and worktree-specific UI, not via `isLimitedProject`. No change there.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Workspace directory might not be a git repo | GitStatusPanel already handles this: shows "Not a git repository" when `gitStatus.isGitRepo === false` (line 69-72) |
| File watcher not set up for workspace | File watcher subscribes based on `activeProjectId` in FileExplorer's useEffect — workspace projects are valid here |

## Sources & References

- Existing git tab plan: `docs/plans/2026-03-17-001-feat-git-tab-complete-workflow-plan.md`
- `FileExplorer.tsx` — the single file that needs modification
