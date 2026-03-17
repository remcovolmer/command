---
title: "feat: Complete Git Tab with Stage, Commit, Diff, Discard, and Branch Management"
type: feat
status: active
date: 2026-03-17
origin: docs/brainstorms/2026-03-17-git-tab-feature-complete-brainstorm.md
---

# feat: Complete Git Tab with Stage, Commit, Diff, Discard, and Branch Management

## Enhancement Summary

**Deepened on:** 2026-03-17
**Sections enhanced:** All phases + new concurrency/security/performance sections
**Review agents used:** Architecture Strategist, TypeScript Reviewer, Frontend Races Reviewer, Security Sentinel, Performance Oracle, Code Simplicity Reviewer, Pattern Recognition Specialist, Learnings Researcher, Best Practices Researcher

### Key Improvements from Research
1. **Race condition architecture** — Generation counter + GitService-level serialization replaces boolean lock
2. **Type refinement** — `diffKind: 'staged' | 'unstaged' | 'untracked' | 'deleted'` replaces `staged: boolean`
3. **Security hardening** — Branch name validation on ALL branch ops, `--` separator everywhere, `validateRelativeFilePaths` helper
4. **Performance guards** — File size check before Monaco load, parallel content fetching, shallow equality on status updates
5. **Simplification** — Local branches only in v1, explicit `discardAll` method instead of magic `['.']`, validate branch names via `git check-ref-format` on submit instead of regex on keystroke

### Decisions Changed from Original Plan
| Original | Changed to | Why |
|----------|-----------|-----|
| `staged: boolean` on WorkingTreeDiffTab | `diffKind` string literal union | 4 states not 2 (staged/unstaged/untracked/deleted) |
| `discardFiles(['.'])` for Discard All | Explicit `discardAll()` method | Magic sentinel value is a footgun |
| Boolean operation lock | Generation counter + try/finally | Concurrent ops can corrupt boolean; counter is 12 lines |
| Close ALL diff tabs after any op | Close only affected files' tabs | Less disruptive UX; file set is already known |
| Remote branches in dropdown | Local only (v1) | Remote branch UX adds complexity; defer until requested |
| Keystroke branch name regex | `git check-ref-format --branch` on submit | Authoritative, no regex maintenance |
| `git:index-file-content` | `git:get-index-file-content` | Matches existing read-op naming convention |

---

## Overview

Add four core git features to the existing Git tab to enable a complete git workflow without leaving the app: file-level staging/unstaging with commit, working directory diffs, discard changes, and branch management via dropdown.

## Problem Statement / Motivation

The Git tab currently shows git status, fetch/pull/push buttons, and commit history — but you can't actually *perform* git operations from it. Users must switch to a terminal for staging, committing, discarding, branching, and viewing uncommitted diffs. This breaks flow and makes the Git tab read-only.

## Proposed Solution

Four features following existing patterns (see brainstorm: `docs/brainstorms/2026-03-17-git-tab-feature-complete-brainstorm.md`):

1. **Stage/Unstage + Commit** — +/- buttons per file, Stage All/Unstage All, commit message input with Commit button
2. **Working Directory Diffs** — Click modified/staged file → Monaco diff tab in center area
3. **Discard Changes** — Per-file discard + Discard All with confirmation dialogs
4. **Branch Management** — Clickable branch name → dropdown with search, local branch list, new branch, switch, delete

## Implementation Phases

### Phase 1: Backend — GitService + IPC + Preload + Types

Add all new git operations to the service layer and expose them through the 4-layer IPC pattern.

#### 1.1 New GitService Methods

**File:** `electron/main/services/GitService.ts`

