---
title: "Git-event automations: PR context injection and merge-conflict trigger"
date: 2026-02-26
category: integration-issues
tags:
  - automations
  - git-events
  - pr-context
  - template-variables
  - merge-conflict
  - worktrees
  - electron-ipc
  - prompt-injection
severity: enhancement
component:
  - electron/main/services/GitHubService.ts
  - electron/main/services/AutomationService.ts
  - electron/main/services/AutomationRunner.ts
  - electron/main/services/AutomationPersistence.ts
  - electron/main/index.ts
  - electron/preload/index.ts
  - src/types/index.ts
  - src/components/FileExplorer/AutomationCreateDialog.tsx
related:
  - docs/solutions/integration-issues/automations-system-architecture-patterns.md
  - docs/brainstorms/2026-02-23-automations-brainstorm.md
  - docs/plans/2026-02-23-feat-automations-plan.md
pr: https://github.com/remcovolmer/command/pull/52
---

# Git-Event Automations: PR Context Injection and Merge-Conflict Trigger

## Problem

Automations triggered by git events (`pr-merged`, `pr-opened`, `checks-passed`) had no context about which PR or branch triggered them. The automation ran Claude in a fresh worktree from HEAD with the prompt sent as-is — no PR metadata, no branch checkout. This made git-event automations essentially useless for PR-specific tasks like "fix merge conflicts on PR #X" or "address review feedback on the feature branch."

Specific gaps:
1. No PR metadata (number, title, branch, URL, mergeable status) passed to the automation prompt
2. Worktrees always created from HEAD, not the PR's branch
3. No template variable system for embedding PR context in prompts
4. No `merge-conflict` event type despite being a common automation trigger

## Solution Overview

Four capabilities added across 8 files:

1. **`PREventContext` type** — Lean 6-field interface carrying PR metadata through the event chain
2. **Template variable replacement** — `{{pr.number}}`, `{{pr.title}}`, `{{pr.branch}}`, `{{pr.url}}`, `{{pr.mergeable}}`, `{{pr.state}}` replaced in prompts before execution
3. **Source branch checkout** — Worktrees created on the PR branch (with fallback to HEAD)
4. **`merge-conflict` trigger** — Fires when a PR's `mergeable` state transitions to `CONFLICTING`

## Architecture

### Data Flow

```
GitHubService.pollOnce()
  ├── Detects state transition (pr-merged, checks-passed, merge-conflict, pr-opened)
  ├── Builds PREventContext from current PRStatus
  └── emitPREvent(projectPath, event, prContext)
        │
        ▼
AutomationService.handleGitEventTrigger(projectPath, event, prContext)
  ├── Matches enabled automations by event type and project
  ├── Calls triggerRun(automationId, projectPath, projectId, prContext)
  │     ├── Template replacement: {{pr.*}} → actual values
  │     ├── Strips unresolved {{pr.*}} tokens
  │     └── Passes sourceBranch to runner (skipped for merged PRs)
  └──────────────▼
AutomationRunner.run(runId, automationId, resolvedPrompt, projectPath, { sourceBranch })
  ├── If sourceBranch set: checkout PR branch in worktree (with fallback to HEAD)
  └── Spawns `claude -p <prompt> --dangerously-skip-permissions` in worktree
```

### Key Types

```typescript
// GitHubService.ts — canonical definition
export type GitEvent = 'pr-merged' | 'pr-opened' | 'checks-passed' | 'merge-conflict'

export interface PREventContext {
  number: number
  title: string
  branch: string      // headRefName from GitHub API
  url: string
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  state: 'OPEN' | 'CLOSED' | 'MERGED'
}
```

The `GitEvent` type alias is duplicated in 4 locations due to Electron process isolation:
- `GitHubService.ts` (canonical)
- `AutomationPersistence.ts` (main process, cannot import renderer types)
- `src/types/index.ts` (renderer types)
- `electron/preload/index.ts` (bridge layer)

Each duplicate has a `// Keep in sync with GitHubService.GitEvent` comment.

## Design Decisions

### Why `PREventContext` instead of full `PRStatus`?

`PRStatus` has 15+ fields including UI-specific ones (`loading`, `lastUpdated`). `PREventContext` carries only the 6 fields relevant to automation execution — keeps the interface lean and decoupled from the polling UI.

### Why strip unresolved `{{pr.*}}` tokens?

When automations are triggered manually (no PR context), or when `prContext` is missing fields, unresolved template variables like `{{pr.branch}}` would be sent literally to Claude. Stripping them with `resolvedPrompt.replace(/\{\{pr\.\w+\}\}/g, '')` prevents confusion.

### Why skip `sourceBranch` for merged PRs?

When `state === 'MERGED'`, GitHub deletes the head branch. Attempting to checkout would fail. The worktree falls back to HEAD, but template variables are still populated so the prompt has full context.

### Why `buildContext` returns `PREventContext | null`?

The `PRStatus` from `getPRStatus()` can have undefined fields (e.g., `number` is optional). Instead of using non-null assertions (`s.number!`), the builder returns `null` when required fields are missing, and all call sites guard against it.

