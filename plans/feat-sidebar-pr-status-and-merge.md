# feat: Show PR status, diff stats & merge button in sidebar

## Overview

Add GitHub PR development status information to each worktree/project in the left sidebar. Users see at a glance whether a PR exists, if CI checks pass, if there are merge conflicts, diff stats (+/-), and can merge & squash directly when ready.

## Problem Statement

Currently the sidebar only shows branch names and terminal state. Developers constantly switch to GitHub to check PR status, CI results, and merge readiness. This context switching slows down workflow. Bringing this info into the sidebar makes the development lifecycle visible at a glance.

## Proposed Solution

For each worktree (branch) in the sidebar, query `gh` CLI for PR status and display:

1. **PR link** - PR number, clickable to open in browser
2. **CI status** - Overall check status (pass/fail/pending) with tooltip showing individual checks
3. **Merge conflicts** - Conflict indicator (present/absent)
4. **Diff stats** - `+1100 -900` compact format
5. **Review status** - Approved / Changes requested / Review required
6. **Merge & Squash button** - Only visible when: no conflicts AND all required checks pass

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  GitHubService (electron/main/services/)             │
│  - Uses child_process.execFile('gh', [...])          │
│  - Polls every 60s per active worktree               │
│  - Pushes updates via webContents.send()             │
└──────────────────────┬──────────────────────────────┘
                       │ IPC: github:pr-status
                       ▼
┌─────────────────────────────────────────────────────┐
│  Zustand Store (prStatus: Record<string, PRStatus>) │
│  - Not persisted (memory only)                       │
│  - Keyed by worktreeId or projectId+branch           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  WorktreeItem.tsx / SortableProjectItem.tsx          │
│  - PR status badges, diff stats, merge button        │
└─────────────────────────────────────────────────────┘
```

### `gh` CLI Commands

```bash
# Get PR status for current branch in a worktree
gh pr view --json number,title,state,url,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,headRefName