```typescript
// --- Operation serialization (prevents index.lock conflicts) ---
private operationQueue: Map<string, Promise<void>> = new Map()

private async serialized<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = this.operationQueue.get(projectPath) ?? Promise.resolve()
  let result: T
  const next = prev.then(async () => { result = await fn() }, async () => { result = await fn() })
  this.operationQueue.set(projectPath, next.then(() => {}, () => {}))
  await next
  return result!
}

// --- Staging ---
async stageFiles(projectPath: string, files: string[]): Promise<void>
async unstageFiles(projectPath: string, files: string[]): Promise<void>

// --- Commit ---
async commit(projectPath: string, message: string): Promise<string>  // returns commit hash

// --- Discard ---
async discardFiles(projectPath: string, files: string[]): Promise<void>
async discardAll(projectPath: string): Promise<void>  // explicit method, no magic '.'
async deleteUntrackedFiles(projectPath: string, files: string[]): Promise<void>

// --- Working directory content (for diff viewer) ---
async getIndexFileContent(projectPath: string, filePath: string): Promise<string | null>
// HEAD content: already exists as getFileAtCommit(projectPath, 'HEAD', filePath)
// Working tree content: read from filesystem via existing fs APIs

// --- Branch management ---
async listBranches(projectPath: string): Promise<GitBranchListItem[]>
async createBranch(projectPath: string, name: string): Promise<void>
async switchBranch(projectPath: string, name: string): Promise<void>
async deleteBranch(projectPath: string, name: string, force: boolean): Promise<void>
async validateBranchName(projectPath: string, name: string): Promise<boolean>
```

Implementation details:
- **All mutating operations** wrapped in `this.serialized(projectPath, fn)` to prevent concurrent index access and `index.lock` errors
- `stageFiles` / `unstageFiles` use batched `git add --` / `git reset HEAD --` with all file paths (single IPC roundtrip per operation)
- **Chunking**: Split file arrays into batches of 100 to stay within Windows `CreateProcessW` 32K argument limit
- `discardFiles` uses `git checkout -- <files>` for tracked files
- `discardAll` uses `git checkout -- .` as an explicit separate method (not overloaded on discardFiles)
- `deleteUntrackedFiles` uses `git clean -f -- <files>` (not shell `rm` — safer, cross-platform)
- `getIndexFileContent` uses `git show :<filePath>` to get index/staged content
- `listBranches` uses `git branch --format='%(refname:short)%00%(HEAD)%00%(upstream:short)'` — **local branches only in v1**
- `commit` uses `git commit -m <message>` via `execFile` (safe from injection since `execFile` does not use shell). Strip null bytes from message before passing.
- `switchBranch` uses `git switch -- <name>` (always use `--` to prevent argument confusion)
- `deleteBranch` uses `git branch -d -- <name>` (or `-D` when force=true)
- `validateBranchName` uses `git check-ref-format --branch <name>` — authoritative validation, no regex needed

#### 1.2 New Type Definitions

**File:** `src/types/index.ts`

```typescript
// Branch list item (renamed from GitBranchEntry to avoid confusion with GitBranchInfo)
export interface GitBranchListItem {
  name: string
  current: boolean
  upstream: string | null
}

// Working tree diff tab with 4-state discriminant
export interface WorkingTreeDiffTab {
  id: string
  type: 'working-tree-diff'
  filePath: string
  fileName: string
  diffKind: 'staged' | 'unstaged' | 'untracked' | 'deleted'
  projectId: string
}

// Update CenterTab union:
export type CenterTab = EditorTab | DiffTab | WorkingTreeDiffTab
```

#### 1.3 IPC Handlers

**File:** `electron/main/index.ts` (add after existing git handlers ~line 800)

Shared validation helper:

```typescript
function validateRelativeFilePaths(files: unknown): asserts files is string[] {
  if (!Array.isArray(files) || files.length === 0 || files.length > 500) {
    throw new Error('Invalid files array')
  }
  for (const f of files) {
    if (typeof f !== 'string' || f.length === 0 || f.length > 1000) {
      throw new Error('Invalid file path')
    }
    if (f.includes('..') || path.isAbsolute(f)) {
      throw new Error('File path must be relative and within project')
    }
  }
}
```

