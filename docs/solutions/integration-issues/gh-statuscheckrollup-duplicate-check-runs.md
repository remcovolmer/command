---
title: gh statusCheckRollup returns every check run, not one per name
date: 2026-06-22
category: integration-issues
module: GitHubService / sidebar PR status
problem_type: integration_issue
component: tooling
symptoms:
  - "CI check names appear two or three times each in the worktree PR-status popover"
  - "Composite PR badge stays on CI ✗ even after a failed check was re-run and passed"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [gh-cli, github, ci-checks, statuscheckrollup, deduplication, pr-status]
---

# gh statusCheckRollup returns every check run, not one per name

## Problem
`gh pr view --json statusCheckRollup` returns **every** check run on the head commit, not a latest-per-name rollup. Code that maps it 1:1 renders each CI job multiple times and lets a stale failed run mask a newer passing one.

## Symptoms
- CI check names repeat 2-3× in the sidebar PR-status popover (`cleanup`, `deploy-backend`, `comment-pr`, …).
- The composite PR badge (`getPRBadge`, `some(c => c.bucket === 'fail')`) shows `CI ✗` even after the failing job was re-run and passed.

## What Didn't Work
- Suspecting the React render or the Zustand store. Ruled out: the popover keys each row by index and renders one row per array element, and `setPRStatus` replaces the entry wholesale (`prStatus: { ...state.prStatus, [key]: status }`) — no accumulation across polls. The duplication was entirely in the upstream `gh` payload.

## Solution
GitHub keeps a separate check run for every workflow execution on the same commit. Re-runs, and workflows that trigger on multiple events (e.g. `push` **and** `pull_request`), each leave a run that shares the job `name`. `statusCheckRollup` returns all of them. Each context carries `startedAt`, `completedAt`, and `workflowName`, so dedupe at the data source — one entry per `(name, workflow)`, keeping the most recent run:

```ts
function dedupeChecks(raw: Array<Record<string, string>>): PRCheckStatus[] {
  const latest = new Map<string, { check: PRCheckStatus; ts: string }>()
  for (const c of raw) {
    const name = c.name ?? c.context ?? 'unknown'
    const key = `${name}\u0000${c.workflowName ?? ''}` // NUL separator avoids name/workflow collisions
    const ts = c.completedAt ?? c.startedAt ?? c.createdAt ?? ''
    const existing = latest.get(key)
    // Map.set on an existing key keeps its original insertion position,
    // so survivors retain first-appearance order.
    if (!existing || ts > existing.ts) {
      latest.set(key, { check: { name, state: c.status ?? c.state ?? '', bucket: checkBucket(c) }, ts })
    }
  }
  return Array.from(latest.values(), (v) => v.check)
}
```

## Why This Works
Keeping the latest run per `(name, workflow)` matches what GitHub's own PR UI and `gh pr checks` display. It collapses the duplicates and, because the surviving run is the most recent, an old failure can no longer mask a newer pass — fixing both the visible repetition and the false-fail badge from one change. Keying on `name + workflowName` (rather than `name` alone) preserves genuinely distinct checks when two different workflows happen to share a job name.

## Prevention
- **Dedupe at the data boundary, not the render layer.** Every downstream consumer (popover, merge-warning tooltip, badge logic, automation triggers) reads the same array, so deduping once in `getPRStatus` fixes all of them. Deduping in the component would leave the others wrong.
- **Never embed a literal NUL (`\u0000`) byte in source** — git marks the file binary and diffs stop rendering. Write the escape sequence `\u0000` in the string literal; it evaluates to the same separator at runtime.
- Regression tests in `test/githubService.test.ts`: dedupe-to-latest; latest-wins regardless of array order (stale-fail→pass guard); same-name-different-workflow both survive. The prior single-unique-check test never exercised the dedupe path.

## Related Issues
- PR remcovolmer/command#140 — the fix.
- `docs/solutions/integration-issues/git-event-automation-pr-context-injection.md` — also consumes `GitHubService` PR status, different angle.
