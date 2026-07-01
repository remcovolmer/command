---
title: "Chokidar v4 Upgrade Silently Broke Glob Ignores: 90s Typing Lag on Project Switch"
date: 2026-06-30
category: performance-issues
tags: [file-watcher, chokidar, dependency-upgrade, glob, ipc, typing-lag, worktree, electron, regression]
severity: high
component: FileWatcherService
symptoms:
  - Severe typing lag (~90s) in the Claude chat after switching projects
  - Lag is directional — worse when switching TO a worktree-heavy project
  - Keystrokes appear delayed even though the chat is otherwise functional
  - No error, no crash — purely a sustained slowdown that clears on its own
root_cause: "chokidar v4 dropped glob support; the existing `**/node_modules/**`-style ignore strings silently matched nothing, so every project switch re-walked the entire tree (all node_modules + every nested worktree), saturating the main process and delaying keystroke IPC to the PTY"
files_changed:
  - electron/main/services/FileWatcherService.ts
  - test/fileWatcher.test.ts
---

# Chokidar v4 Upgrade Silently Broke Glob Ignores: 90s Typing Lag on Project Switch

## Context

`FileWatcherService` runs one chokidar watcher on the active project root and tears it down / rebuilds it on every project switch (`switchTo()` → `stopAll()` + `startWatching()`). The watcher was configured with a glob-based ignore list:

```typescript
// BEFORE — dead under chokidar v4
const IGNORE_PATTERNS = [
  '**/node_modules/**', '**/.git/**', '**/dist/**', /* ... */ '**/Thumbs.db',
]
// ...
const watcher = watch(projectPath, { ignoreInitial: true, ignored: IGNORE_PATTERNS, /* ... */ })
```

This worked under chokidar v3. After the dependency was bumped to **chokidar `^4.0.3`**, switching into a project with many nested worktrees produced ~90 seconds of typing lag in the chat before responsiveness returned.

## Root Cause

**chokidar v4 removed glob support entirely.** The `ignored` option now accepts only a path string, a `RegExp`, or a predicate `(path, stats?) => boolean`. A glob string like `**/node_modules/**` is no longer interpreted as a glob — it is treated as a literal that never equals or prefixes any real absolute path. **The entire ignore list became a silent no-op.**

Consequences, all invisible because nothing errors:

1. **The watcher walks everything.** `ignoreInitial: true` only suppresses `add` *events* during the initial scan — chokidar still traverses the full tree to build its watch state. With ignores dead, that traversal now descends into every `node_modules` (an Electron app: ~80k files each).
2. **Worktrees multiply the cost.** `.worktrees/` was never in the ignore list at all. Git worktrees live *inside* the project root (`<repo>/.worktrees/<branch>/`), each a full checkout with its own `node_modules`. A project with 5 worktrees re-walks ~5× the tree, every switch.
3. **The slowdown lands on typing.** The walk runs in the **main process**. Keystrokes flow renderer → IPC → main → node-pty. While the main-process JS thread is busy draining hundreds of thousands of `stat` results, keystroke IPC is delayed — felt as laggy typing in the chat. It clears the moment the walk completes (~90s).

This explains the **directionality**: switching *to* the worktree-heavy project (`command`, 5 worktrees) was far worse than the reverse (a project with none).

## Solution

Replace the dead glob list with a v4-compatible predicate that matches on **path segments relative to the watch root**, so chokidar prunes an ignored directory *before descending into it*:

```typescript
// electron/main/services/FileWatcherService.ts
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  'coverage', '__pycache__', '.venv', '.worktrees',
])
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db'])

export function isIgnoredPath(filePath: string, rootPath: string): boolean {
  const rel = path.relative(rootPath, filePath)
  if (!rel || rel.startsWith('..')) return false // the root itself, or outside it
  const segments = rel.split(/[\\/]/).filter(Boolean)
  const basename = segments[segments.length - 1] ?? ''
  if (IGNORED_FILES.has(basename) || basename.endsWith('.log')) return true
  return segments.some((segment) => IGNORED_DIRS.has(segment))
}

// ...
const watcher = watch(projectPath, {
  ignoreInitial: true,
  ignored: (p: string) => isIgnoredPath(p, projectPath),
  /* ... */
})
```

Two deliberate improvements over the old behavior:

- **`.worktrees/` is now ignored.** Worktrees are separate sidebar entries with their own watch context; watching them from the parent root was pure cost.
- **Matching is relative to the root.** The old `**/build/**` glob would have ignored a whole project that merely lived under a `build/` ancestor directory. Relative matching cannot misfire on the watch-root's own path prefix.

`isIgnoredPath` is a pure function, unit-tested in `test/fileWatcher.test.ts` (root never ignored, subtrees pruned, basename rules, the ancestor-name trap, forward-slash paths).

## Investigation Steps

1. Symptom (typing lag on switch, directional) pointed at either the renderer mount path or the main-process event loop.
2. Traced the switch: `setActiveProject` → store subscriber → `project:setActiveWatcher` IPC → `FileWatcherService.switchTo()` rebuilds the watcher.
3. Read `IGNORE_PATTERNS` — glob strings — then checked `package.json`: **chokidar `^4.0.3`**.
4. Confirmed v4 dropped glob support → the ignore list matches nothing → full-tree walk.
5. Confirmed `.worktrees/` sits inside the project root (the cwd was `<repo>/.worktrees/<branch>`) and was never ignored regardless.
6. Fixed with a predicate, added a unit test, ran the suite (578 pass) + typecheck + lint.

## Key Patterns

### Pin behavior that depends on a dependency's matching semantics

Glob/ignore/matcher semantics are exactly the kind of contract a major version can change without a compile error. When a config value is *interpreted* by a library (globs, regexes, format strings), a unit test that asserts the **observable outcome** ("node_modules is ignored") survives the upgrade; a test that only checks the string list does not.

### Directory-level pruning beats per-file filtering

For tree-walking watchers, the ignore matcher must return `true` for the **directory** (not just its contents) so the walker never descends. Match `node_modules` itself, not only `node_modules/**`.

## Prevention Strategies

1. **Behavioral tests around dependency contracts.** `isIgnoredPath` is now unit-tested; a future chokidar bump that changes matcher semantics will fail a test, not a user's typing.
2. **Audit ignore/matcher options on every major bump.** Treat "library that interprets our config" as a review checkpoint when `package.json` majors move.
3. **Watch the watch root, nothing more.** Worktrees, `node_modules`, and build output are cost with no benefit on the parent root — prune them explicitly.
4. **When a slowdown is directional, follow the asymmetry.** "Worse toward project X" pointed straight at what X had more of (worktrees), which led to the walk.

## Lessons Learned

| Lesson | Pattern |
|--------|---------|
| A major bump can silently void a config | Test the outcome, not the config value |
| Glob strings ≠ universal matcher API | chokidar v4 wants path/RegExp/function |
| Main-process I/O storms surface as input lag | Keystrokes share the main thread with the watch |
| Worktrees live inside the repo | Ignore `.worktrees/` on the parent watcher |
| Directional slowdowns encode their cause | Chase the asymmetry, not the symptom |

## Related Documentation

- [FileWatcherService Memory Leak: Simultaneous Chokidar Instances on Startup](./filewatcher-memory-leak-chokidar-startup.md) — same service; the `switchTo()` serialization and single-active-watcher design referenced here
- [Original plan: Agent-Native Reactivity via FileWatcher](../../plans/2026-02-16-feat-agent-native-reactivity-file-watcher-plan.md)
- [Terminal LRU Pooling Memory Optimization](./terminal-lru-pooling-memory-optimization.md) — the other half of project-switch performance