| Channel | Args | Validation |
|---------|------|------------|
| `git:stage-files` | `(projectPath, files: string[])` | validateProjectPath + validateRelativeFilePaths |
| `git:unstage-files` | `(projectPath, files: string[])` | same |
| `git:commit` | `(projectPath, message: string)` | validateProjectPath, message: string, non-empty, max 10000 chars, no null bytes |
| `git:discard-files` | `(projectPath, files: string[])` | validateProjectPath + validateRelativeFilePaths |
| `git:discard-all` | `(projectPath)` | validateProjectPath |
| `git:delete-untracked-files` | `(projectPath, files: string[])` | validateProjectPath + validateRelativeFilePaths |
| `git:get-index-file-content` | `(projectPath, filePath: string)` | validateProjectPath, filePath: non-empty, max 1000, no `..`, not starting with `:` |
| `git:list-branches` | `(projectPath)` | validateProjectPath |
| `git:create-branch` | `(projectPath, name: string)` | validateProjectPath, name: non-empty, max 255, validated via `git check-ref-format` |
| `git:switch-branch` | `(projectPath, name: string)` | validateProjectPath, name: non-empty, max 255, validated via `git check-ref-format` |
| `git:delete-branch` | `(projectPath, name: string, force: boolean)` | validateProjectPath, name: non-empty, max 255, validated via `git check-ref-format`, force: boolean |

**Critical**: Branch name validation applies to ALL three branch operations (create, switch, delete), not just create.

#### 1.4 Preload Bridge

**File:** `electron/preload/index.ts` (extend `git:` section ~line 437)

```typescript
git: {
  // existing methods...
  stageFiles: (projectPath: string, files: string[]): Promise<void> =>
    ipcRenderer.invoke('git:stage-files', projectPath, files),
  unstageFiles: (projectPath: string, files: string[]): Promise<void> =>
    ipcRenderer.invoke('git:unstage-files', projectPath, files),
  commit: (projectPath: string, message: string): Promise<string> =>
    ipcRenderer.invoke('git:commit', projectPath, message),
  discardFiles: (projectPath: string, files: string[]): Promise<void> =>
    ipcRenderer.invoke('git:discard-files', projectPath, files),
  discardAll: (projectPath: string): Promise<void> =>
    ipcRenderer.invoke('git:discard-all', projectPath),
  deleteUntrackedFiles: (projectPath: string, files: string[]): Promise<void> =>
    ipcRenderer.invoke('git:delete-untracked-files', projectPath, files),
  getIndexFileContent: (projectPath: string, filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('git:get-index-file-content', projectPath, filePath),
  listBranches: (projectPath: string): Promise<GitBranchListItem[]> =>
    ipcRenderer.invoke('git:list-branches', projectPath),
  createBranch: (projectPath: string, name: string): Promise<void> =>
    ipcRenderer.invoke('git:create-branch', projectPath, name),
  switchBranch: (projectPath: string, name: string): Promise<void> =>
    ipcRenderer.invoke('git:switch-branch', projectPath, name),
  deleteBranch: (projectPath: string, name: string, force: boolean): Promise<void> =>
    ipcRenderer.invoke('git:delete-branch', projectPath, name, force),
}
```

#### 1.5 ElectronAPI Type

**File:** `src/types/index.ts` (extend `git:` interface ~line 430)

Add all method signatures from 1.4 to `ElectronAPI.git` interface. This is the type-safety enforcement layer across the IPC boundary.

**Note**: Address overlap with `worktree:list-branches` (line 1029 of index.ts) — consider having `WorktreeService.listBranches` delegate to `GitService.listBranches` internally.

---

### Phase 2: Stage/Unstage + Commit UI

**File:** `src/components/FileExplorer/GitStatusPanel.tsx`

**Component extraction** (per architecture review): Extract commit form into `CommitForm.tsx` and file action buttons into helpers within `FileChangeItem` to prevent `GitStatusPanel` from becoming a god component.

#### 2.1 File Action Buttons

Modify `FileChangeItem` (~line 272) to add action buttons per file:

| Section | Buttons |
|---------|---------|
| **Staged** | `−` (unstage), click row → staged diff |
| **Modified** | `+` (stage), `✕` (discard), click row → working tree diff |
| **Untracked** | `+` (stage), `✕` (delete with confirmation), click row → diff (empty vs file) |
| **Conflicted** | `✓` Mark Resolved (= stage), click row → show file with conflict markers |

Buttons: small icon buttons (16px), appear on hover + always visible on touch. Use existing icon patterns from the codebase.