# Merge & squash
gh pr merge <number> --squash --delete-branch
```

### Key Type Definitions

```typescript
// src/types/index.ts
interface PRStatus {
  noPR: boolean
  number?: number
  title?: string
  url?: string
  state?: 'OPEN' | 'CLOSED' | 'MERGED'
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeStateStatus?: 'CLEAN' | 'DIRTY' | 'BLOCKED' | 'UNSTABLE' | 'UNKNOWN'
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  statusCheckRollup?: { name: string; state: string; bucket: string }[]
  additions?: number
  deletions?: number
  changedFiles?: number
  loading?: boolean
  error?: string
  lastUpdated?: number
}
```

### Sidebar UI Layout (per worktree)

```
┌──────────────────────────────────────────┐
│ 🔀 feature/auth          PR #42 ↗       │
│   ✅ CI  ⚠️ Conflicts  +1100 -900       │
│   👤 Approved                             │
│   [Merge & Squash]  (if ready)           │
└──────────────────────────────────────────┘
```

Compact version (collapsed):
```
│ 🔀 feature/auth  #42 ✅ +1100 -900      │
```

## Acceptance Criteria

### Functional Requirements

- [ ] For each worktree with a branch, query `gh pr view` to check if a PR exists
- [ ] Display PR number as clickable link opening GitHub in browser
- [ ] Show CI check rollup status: green check (all pass), red X (any fail), yellow dot (pending)
- [ ] Show merge conflict indicator when `mergeable === 'CONFLICTING'`
- [ ] Show diff stats in `+N -N` format with green/red coloring
- [ ] Show review status (Approved / Changes Requested / Review Required)
- [ ] Show "Merge & Squash" button ONLY when:
  - `mergeable === 'MERGEABLE'`
  - All required checks pass (`mergeStateStatus === 'CLEAN'`)
- [ ] Merge button executes `gh pr merge <number> --squash --delete-branch`
- [ ] Show confirmation dialog before merge
- [ ] Poll every 60 seconds for status updates
- [ ] Pause polling when app window is not focused
- [ ] Resume polling (with immediate fetch) when window regains focus
- [ ] Gracefully handle `gh` CLI not installed (show setup hint, hide PR features)
- [ ] Gracefully handle `gh` not authenticated (show auth hint)
- [ ] Show loading skeleton on initial fetch
- [ ] Manual refresh button per worktree

### Non-Functional Requirements

- [ ] Max 5 concurrent `gh` child processes
- [ ] 10-second timeout per `gh` call
- [ ] Use `child_process.execFile` (not shell) to prevent command injection
- [ ] Validate all branch names and paths before passing to `gh`
- [ ] Exponential backoff on rate limit (403) responses

## Implementation Plan

### Phase 1: GitHubService + Types

**Files to create/modify:**

- `electron/main/services/GitHubService.ts` (NEW)
  - `isGhInstalled(): Promise<boolean>`
  - `isGhAuthenticated(): Promise<boolean>`
  - `getPRStatus(projectPath: string): Promise<PRStatus>`
  - `mergePR(projectPath: string, prNumber: number): Promise<void>`
  - `startPolling(projectId: string, worktreeId: string, path: string)`
  - `stopPolling(worktreeId: string)`
  - `stopAllPolling()`

- `src/types/index.ts` - Add `PRStatus` interface, extend `ElectronAPI`

### Phase 2: IPC Wiring

**Files to modify:**

- `electron/main/index.ts` - Add IPC handlers:
  - `github:check-available` → check if `gh` installed + authenticated
  - `github:get-pr-status` → one-shot status fetch
  - `github:start-polling` → start periodic polling for a worktree
  - `github:stop-polling` → stop polling for a worktree
  - `github:merge-pr` → execute merge & squash
  - Push event: `github:pr-status-update` → send status to renderer

- `electron/preload/index.ts` - Expose github API methods via contextBridge

### Phase 3: Store + Event Manager

**Files to modify:**

- `src/stores/projectStore.ts` - Add:
  - `prStatus: Record<string, PRStatus>` (worktreeId → status)
  - `setPRStatus(worktreeId: string, status: PRStatus)`
  - `ghAvailable: boolean | null`

- `src/utils/githubEvents.ts` (NEW) - Centralized PR status subscription manager (mirrors `terminalEvents.ts` pattern)

### Phase 4: Sidebar UI

**Files to modify:**

- `src/components/Worktree/WorktreeItem.tsx` - Add PR status display:
  - PR number badge (clickable)
  - CI status icon
  - Conflict indicator
  - Diff stats (`+N -N`)
  - Review status badge
  - Merge & Squash button (conditional)

- `src/components/Sidebar/PRStatusBadge.tsx` (NEW) - Reusable status badge component

### Phase 5: Lifecycle Management

**Files to modify:**

- `src/components/Worktree/WorktreeItem.tsx` - Start/stop polling on mount/unmount
- `electron/main/index.ts` - Stop all polling on `before-quit`
- Window focus/blur handlers to pause/resume polling

## Additional Useful Information to Display

Beyond the core requirements, consider showing:

1. **Behind/ahead count** - Already available from GitService (`branch.ahead`, `branch.behind`)
2. **PR age** - "Opened 3 days ago" from `createdAt`
3. **Review count** - "2/3 approvals" if branch protection requires multiple
4. **Last CI run time** - "CI ran 5 min ago" from `completedAt`
5. **Changed files count** - "12 files" from `changedFiles`
6. **PR labels** - Show relevant labels like "ready-for-review", "WIP"

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `gh` not installed | Show one-time hint "Install GitHub CLI for PR status", hide all PR features |
| `gh` not authenticated | Show "Run `gh auth login`" hint |
| No PR for branch | Show muted "No PR" text |
| PR merged externally | Next poll shows "Merged" state, hide merge button |
| Merge fails | Toast notification with error, re-poll immediately |
| Rate limited | Exponential backoff, show subtle "Rate limited" indicator |
| Offline | Show last known status (no persistence, so blank on restart) |
| Detached HEAD | Skip PR status check entirely |
| Multiple PRs for branch | Use first open PR (`state: OPEN`) |

## References

- Existing sidebar: `src/components/Sidebar/Sidebar.tsx`
- Worktree item: `src/components/Worktree/WorktreeItem.tsx`
- Git service: `electron/main/services/GitService.ts`
- Worktree service: `electron/main/services/WorktreeService.ts`
- IPC types: `src/types/index.ts`
- Preload: `electron/preload/index.ts`
- Store: `src/stores/projectStore.ts`
- Terminal events pattern: `src/utils/terminalEvents.ts`
- [gh pr view docs](https://cli.github.com/manual/gh_pr_view)
- [gh pr merge docs](https://cli.github.com/manual/gh_pr_merge)
