---
title: "feat: Add git commit history to git tab in right sidebar"
type: feat
date: 2026-02-13
---

# feat: Add git commit history to git tab in right sidebar

## Overview

Add a scrollable commit history list to the existing git tab in the right sidebar. Users can browse commits for the current branch, expand individual commits to see details (full message, changed files, stats), and open file diffs in the center editor area using Monaco's built-in DiffEditor.

## Problem Statement / Motivation

The git tab currently only shows working tree status (staged, modified, untracked files). Users must switch to an external tool or terminal to browse commit history. Adding commit history directly in the sidebar provides a more integrated workflow for reviewing recent changes.

## Proposed Solution

Add a "Commit History" section below the existing git status sections. Commits load in pages (100 at a time) with infinite scroll via `@tanstack/react-virtual`. Clicking a commit expands it accordion-style to show details. Clicking a changed file in the expanded view opens a Monaco DiffEditor tab in the center area.

## Technical Approach

### Architecture

Follow the established 4-layer IPC pattern:

```
GitService (new methods)
  → IPC handlers (git:commit-log, git:commit-detail, git:file-at-commit)
    → Preload bridge (window.electronAPI.git.*)
      → React components (CommitHistory, CommitRow, DiffEditor tab)
```

### Files to Modify/Create

**Backend (Main Process)**

| File | Change |
|------|--------|
| `electron/main/services/GitService.ts` | Add `getCommitLog()`, `getCommitDetail()`, `getFileAtCommit()` methods |
| `electron/main/index.ts` | Add 3 new IPC handlers with input validation |
| `electron/preload/index.ts` | Expose 3 new methods under `git` namespace + add types |

**Types**

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `GitCommit`, `GitCommitDetail`, `GitCommitFile` interfaces; extend `ElectronAPI.git`; add `DiffTab` type to editor tab union |

**State**

| File | Change |
|------|--------|
| `src/stores/projectStore.ts` | Add `gitCommitLog` state (keyed by contextId), pagination cursor, expanded commit ID, loading flags |

**UI Components**

| File | Change |
|------|--------|
| `src/components/FileExplorer/GitStatusPanel.tsx` | Restructure layout: fixed-height status section + flex-fill commit history section |
| `src/components/FileExplorer/CommitHistory.tsx` | **New** - Virtual-scrolled commit list with infinite scroll |
| `src/components/FileExplorer/CommitRow.tsx` | **New** - Single commit row with expand/collapse |
| `src/components/FileExplorer/CommitDetail.tsx` | **New** - Expanded commit details (full message, changed files, stats) |
| `src/components/Editor/EditorContainer.tsx` | Add routing for `DiffTab` type → Monaco DiffEditor |
| `src/components/Editor/DiffEditorView.tsx` | **New** - Monaco DiffEditor wrapper component |

**Hotkeys & Docs**

| File | Change |
|------|--------|
| `src/utils/hotkeys.ts` | Add commit history navigation shortcuts |
| `src/App.tsx` | Register new hotkey handlers |
| `CLAUDE.md` | Document new keyboard shortcuts |

### Implementation Phases

#### Phase 1: Backend + Types

1. Define types in `src/types/index.ts`:

```typescript
interface GitCommit {
  hash: string;        // full SHA
  shortHash: string;   // 7-char abbreviated
  message: string;     // first line only
  authorName: string;
  authorDate: string;  // ISO 8601
  parentHashes: string[]; // for merge detection
}

interface GitCommitFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  oldPath?: string; // for renames
}

interface GitCommitDetail {
  hash: string;
  fullMessage: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  files: GitCommitFile[];
  isMerge: boolean;
  parentHashes: string[];
}

// Extend EditorTab union
interface DiffTab {
  type: 'diff';
  id: string;
  filePath: string;
  fileName: string;
  commitHash: string;
  parentHash: string;
}
```

2. Add `GitService` methods:

- `getCommitLog(projectPath, skip=0, limit=100)` — runs `git log --skip=N --max-count=M --format=<custom>` and parses output
- `getCommitDetail(projectPath, commitHash)` — runs `git show --stat --format=<custom> <hash>` and `git diff-tree -r --numstat <hash>` to get file-level stats
- `getFileAtCommit(projectPath, commitHash, filePath)` — runs `git show <hash>:<filepath>` to get file content for diff viewer

3. Add IPC handlers with validation:
- `git:commit-log` — validates projectPath, skip (>=0), limit (1-500)
- `git:commit-detail` — validates projectPath, commitHash (hex, 7-40 chars)
- `git:file-at-commit` — validates projectPath, commitHash, filePath

4. Extend preload bridge + ElectronAPI type

#### Phase 2: Commit History UI

1. Install `@tanstack/react-virtual` for virtual scrolling
2. Restructure `GitStatusPanel.tsx`:
   - Top section: branch info + file changes (collapsible, fixed max-height with own scroll)
   - Bottom section: commit history (flex-fill, takes remaining space)
   - This avoids nested scrolling conflicts
3. Build `CommitHistory.tsx`:
   - Uses `useVirtualizer` from `@tanstack/react-virtual`
   - Fetches first page on mount, fetches next page when scroll nears bottom
   - Shows loading spinner during fetch
   - Handles empty state ("No commits yet")
