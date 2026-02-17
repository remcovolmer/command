---
status: pending
priority: p2
issue_id: "033"
tags: [code-review, agent-native, git, file-watcher]
dependencies: []
---

# Git Status Blind to .git/ Changes (Commits, Branch Switches)

## Problem Statement

The watcher ignores `**/.git/**` (correctly, to avoid noise), but this means git-only operations by agents - `git commit`, `git checkout`, `git rebase`, `git pull`, `git stash` - produce zero watcher events. The git status panel stays stale until the agent modifies a working-tree file.

This is the most significant gap in agent-native reactivity. The old 10-second polling caught these changes; the new event-driven system does not.

## Findings

**Files:**
- `electron/main/services/FileWatcherService.ts:21` - `.git/**` in IGNORE_PATTERNS
- `src/components/FileExplorer/FileExplorer.tsx:164-188` - git subscriber only fires on watcher events

When Claude Code runs `git commit -m "..."`, only `.git/` files change. No working-tree files change. No events. Git status stays stale.

## Proposed Solutions

### Option A: Watch .git/HEAD specifically (Recommended)
Add a lightweight fs.watch on `<projectPath>/.git/HEAD` in FileWatcherService. When HEAD changes (commit, checkout, rebase), emit a synthetic event or a dedicated `git-ref-changed` signal. This is what VS Code does.

**Pros:** Catches commits, branch switches, rebases. Minimal overhead (1 file watch).
**Cons:** Doesn't catch stash or reflog-only changes. Needs separate watcher logic.
**Effort:** Medium

### Option B: Trigger git refresh on Claude state transition
When ClaudeHookWatcher detects `busy` -> `done` transition, trigger a single git status refresh. Agents likely performed git operations during their work.

**Pros:** Simple, catches all agent git operations indirectly
**Cons:** Doesn't help with non-Claude external git operations. Couples git refresh to terminal state.
**Effort:** Small

### Option C: Hybrid - both A and B
Watch `.git/HEAD` for external git operations + refresh on Claude `done` state for completeness.

**Pros:** Most comprehensive
**Cons:** More complexity
**Effort:** Medium

## Acceptance Criteria
- [ ] Git status updates after agent commits
- [ ] Branch name updates after agent checkout
- [ ] Commit log refreshes after agent commits