#### 2.2 Section Header Actions

Modify `FileChangeSection` (~line 227) to add header-level buttons:

| Section | Header Button |
|---------|--------------|
| **Staged** | "Unstage All" (−) |
| **Modified** | "Stage All" (+), "Discard All" (✕) |
| **Untracked** | "Stage All" (+) |

"Stage All" on Modified uses `git add -u` (tracked files only).
"Stage All" on Untracked uses `git add` with the specific untracked file paths.
Global "Stage All" is not needed — section-level is clearer.

#### 2.3 Commit Form

Extract to `src/components/FileExplorer/CommitForm.tsx`:

```
┌─────────────────────────────────────┐
│ Commit message...                   │
│                                     │
│                          [Commit]   │
└─────────────────────────────────────┘
```

- Multiline `<textarea>` with auto-resize (min 2 lines, max 6 lines)
- Placeholder: "Commit message"
- Commit button: disabled when no staged files OR empty message
- Loading state during commit (button shows spinner, disabled)
- **Ctrl+Enter** shortcut to commit (when textarea is focused)
- After successful commit: clear message, refresh status + commit log
- Error: show notification via `api.notification.show()`
- Commit message: local component state (not persisted to store — keeps it simple)

#### 2.4 Edge Cases & Research Insights

- **Double-fire prevention**: Use a `useRef` boolean guard (NOT `useState`) for the commit handler. React state batching is async; a ref check is synchronous and immediate. This prevents Ctrl+Enter keyboard repeat from creating duplicate commits:
  ```typescript
  const commitInFlight = useRef(false)
  const handleCommit = async () => {
    if (commitInFlight.current) return
    commitInFlight.current = true
    try { await api.git.commit(gitPath, message) }
    finally { commitInFlight.current = false }
  }
  ```
- **Partially staged file** (appears in both Staged and Modified): Both entries get appropriate buttons. Clicking staged entry opens diff with `diffKind: 'staged'` (index-vs-HEAD), clicking modified entry opens `diffKind: 'unstaged'` (working-tree-vs-index).
- **Empty repo** (no commits): Stage uses `git add`, commit works normally as initial commit. `getFileAtCommit('HEAD', file)` returns null → diff shows empty left side.
- **Batch operations**: Stage All / Unstage All / Discard All send all file paths in a single IPC call
- **All git operations** wrapped in `withOperationLock()` (see Race Condition Mitigation section)

---

### Phase 3: Working Directory Diffs

#### 3.1 Extend DiffEditorView

**File:** `src/components/Editor/DiffEditorView.tsx` (modify, NOT new file)

Extend the existing `DiffEditorView` to handle `WorkingTreeDiffTab` alongside `DiffTab`. The Monaco `DiffEditor` rendering is identical — only the content fetching differs. Add a content-fetching branch based on tab type:

| diffKind | Left (original) | Right (modified) |
|----------|-----------------|-------------------|
| `'unstaged'` | Index content via `api.git.getIndexFileContent()` | Working tree via `api.fs.readFile()` |
| `'staged'` | HEAD content via `api.git.getFileAtCommit(path, 'HEAD', file)` | Index content via `api.git.getIndexFileContent()` |
| `'untracked'` | Empty string | Working tree via `api.fs.readFile()` |
| `'deleted'` | HEAD content | Empty string |

**Performance: parallel content fetching:**
```typescript
const [original, modified] = await Promise.all([
  fetchOriginal(tab),
  fetchModified(tab),
])
```
This halves diff tab open time (from ~100-200ms to ~50-100ms).

**File size guard**: Before loading content into Monaco, check file size. If either side exceeds 512KB, show "File too large for inline diff" message instead:
```typescript
const MAX_DIFF_SIZE = 512 * 1024 // 512KB
if ((original?.length ?? 0) > MAX_DIFF_SIZE || (modified?.length ?? 0) > MAX_DIFF_SIZE) {
  setError('File too large for inline diff')
  return
}
```

Handle binary files: detect via null bytes and show "Binary file" message (existing pattern).

Use `cancelled` flag pattern (already in DiffEditorView) for cleanup on unmount.

#### 3.2 Open Working Tree Diff Tab

