---
title: Worktree merge button hidden while PR badge stays visible
date: 2026-07-02
category: ui-bugs
module: Sidebar worktree PR status
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Merge button on a worktree PR row does not appear even though a PR exists and is open"
  - "The PR badge (#number + status chip) shows, but no merge button next to it"
  - "Button reappears after an app restart or manual refresh, then vanishes again after a push"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [gh-cli, pr-mergeability, merge-button, worktree, pr-status, ui-visibility]
related_components: [github-service, pr-status-polling]
---

# Worktree merge button hidden while PR badge stays visible

## Problem
The Merge button on a worktree's PR row would disappear while the PR badge stayed visible, so an open, mergeable PR looked un-mergeable from the sidebar. The badge and the button hung on different visibility predicates, and the button's stricter predicate failed during GitHub's normal lazy-mergeability window and on any transient `gh` error.

## Symptoms
- Worktree shows the PR row (`#number` + status chip) but no merge button.
- Happens right after creating a PR or pushing to its branch, and after transient `gh` failures.
- A restart or manual refresh brings the button back — until the next push flips it off again.

## What Didn't Work
- Looking for a code regression in the button's visibility condition: `git log -S "mergeable === 'MERGEABLE'"` showed the `=== 'MERGEABLE'` gate had existed since the feature's first commit (#13) — it was never `!== 'CONFLICTING'`. So the strict gate was not a *new* code change.
- Suspecting a stale persisted store value: `prStatus`/`ghAvailable` are not in the persist `partialize`, so a fresh poll runs every launch. Not the cause.

## Solution
The button and badge diverged: the badge renders on `state === 'OPEN'`, but the button required `mergeable === 'MERGEABLE' && !stale`. Two normal conditions then hid the button while the PR was actually mergeable:

1. **GitHub computes mergeability lazily.** `gh pr view --json mergeable` returns `UNKNOWN` right after PR creation and after every push, until a later poll resolves it. (Note: `gh pr view` *triggers* the compute; `gh pr list` does not and can report `UNKNOWN` indefinitely for the same PR.)
2. **The `!stale` gate (added in #127)** drops the button on any transient `gh` poll failure, leaving the dimmed badge but no button.

Fix — extract the inline, untested condition into a pure predicate gated only on the one hard block, and drop `!stale`:

```ts
// src/utils/prBadge.ts
export function shouldShowMergeButton(prStatus: PRStatus | undefined): boolean {
  if (!prStatus || prStatus.noPR) return false
  if (prStatus.state !== 'OPEN') return false
  return prStatus.mergeable !== 'CONFLICTING'
}
```

```tsx
// src/components/Worktree/WorktreeItem.tsx — before
const showMergeButton =
  prStatus && !prStatus.noPR && prStatus.state === 'OPEN' &&
  prStatus.mergeable === 'MERGEABLE' && !prStatus.stale
// after
const showMergeButton = shouldShowMergeButton(prStatus)
```

## Why This Works
`UNKNOWN` is a *lazy-compute* state, not a conflict — treating it like a hard block was the wrong reading of the gh API. Showing the button on `UNKNOWN`/`stale` is safe because the merge runs `gh pr merge` against GitHub's **live** state (never the cached `prStatus`); a genuinely conflicting or closed PR is rejected server-side and surfaces as a "Merge Failed" notification. The click-time `window.confirm` and a fresh `hasChanges` check are the real guardrails, and the destructive worktree removal only runs *after* a successful merge. `CONFLICTING` stays the only condition that hides the button.

## Prevention
- **Don't gate a UI control and its adjacent status indicator on different predicates** unless the divergence is intentional and tested. Here badge = `OPEN`, button = `MERGEABLE && !stale`; that gap is the bug.
- **Don't gate a destructive control on cached remote status when the action itself validates live.** Gate on the hard blocker (`!== 'CONFLICTING'`) and let `gh pr merge` be the source of truth.
- **Treat gh `mergeable: UNKNOWN` as "computing", not "unmergeable".** See [[gh-pr-mergeable-unknown]] memory.
- Extract visibility predicates into pure, unit-tested functions (as `getPRBadge` already was). Regression test added in `test/prBadge.test.ts`: `stale: true` + `mergeable: 'MERGEABLE'` → button shows.

## Related Issues
- `docs/solutions/integration-issues/gh-statuscheckrollup-duplicate-check-runs.md` — same `gh` PR-status pipeline (`GitHubService.getPRStatus`).
- PR #127 introduced the `!stale` gate; PR #151 relaxed the merge-button predicate.