### Why runtime IPC validation for triggers?

The `electron/main/index.ts` IPC handlers previously used bare `as AutomationTrigger` casts on user input. The new `validateTrigger()` function validates structure and enum values at runtime, preventing malformed triggers from entering the persistence layer.

## Merge-Conflict Detection

Added to `GitHubService.pollOnce()` alongside existing transition detection:

```typescript
// Existing: detect pr-merged, checks-passed, pr-opened
// New: detect merge-conflict
if (prev.mergeable !== 'CONFLICTING' && status.mergeable === 'CONFLICTING') {
  this.emitPREvent(projectPath, 'merge-conflict', prContext)
}
```

This fires once per transition (not on every poll where `mergeable === 'CONFLICTING'`), because it compares the previous state with the current state.

## Template Variable System

Prompts containing `{{pr.*}}` placeholders are resolved before execution:

```typescript
let resolvedPrompt = automation.prompt
if (prContext) {
  resolvedPrompt = resolvedPrompt
    .replace(/\{\{pr\.number\}\}/g, String(prContext.number))
    .replace(/\{\{pr\.title\}\}/g, prContext.title)
    .replace(/\{\{pr\.branch\}\}/g, prContext.branch)
    .replace(/\{\{pr\.url\}\}/g, prContext.url)
    .replace(/\{\{pr\.mergeable\}\}/g, prContext.mergeable)
    .replace(/\{\{pr\.state\}\}/g, prContext.state)
}
// Strip any unresolved tokens (manual trigger, missing fields)
resolvedPrompt = resolvedPrompt.replace(/\{\{pr\.\w+\}\}/g, '')
```

## Source Branch Worktree

When `sourceBranch` is provided, the runner attempts to checkout the PR branch:

```typescript
if (sourceBranch) {
  try {
    worktreePath = await this.serializedWorktreeCreate(projectPath, sourceBranch, worktreeDirName)
    branchName = sourceBranch
  } catch (error) {
    console.warn(`Failed to checkout "${sourceBranch}", falling back to HEAD`)
    worktreePath = await this.serializedWorktreeCreate(projectPath, worktreeDirName)
  }
} else {
  worktreePath = await this.serializedWorktreeCreate(projectPath, worktreeDirName)
}
```

The `worktreeName` parameter allows creating a worktree directory named `auto-xxx-timestamp` while checking out an existing branch (the PR branch).

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| PR merged (branch deleted) | `sourceBranch` skipped, worktree from HEAD, template vars still populated |
| Branch deleted between event and worktree creation | Runner catches error, falls back to HEAD, logs warning |
| Manual trigger (no PR context) | `prContext` undefined, no replacement, unresolved tokens stripped |
| PR branch already in use by another worktree | `WorktreeService` throws, runner falls back to HEAD |
| `buildContext` called with partial PRStatus | Returns `null`, event emission skipped |
| Existing automations without `{{pr.*}}` | Replace calls are no-ops, fully backward compatible |

## Prevention Strategies

### Prompt Injection Risk

PR titles and branch names are user-controlled and injected into Claude prompts running with `--dangerously-skip-permissions`. On public repos, a malicious PR title could manipulate Claude's behavior. Mitigated with:
- UI warning on the automation create dialog for public repos
- Awareness that template variables carry untrusted content

### Type Duplication Drift

The `GitEvent` union is duplicated in 4 files due to process isolation. To prevent drift:
- Each duplicate has a "keep in sync" comment pointing to the canonical definition
- Runtime validation in `validateTrigger()` catches mismatches at the IPC boundary
- Adding a new event requires updating all 4 locations

### Non-Null Assertion Avoidance

The `buildContext` pattern (returning `T | null` instead of asserting) should be used whenever constructing types from optional API responses. Guard at call sites rather than asserting inside builders.

## Files Modified

| File | Changes |
|------|---------|
| `GitHubService.ts` | `PREventContext`, `GitEvent`, `headRefName`, merge-conflict detection, widened event signatures |
| `AutomationService.ts` | Template replacement, `sourceBranch` pass-through, unresolved token stripping |
| `AutomationRunner.ts` | `sourceBranch` option, fallback worktree creation, flattened error handling |
| `AutomationPersistence.ts` | `GitEvent` type alias, `merge-conflict` in trigger union |
| `src/types/index.ts` | `GitEvent` export, `headRefName` on `PRStatus` |
| `electron/preload/index.ts` | `headRefName` on `PRStatus` |
| `electron/main/index.ts` | `validateTrigger()` runtime validation, `VALID_GIT_EVENTS` array |
| `AutomationCreateDialog.tsx` | Merge-conflict option, template variable hints, prompt injection warning |

## Verification

1. `npx tsc --noEmit` — no new type errors (pre-existing croner/xterm errors excluded)
2. Existing tests pass
3. Manual test: automation with `checks-passed` trigger and `{{pr.branch}}` in prompt checks out PR branch
4. Manual test: `merge-conflict` trigger fires on mergeable → CONFLICTING transition
5. Backward compatible: existing automations without template variables work unchanged