**File:** `src/stores/projectStore.ts`

Add `openWorkingTreeDiffTab(filePath, fileName, diffKind, projectId)` action:
- Deduplication: check for existing tab with same `filePath + diffKind` combination
- ID format: `wt-diff-${crypto.randomUUID()}`
- Enforce `MAX_EDITOR_TABS = 15` limit (evict oldest non-dirty tab if needed)
- Sets `activeCenterTabId` to the new tab

#### 3.3 Render in TerminalViewport

**File:** `src/components/Terminal/TerminalViewport.tsx` (~line 166)

Add case for `tab.type === 'working-tree-diff'` → render `<DiffEditorView>` (same component, different data).

Tab title: `"${fileName} (Working Tree)"`, `"${fileName} (Staged)"`, `"${fileName} (New File)"`, or `"${fileName} (Deleted)"` based on `diffKind`.

#### 3.4 Diff Tab Lifecycle

After stage/unstage/discard/commit:
- **Selective close**: Only close working-tree diff tabs for files whose status actually changed. The file list is already known (it was just passed to the IPC call):
  ```typescript
  const affectedPaths = new Set(files)
  const tabsToClose = centerTabs
    .filter(t => t.type === 'working-tree-diff' && affectedPaths.has(t.filePath))
    .map(t => t.id)
  tabsToClose.forEach(id => removeEditorTab(id))
  ```
- For **commit**: close all diff tabs with `diffKind: 'staged'` (staged files are now committed)
- For **branch switch**: close ALL working-tree diff tabs (full invalidation)
- Close diff tabs **before** awaiting branch switch to prevent flash of stale content

---

### Phase 4: Discard Changes

#### 4.1 Discard Confirmation Dialog

**File:** `src/components/FileExplorer/DiscardConfirmDialog.tsx` (new file)

Follow `DeleteConfirmDialog.tsx` pattern (store-driven state, not callback props, for consistency):
- Store state: `discardingFiles: { files: string[], isUntracked: boolean } | null`
- Store actions: `setDiscardingFiles()`, `clearDiscardingFiles()`
- Single file: "Discard changes to `filename`? This cannot be undone."
- Multiple files: "Discard changes to N files? This cannot be undone."
- Untracked single: "Delete untracked file `filename`? This cannot be undone."
- Untracked multiple: "Delete N untracked files? This cannot be undone."
- Deleted file: "Restore deleted file `filename`?"
- Cancel button auto-focused (destructive action safety)
- Escape closes, Enter does NOT confirm (safety pattern from existing dialog)
- Error state displayed inline in dialog (consistent with DeleteConfirmDialog)

#### 4.2 Discard Operations

| Source | Action | Git Command |
|--------|--------|-------------|
| Modified file | Discard | `git checkout -- <file>` via `discardFiles` |
| Untracked file | Delete | `git clean -f -- <file>` via `deleteUntrackedFiles` |
| Discard All (Modified section) | Discard all tracked modifications | `git checkout -- .` via `discardAll()` |
| Staged file | No direct discard | User must unstage first, then discard |

After discard: refresh git status, selectively close working-tree diff tabs for affected files.

---

### Phase 5: Branch Management Dropdown

#### 5.1 Branch Dropdown Component

**File:** `src/components/FileExplorer/BranchDropdown.tsx` (new file)

Triggered by clicking the branch name in `BranchSection` (~line 181 of GitStatusPanel).

```
┌──────────────────────────────────┐
│ 🔍 Filter branches...           │
├──────────────────────────────────┤
│ + New branch                     │
├──────────────────────────────────┤
│   ● main                        │ ← current (highlighted)
│     feat/git-tab    ✕            │ ← delete button
│     fix/bug-123     ✕            │
│                                  │
│ Showing 50 of N — type to filter │ ← only if > 50 branches
└──────────────────────────────────┘
```

