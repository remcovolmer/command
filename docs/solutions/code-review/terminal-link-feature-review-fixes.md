---
title: Terminal Link Feature - Multi-Agent Code Review Findings and Fixes
date: 2026-02-10
category: code-review
severity: medium
component:
  - fileLinkProvider
  - useXtermInstance
  - electron/main IPC handlers
  - electron/preload contextBridge
tags:
  - ipc-protocol
  - performance-optimization
  - caching
  - security
  - path-validation
  - terminal-ui
  - xterm-integration
  - electron
status: resolved
pr: "#30"
branch: feat/ctrl-click-link
---

# Terminal Link Feature - Code Review Findings and Fixes

## Problem Statement

PR #30 added clickable links in terminal output for URLs and file paths. A 6-agent code review (security, performance, architecture, patterns, simplicity, TypeScript) identified 9 issues across security, performance, naming conventions, and code quality. 7 P1/P2 findings were fixed before merge.

## Investigation Steps

Six specialized review agents analyzed the PR in parallel:

| Agent | Focus | Key Finding |
|-------|-------|-------------|
| security-sentinel | Vulnerabilities, path traversal | `startsWith` boundary bypass |
| performance-oracle | IPC flooding, caching | No stat cache on hover |
| architecture-strategist | Pattern compliance | IPC naming inconsistency |
| pattern-recognition-specialist | Convention adherence | `shell:` namespace mismatch |
| code-simplicity-reviewer | YAGNI, minimal params | Unnecessary `projectId` threading |
| kieran-typescript-reviewer | Type safety, React hooks | Missing `.catch()`, dep array |

## Root Cause Analysis

### 1. IPC Naming Convention Violation

`shell:openExternal` broke the kebab-case convention used by `shell:open-path` and `shell:open-in-editor`.

**Fix:** Renamed to `shell:open-external` in `electron/main/index.ts`, `electron/preload/index.ts`.

### 2. IPC Flooding on Mouse Hover (Performance)

xterm.js calls `provideLinks` every time the mouse crosses to a new terminal line. Each call fired `fs:stat` IPC round-trips for every file path match -- no caching. Dense terminal output (build errors, stack traces) could generate 200-600 IPC calls in 10 seconds.

**Fix:** Added `Map<string, Promise<StatResult>>` cache with 200-entry LRU eviction inside `createFileLinkProvider`. Also capped matches to 10 per line via `matches.slice(0, 10)`.

```typescript
const statCache = new Map<string, Promise<{ exists: boolean; isFile: boolean; resolved: string }>>()
const CACHE_MAX_SIZE = 200

function cachedStat(fullPath: string) {
  const cached = statCache.get(fullPath)
  if (cached) return cached
  if (statCache.size >= CACHE_MAX_SIZE) {
    const firstKey = statCache.keys().next().value
    if (firstKey !== undefined) statCache.delete(firstKey)
  }
  const promise = api.fs.stat(fullPath)
  statCache.set(fullPath, promise)
  return promise
}
```

### 3. Unhandled Promise Rejection

`Promise.all().then()` chain had no `.catch()`. If the callback throws or inner try/catch breaks, xterm gets stuck waiting for link resolution.

**Fix:** Added `.catch(() => { callback(undefined) })` after `.then()`.

### 4. Path Traversal via startsWith Boundary (Security)

`validateFilePathInProject` used `startsWith(normalizedProject)` which matched prefix-overlap paths. Project at `C:\Code\app` would validate `C:\Code\application-secrets\file.json`.

**Fix:** Appended `path.sep` before comparison:

```typescript
return normalizedResolved.startsWith(normalizedProject + path.sep)
    || normalizedResolved === normalizedProject
```

### 5. Unused Regex Capture Groups

`FILE_PATH_RE` had `(\d+)` capturing groups for line:col that were never read from match results.

**Fix:** Changed to non-capturing: `(?:\d+(?:\d+)?)?`.

### 6. Function Signature Simplification

`createFileLinkProvider` had 5 params with adjacent strings `projectPath` and `projectId` (swap risk). `projectId` was only forwarded to the callback.

**Fix:** Removed `projectId` param, caller binds it into callback:

```typescript
createFileLinkProvider(terminal, contextPath, api, (filePath, fileName) => {
  store.openEditorTab(filePath, fileName, projectId)
})
```

### 7. Undocumented Dependency Omission

`projectId` used in useEffect but not in dependency array. Bare `eslint-disable` hid the violation.

**Fix:** Added explanatory comment:

```typescript
// Intentionally excludes: projectId, onExit, onTitle, fontSize, scrollback.
// This effect initializes once per terminal (guarded by hasInitializedRef).
// eslint-disable-next-line react-hooks/exhaustive-deps
```

## Prevention Strategies

### Code Review Checklist

- [ ] IPC channel names follow `service:kebab-case-action` pattern
- [ ] IPC calls inside high-frequency callbacks (hover, scroll, provideLinks) use bounded caching
- [ ] Every `Promise.all().then()` chain has a `.catch()`; callback-based APIs guarantee callback invocation on all paths
- [ ] Path containment checks use `startsWith(parent + path.sep)`, never bare `startsWith(parent)`
- [ ] Every regex capturing group `(...)` has a consumer; use non-capturing `(?:...)` for structure-only groups
- [ ] Functions have 4 or fewer parameters; context values forwarded only to callbacks are bound at call site
- [ ] Every `eslint-disable` comment has a preceding explanation naming excluded items and why

### Electron IPC Security Best Practices

- Validate argument types, string lengths, UUID formats in every `ipcMain.handle`
- All file operations pass through centralized path validation with separator-aware boundary checks
- Only expose explicitly named operations through `contextBridge`; never raw `ipcRenderer`
- For `shell.openExternal`, validate URLs match `^https?://` before passing to Electron
- Never leak file system paths or usernames in error messages sent to renderer

### xterm.js Link Provider Best Practices

- `provideLinks` is hot (called on every mouse line-crossing) -- cache IPC results, cap matches per line
- Always call the callback, even on error: `.catch(() => callback(undefined))`
- Create per-provider caches (not global) so entries scope to correct terminal/project
- Bind project context at provider creation via closures, not at link resolution time
- Separate detection (cheap) from action (lazy `activate` handlers)

## Files Modified

| File | Changes |
|------|---------|
| `electron/main/index.ts` | Renamed IPC channel, fixed `startsWith` boundary |
| `electron/preload/index.ts` | Renamed IPC channel |
| `src/utils/fileLinkProvider.ts` | Added stat cache, match cap, `.catch()`, simplified params, non-capturing regex |
| `src/hooks/useXtermInstance.ts` | Updated call site, documented dep omission |

## Related Documentation

- PR #30: https://github.com/remcovolmer/command/pull/30
- `docs/plans/2026-02-06-feat-per-project-skip-permissions-setting-plan.md` - IPC pattern reference
- `CLAUDE.md` - Architecture overview and IPC conventions
