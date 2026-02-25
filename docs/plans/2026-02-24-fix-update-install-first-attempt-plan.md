---
title: "fix: Update install fails on first attempt"
type: fix
status: completed
date: 2026-02-24
---

# fix: Update install fails on first attempt

User downloads update, clicks Install, app closes but installer never launches. On second attempt (reopen app, re-check, re-download, install) it works.

## Root Cause

Three compounding bugs in the update flow:

1. **`autoInstallOnAppQuit = true` conflicts with explicit `quitAndInstall()`** -- registers a *second* install attempt during `before-quit`, conflicting with the explicit one.

2. **`quitAndInstall(false, true)` uses non-silent mode** -- NSIS installer shows UI that detects the still-running Electron process and fails silently. Also: `isForceRunAfter` is *ignored* when `isSilent=false` ([docs](https://www.electron.build/electron-updater.Class.NsisUpdater.html)).

3. **No pre-cleanup before `quitAndInstall()`** -- multiple node-pty processes, file watchers, and GitHub polling are still alive. The `before-quit` handler runs `terminalManager.destroy()` (synchronous `taskkill /pid /T /F` per PTY) which blocks the event loop while the installer is trying to spawn. Additionally, `window-all-closed` runs cleanup *again* (double destroy).

The race: `quitAndInstall()` spawns installer async via `spawnLog()`, then immediately calls `app.quit()`. The quit triggers heavy synchronous cleanup that either kills the installer process or prevents it from fully starting.

On second attempt it works because the update file is already cached/staged and timing happens to align.

**Sources:** electron-builder [#6555](https://github.com/electron-userland/electron-builder/issues/6555), [#7084](https://github.com/electron-userland/electron-builder/issues/7084), [#8026](https://github.com/electron-userland/electron-builder/issues/8026)

## Acceptance Criteria

- [x] Update installs on first attempt (download + install = app restarts with new version)
- [x] No double-cleanup during update quit
- [x] App auto-restarts after update completes

## Fix

### `electron/main/services/UpdateService.ts`

3 changes:

```typescript
// 1. Change autoInstallOnAppQuit to false (line 14)
autoUpdater.autoInstallOnAppQuit = false

// 2. Expose isUpdating flag
private _isUpdating = false
get isUpdateInProgress(): boolean { return this._isUpdating }

// 3. Use silent install in quitAndInstall (line 105)
quitAndInstall() {
  if (!app.isPackaged) return
  this._isUpdating = true
  autoUpdater.quitAndInstall(true, true)  // silent=true, forceRunAfter=true
}
```

### `electron/main/index.ts`

2 changes:

```typescript
// 1. Pre-cleanup before quitAndInstall (lines 1014-1016)
ipcMain.handle('update:install', async () => {
  // Kill all child processes BEFORE triggering installer
  terminalManager?.destroy()
  hookWatcher?.destroy()
  githubService?.destroy()
  await fileWatcherService?.stopAll().catch(() => {})
  await automationService?.destroy().catch(() => {})

  // Wait for processes to fully die
  await new Promise(resolve => setTimeout(resolve, 500))

  updateService?.quitAndInstall()
})

// 2. Guard before-quit and window-all-closed to skip double-cleanup
app.on('before-quit', () => {
  if (updateService?.isUpdateInProgress) return  // <-- add this guard
  // ... existing cleanup ...
})

app.on('window-all-closed', () => {
  if (updateService?.isUpdateInProgress) {        // <-- add this guard
    win = null
    return
  }
  // ... existing cleanup ...
})
```

### Files touched

| File | Change |
|------|--------|
| `electron/main/services/UpdateService.ts` | `autoInstallOnAppQuit=false`, `isUpdateInProgress` flag, `quitAndInstall(true, true)` |
| `electron/main/index.ts` | Pre-cleanup in `update:install` handler, guard `before-quit` and `window-all-closed` |