Implementation:
- Use `createPortal` to `document.body` (like `ContextMenu.tsx`)
- Position below the branch name element
- Auto-adjust if near viewport edge
- Search filter: case-insensitive filter on local branches
- Keyboard: Arrow Up/Down navigate, Enter selects/switches, Escape closes
- Click outside closes — **but check for open confirmation dialog first** (prevent dropdown closing when clicking "Cancel" on delete confirmation)
- Search input auto-focuses on open
- **Cap initial render at 50 branches** — show "Showing 50 of N — type to filter" if more exist. Prevents DOM jank on repos with many branches.
- **Local branches only (v1)** — remote branches deferred to future iteration

#### 5.2 Branch Actions

| Action | Behavior |
|--------|----------|
| **Click local branch** | `git switch -- <branch>`, refresh all state |
| **New branch** | Expand inline input → type name → Enter creates + switches |
| **Delete (✕)** | Try `git branch -d --`, if fails (unmerged) → second confirmation offering force delete |
| **Current branch** | Highlighted, no click action, no delete button |

#### 5.3 Branch Name Validation

For "New branch" input:
- Validate **on submit** (not on keystroke) via `git check-ref-format --branch <name>` — this is authoritative and eliminates regex maintenance
- Show inline error below input if validation fails
- Disable create button while validation is in progress
- Basic client-side guard: reject empty string and strings > 255 chars immediately

#### 5.4 Branch Switch State

**Critical UX pattern** (from races review): Branch switch is async and can take seconds on large repos.

```typescript
const [switchingTo, setSwitchingTo] = useState<string | null>(null)

const handleSwitchBranch = async (name: string) => {
  if (switchingTo) return  // refuse while switching
  setSwitchingTo(name)
  closeDropdown()
  try {
    // Close diff tabs BEFORE switch to prevent stale flash
    closeAllWorkingTreeDiffTabs()
    await api.git.switchBranch(gitPath, name)
    await handleGitRefresh()
    clearDirectoryCache()  // refresh file explorer tree
  } catch (err) {
    api.notification.show('Branch switch failed', err instanceof Error ? err.message : 'Unknown error')
  } finally {
    setSwitchingTo(null)
  }
}
```

- Show spinner/loading text next to branch name while `switchingTo` is set
- Block fetch/pull/push buttons during switch
- Block all other git operations during switch

#### 5.5 Edge Cases

- **Dirty working tree on switch**: Surface git error in notification. Don't offer stash (out of scope).
- **Detached HEAD**: Show "(detached)" as branch name. Dropdown still works. User can create a branch to preserve work.
- **Branch list performance**: Fetch branch list on dropdown open (not eagerly). Cap at 50 rendered items.
- **After branch switch**: Refresh git status, commit log, file explorer, and clear directory cache. Close all working-tree diff tabs. Keep editor tabs — files that don't exist on the new branch will show "file not found" naturally.

---

## Keyboard Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| `Ctrl+Enter` | Commit | When commit textarea is focused |
| `Escape` | Close branch dropdown | When dropdown is open |
| `Escape` | Close discard dialog | When dialog is open |

No new global hotkeys needed — these are contextual.

---

## Concurrency Architecture

### Operation Lock (Generation Counter)

**Problem**: File watcher triggers git status refresh (500ms debounce). Git operations also trigger status refresh. These can race, causing UI flicker.

**Solution**: Generation counter pattern (NOT boolean flag):

```typescript
// In FileExplorer.tsx
const operationGeneration = useRef(0)

async function withOperationLock(fn: () => Promise<void>) {
  const gen = ++operationGeneration.current
  // Cancel any pending watcher-triggered refresh
  if (gitDebounceRef.current) clearTimeout(gitDebounceRef.current)
  try {
    await fn()
  } finally {
    // Only refresh if no newer operation started
    if (gen === operationGeneration.current) {
      if (gitDebounceRef.current) clearTimeout(gitDebounceRef.current)
      await handleGitRefresh()
    }
  }
}
```

The watcher callback checks the generation:
```typescript
const handleWatchEvents = () => {
  const genAtSchedule = operationGeneration.current
  if (gitDebounceRef.current) clearTimeout(gitDebounceRef.current)
  gitDebounceRef.current = setTimeout(() => {
    if (operationGeneration.current !== genAtSchedule) return  // stale
    handleGitRefreshRef.current()
  }, GIT_DEBOUNCE_MS)
}
```