4. Build `CommitRow.tsx`:
   - Displays: commit message (truncated), short hash, relative time
   - Click to expand/collapse (accordion — one at a time)
   - Visual indicator for HEAD commit (first commit, badge)
5. Build `CommitDetail.tsx`:
   - Shows: full message, author name, full date, file change list with +/- stats
   - "Merge commit" label for merge commits
   - Each file row is clickable → opens diff tab
6. Add Zustand state:
   - `gitCommitLog: Record<string, { commits: GitCommit[], hasMore: boolean, cursor: number }>`
   - `gitCommitLogLoading: Record<string, boolean>`
   - `expandedCommitHash: Record<string, string | null>` (per contextId)
   - Actions: `setGitCommitLog`, `appendGitCommitLog`, `setExpandedCommit`

#### Phase 3: Diff Editor

1. Add `DiffTab` to the editor tab union type
2. Build `DiffEditorView.tsx`:
   - Uses `DiffEditor` from `@monaco-editor/react`
   - Fetches original content (`git show <parent>:<file>`) and modified content (`git show <commit>:<file>`) via IPC
   - Read-only, inline diff mode by default
   - Handles edge cases: added files (empty original), deleted files (empty modified), binary files (show message)
3. Update `EditorContainer.tsx`:
   - Route `DiffTab` type to `DiffEditorView`
   - Show diff tab with distinct appearance (e.g., icon or prefix in tab title)
4. Wire up: clicking a file in `CommitDetail` → opens diff tab via store action

#### Phase 4: Smart Refresh + Keyboard Shortcuts

1. Smart refresh: on each 10-second git status poll, also check `git rev-parse HEAD`. If HEAD changed, re-fetch first page of commits.
2. Add keyboard shortcuts:
   - Navigate commit list (already partially covered by `Ctrl+Shift+G` to switch to git tab)
   - Consider: no new global shortcuts needed — commit list navigation uses standard focus + arrow keys within the component
   - Add to hotkeys config if global shortcut desired (e.g., focus commit list)
3. Manual refresh button in commit history section header

## Acceptance Criteria

- [x] Git tab shows "Commit History" section below working tree status
- [x] Commits display: first-line message, short hash, relative time (e.g., "2h ago")
- [x] Virtual scrolling handles repos with thousands of commits smoothly
- [x] Infinite scroll loads more commits when scrolling to bottom
- [x] Clicking a commit expands it (accordion) showing full message, author, date, changed files with +/- stats
- [x] Clicking a changed file opens Monaco DiffEditor in center editor area
- [x] DiffEditor shows side-by-side or inline diff with correct before/after content
- [x] Commit history updates when HEAD changes (after pull, push, etc.)
- [x] Empty repo shows "No commits yet" instead of error
- [x] Detached HEAD state works correctly
- [x] Context switches between projects/worktrees show correct commit history
- [x] Hash is copyable (click short hash → copy full hash to clipboard)

## Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| Empty repo (no commits) | Show "No commits yet" message |
| Detached HEAD | Show commits from current position, indicate "(detached)" |
| Merge commits | Show "Merge commit" label, diff against first parent |
| Very long commit messages | Truncate first line in row, show full in expanded view |
| Binary file in commit | Show "Binary file" in diff view instead of Monaco DiffEditor |
| Renamed file | Show old → new path, diff shows content changes |
| Initial commit (no parent) | Diff shows all files as added (empty original) |
| Large commit (500+ files) | Show all files in scrollable list within expanded view |
| `git log` timeout/failure | Show error message in commit section, don't break status section |

## Dependencies & Risks

- **New dependency**: `@tanstack/react-virtual` (~12KB gzipped) — well-maintained, handles variable-height rows
- **Monaco DiffEditor**: Already available via `@monaco-editor/react` (installed at 4.7.0) — just need to import `DiffEditor`
- **Performance risk**: Large repos with 100K+ commits — mitigated by pagination (100 per page)
- **10MB maxBuffer**: `git log` output must stay under 10MB — pagination ensures this (100 commits ≈ 10-20KB)
- **Nested scrolling**: Must restructure `GitStatusPanel` to avoid scroll conflicts

## Success Metrics

- Commit history loads in < 500ms for first page
- Virtual scrolling maintains 60fps while browsing
- No increase in memory usage for repos with < 1000 commits

## References & Research

### Internal References
- Git tab implementation: `src/components/FileExplorer/GitStatusPanel.tsx`
- Git service: `electron/main/services/GitService.ts`
- IPC handlers: `electron/main/index.ts:581-605`
- Preload bridge: `electron/preload/index.ts:298-309`
- Types: `src/types/index.ts`
- Store: `src/stores/projectStore.ts`
- Editor container: `src/components/Editor/EditorContainer.tsx`

### Institutional Learnings Applied
- 4-layer IPC pattern from `docs/solutions/integration-issues/github-context-menu-integration.md`
- IPC naming convention (kebab-case): from `docs/solutions/code-review/terminal-link-feature-review-fixes.md`
- Input validation pattern: `validateProjectPath()` + type/bounds checks
- `execFile` with argument arrays (not `exec`) for security
