# Git Tab Feature Complete

**Date:** 2026-03-17
**Status:** Decided
**Author:** Remco + Claude

## What We're Building

Complete the Git tab with the four missing core features needed for a full git workflow without leaving the app:

1. **Stage/unstage + commit** — File-level staging with +/- buttons per file, Stage All / Unstage All, commit message input, and commit button
2. **Working directory diffs** — Click any modified/staged file to open a Monaco diff tab in the center area
3. **Discard changes** — Per-file discard button + Discard All, both with confirmation dialogs
4. **Branch management** — Click branch name in git tab header to open a dropdown with search filter, branch list, "New branch" option, switch, and delete

## Why This Approach

The git tab already shows status, fetch/pull/push, and commit history — but you can't actually *do* git operations from it. These four features close the gap between "read-only git viewer" and "usable git workflow tool." They cover ~95% of daily git operations.

We're keeping it simple:
- File-level staging only (no hunk staging) — covers the common case, avoids complexity
- No stash support — terminal is right there for edge cases
- No amend — same reasoning
- Reuse existing components (Monaco DiffEditorView, confirmation dialogs)

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Staging granularity | File-level | Hunk staging adds significant complexity for marginal daily use |
| Staging UI | +/- button per file + Stage All/Unstage All | Matches VS Code mental model |
| Working dir diffs | Click file → diff tab in center area | Reuses existing DiffEditorView, more screen space than inline |
| Discard scope | Per file + Discard All | Both with confirmation dialog to prevent data loss |
| Branch selector | Dropdown at branch name | Compact, fits existing header layout |
| Branch dropdown | Search filter + New branch + Switch + Delete | Covers daily branch operations |
| Amend commit | Not included | Keep it simple, use terminal for edge cases |
| Stash | Not included | Terminal fallback, avoids scope creep |

## Feature Details

### 1. Stage / Unstage + Commit

**New git operations needed:**
- `git add <file>` — stage a file
- `git reset HEAD <file>` — unstage a file
- `git add -A` — stage all
- `git reset HEAD` — unstage all
- `git commit -m "<message>"` — commit staged changes

**UI changes to GitStatusPanel:**
- Add +/- icon button on each file row (stage/unstage depending on section)
- Add "Stage All" button on the Modified section header
- Add "Unstage All" button on the Staged section header
- Add commit form below the file sections: multiline text input + "Commit" button
- Commit button disabled when: no staged files OR empty message
- After successful commit: clear message, refresh status + commit log

### 2. Working Directory Diffs

**New git operations needed:**
- `git diff -- <file>` — unstaged changes diff
- `git diff --cached -- <file>` — staged changes diff
- Return diff as original + modified content strings for Monaco

**UI behavior:**
- Click on any file in Modified/Staged/Untracked sections → opens diff tab in center area
- Reuse existing DiffEditorView component and center tab system
- Tab title: "filename (Working Tree)" or "filename (Staged)"
- Untracked files: show empty left side, full file on right side
- Conflicted files: show the file with conflict markers

### 3. Discard Changes

**New git operations needed:**
- `git checkout -- <file>` / `git restore <file>` — discard unstaged changes
- `git checkout -- .` / `git restore .` — discard all unstaged changes
- For untracked files: `rm <file>` with confirmation

**UI changes:**
- Discard (trash/undo) icon button on each file in Modified section
- "Discard All Changes" button on Modified section header
- Confirmation dialog: "Discard changes to {filename}? This cannot be undone."
- Discard All dialog: "Discard all changes to {n} files? This cannot be undone."
- After discard: refresh git status

### 4. Branch Management

**New git operations needed:**
- `git branch -a` — list all branches (local + remote)
- `git checkout <branch>` / `git switch <branch>` — switch branch
- `git checkout -b <name>` / `git switch -c <name>` — create new branch
- `git branch -d <name>` — delete branch (safe)
- `git branch -D <name>` — force delete (with extra confirmation)

**UI changes:**
- Branch name in git tab header becomes clickable → opens dropdown
- Dropdown contents:
  - Search/filter input at top
  - "New branch" option (expands to name input + create button)
  - Local branches section
  - Remote branches section (grouped by remote)
  - Current branch highlighted
  - Delete button on non-current local branches
- After branch switch: refresh everything (status, commit log, file explorer)

## Scope Boundaries

**In scope:**
- The four features above
- Keyboard shortcuts for commit (Ctrl+Enter in commit message)
- IPC handlers with input validation (consistent with existing patterns)
- Status refresh after each operation

**Out of scope:**
- Stash operations
- Hunk/line-level staging
- Amend commit
- Rebase / merge UI
- Cherry-pick
- Tag management
- Blame view
- Git graph visualization