### Refresh Reentrancy Guard

Prevent stale IPC responses from clobbering newer results:

```typescript
const refreshGeneration = useRef(0)

const handleGitRefresh = useCallback(async () => {
  const gen = ++refreshGeneration.current
  setGitStatusLoading(gitContextId, true)
  try {
    const status = await api.git.getStatus(gitPath)
    if (gen !== refreshGeneration.current) return  // stale, discard
    setGitStatus(gitContextId, status)
    // ... head hash check, commit log ...
  } finally {
    if (gen === refreshGeneration.current) {
      setGitStatusLoading(gitContextId, false)
    }
  }
}, [/* deps */])
```

### GitService Serialization

Serialize all mutating git operations per project path to prevent `index.lock` conflicts:

```typescript
// In GitService.ts
private operationQueue = new Map<string, Promise<void>>()

private async serialized<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = this.operationQueue.get(projectPath) ?? Promise.resolve()
  let result: T
  const next = prev.then(async () => { result = await fn() }, async () => { result = await fn() })
  this.operationQueue.set(projectPath, next.then(() => {}, () => {}))
  await next
  return result!
}
```

All mutating methods (`stageFiles`, `unstageFiles`, `commit`, `discardFiles`, `discardAll`, `deleteUntrackedFiles`, `switchBranch`, `createBranch`, `deleteBranch`) use `this.serialized()`. Read methods (`getStatus`, `getIndexFileContent`, `listBranches`) do NOT need serialization.

---

## Security Hardening

### Input Validation

Shared `validateRelativeFilePaths` helper with `asserts` return type for narrowing:

```typescript
function validateRelativeFilePaths(files: unknown): asserts files is string[] {
  if (!Array.isArray(files) || files.length === 0 || files.length > 500) {
    throw new Error('Invalid files array')
  }
  for (const f of files) {
    if (typeof f !== 'string' || f.length === 0 || f.length > 1000) throw new Error('Invalid file path')
    if (f.includes('..') || path.isAbsolute(f)) throw new Error('File path must be relative and within project')
  }
}
```

### Command Safety

| Rule | Applied to |
|------|-----------|
| Always use `--` before user-supplied paths/names | All git commands: `['add', '--', ...files]`, `['switch', '--', name]`, `['branch', '-d', '--', name]` |
| Branch name validation on ALL branch ops | `create-branch`, `switch-branch`, `delete-branch` — not just create |
| `execFile` only (never `exec`) | All git commands — prevents shell injection |
| Reject `..` and absolute paths in file arrays | `validateRelativeFilePaths` on stage/unstage/discard |
| Strip null bytes from commit messages | `message.replace(/\0/g, '')` before passing to git |
| Reject filePath starting with `:` | In `git:get-index-file-content` handler — prevents ref smuggling |

---

## Performance Optimizations

| Optimization | Location | Impact |
|-------------|----------|--------|
| **Parallel diff content fetching** | DiffEditorView | 2x faster diff tab opening |
| **File size guard (512KB)** | DiffEditorView | Prevents renderer freeze on large files |
| **Shallow equality check on setGitStatus** | projectStore.ts | Eliminates no-op re-renders from file watcher |
| **Chunked batch operations (100 per batch)** | GitService | Stays within Windows CreateProcessW 32K limit |
| **Cap branch dropdown at 50 items** | BranchDropdown | Prevents DOM jank on repos with many branches |
| **Cancel debounce timer in operation lock** | FileExplorer.tsx | Reduces unnecessary git subprocess spawning |

### Shallow equality for git status

```typescript
setGitStatus: (projectId, status) =>
  set((state) => {
    const existing = state.gitStatus[projectId]
    if (existing && shallowEqualGitStatus(existing, status)) return state
    return { gitStatus: { ...state.gitStatus, [projectId]: status } }
  }),
```

---

## Files Modified

| File | Changes |
|------|---------|
| `electron/main/services/GitService.ts` | Add 11 new methods + operation serialization |
| `electron/main/index.ts` | Add 11 new IPC handlers + `validateRelativeFilePaths` helper |
| `electron/preload/index.ts` | Expose 11 new git methods |
| `src/types/index.ts` | Add `WorkingTreeDiffTab`, `GitBranchListItem`, extend `ElectronAPI.git`, update `CenterTab` union |
| `src/components/FileExplorer/GitStatusPanel.tsx` | Add file action buttons, section header buttons, branch dropdown trigger |
| `src/components/FileExplorer/CommitForm.tsx` | **New** — Extracted commit form component |
| `src/components/Editor/DiffEditorView.tsx` | Extend to handle `WorkingTreeDiffTab` + file size guard |
| `src/components/FileExplorer/BranchDropdown.tsx` | **New** — Branch selector dropdown |
| `src/components/FileExplorer/DiscardConfirmDialog.tsx` | **New** — Discard confirmation dialog |
| `src/components/Terminal/TerminalViewport.tsx` | Handle `working-tree-diff` tab type |
| `src/stores/projectStore.ts` | Add `openWorkingTreeDiffTab`, `discardingFiles` state, shallow equality |
| `src/components/FileExplorer/FileExplorer.tsx` | Add generation counter operation lock |

## Acceptance Criteria

### Core Features
- [ ] Can stage individual files with + button in Modified and Untracked sections
- [ ] Can unstage individual files with − button in Staged section
- [ ] Can Stage All / Unstage All per section
- [ ] Can mark conflicted files as resolved (stage)
- [ ] Can type commit message and commit with button or Ctrl+Enter
- [ ] Commit button disabled when no staged files or empty message
- [ ] Commit clears message and refreshes status + log
- [ ] Click modified file → opens working tree diff tab in center area
- [ ] Click staged file → opens staged diff tab (index vs HEAD)
- [ ] Click untracked file → opens diff showing new file content
- [ ] Can discard individual modified files with confirmation
- [ ] Can discard all modified files with confirmation
- [ ] Can delete individual untracked files with confirmation
- [ ] Can click branch name → dropdown with search, local branches
- [ ] Can switch branches from dropdown
- [ ] Can create new branch from dropdown with name validation
- [ ] Can delete non-current local branches (safe delete, with force option on failure)

### Quality Gates
- [ ] Dirty working tree branch switch errors shown clearly
- [ ] All operations work correctly in worktree context
- [ ] No race conditions between operations and file watcher refreshes
- [ ] No duplicate commits from Ctrl+Enter keyboard repeat
- [ ] No index.lock errors from rapid staging operations
- [ ] All IPC handlers validate inputs (paths, branch names, file arrays)
- [ ] Files > 512KB show "too large" message instead of freezing Monaco
- [ ] Branch dropdown performs well with 500+ branches (capped rendering)
- [ ] Diff tabs close selectively (only affected files), not all tabs

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-17-git-tab-feature-complete-brainstorm.md](docs/brainstorms/2026-03-17-git-tab-feature-complete-brainstorm.md) — Key decisions: file-level staging (no hunks), dropdown branch selector, per-file + all discard with confirmation, working tree diffs in center area via Monaco, no stash/amend.

### Internal References

- IPC 4-layer pattern: `docs/solutions/code-review/github-context-menu-integration.md`
- Git commit history plan: `docs/plans/2026-02-13-feat-git-commit-history-in-sidebar-plan.md`
- Existing GitService: `electron/main/services/GitService.ts`
- Existing DiffEditorView: `src/components/Editor/DiffEditorView.tsx`
- Confirmation dialog pattern: `src/components/FileExplorer/DeleteConfirmDialog.tsx`
- Context menu pattern: `src/components/Sidebar/ContextMenu.tsx`
- Path validation security: `docs/solutions/security-issues/tasks-ipc-path-traversal-and-review-fixes.md`
- File watcher serialization: `docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md`
- Event handler double-fire: `docs/solutions/logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md`
- IPC naming conventions: `docs/solutions/code-review/terminal-link-feature-review-fixes.md`

### Research Sources

- Electron IPC Security: https://www.electronjs.org/docs/latest/tutorial/security
- Monaco DiffEditor API: https://microsoft.github.io/monaco-editor/typedoc/functions/editor.createModel.html
- Git check-ref-format: https://git-scm.com/docs/git-check-ref-format
