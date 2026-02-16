---
title: "Fix logo visibility in taskbar and app window"
type: fix
status: completed
date: 2026-02-16
---

# Fix logo visibility in taskbar and app window

## Overview

The Command app shows the default Electron logo in the Windows taskbar and window title bar instead of the custom Command logo. The custom icon files exist in `build/` but are not accessible at runtime in the packaged app.

## Root Cause

In `electron/main/index.ts:217`, the BrowserWindow icon is set via:

```typescript
icon: path.join(process.env.APP_ROOT, 'build', 'icon.ico'),
```

`APP_ROOT` is derived from `__dirname` which, in production, resolves inside the asar archive. However, the `build/` directory is **not included** in the asar — `electron-builder.json` only packages `dist-electron` and `dist`:

```json
"files": ["dist-electron", "dist"]
```

So `<asar>/build/icon.ico` does not exist, and Electron silently falls back to the default icon.

In development this works fine because `APP_ROOT` points to the project root on disk where `build/icon.ico` exists.

## Proposed Fix

Two changes, following the existing `extraResources` + `app.isPackaged` pattern already used in `HookInstaller.ts`:

### 1. Add icon to `extraResources` in `electron-builder.json`

```json
"extraResources": [
  {
    "from": "electron/main/hooks",
    "to": "hooks",
    "filter": ["*.cjs"]
  },
  {
    "from": "build",
    "to": "build",
    "filter": ["icon.ico"]
  }
]
```

This places `icon.ico` at `<resources>/build/icon.ico` alongside the asar at build time.

### 2. Update icon path in `electron/main/index.ts`

```typescript
// line ~217
icon: app.isPackaged
  ? path.join(process.resourcesPath, 'build', 'icon.ico')
  : path.join(process.env.APP_ROOT, 'build', 'icon.ico'),
```

No new imports needed — `app` is already imported (line 1), `path` is already imported (line 3), and `process.resourcesPath` is a built-in Electron global.

## Files to Change

| File | Change |
|------|--------|
| `electron-builder.json` | Add `build/icon.ico` to `extraResources` |
| `electron/main/index.ts` | Use `app.isPackaged` to resolve icon path correctly in production |

## Acceptance Criteria

- [x] In development (`npm run dev`): custom Command icon visible in window title bar and taskbar
- [ ] In production build (`npm run build`): `icon.ico` present in `release/<version>/win-unpacked/resources/build/`
- [ ] In production run: custom Command icon visible in window title bar and taskbar (not the default Electron icon)

## Context

- The `.exe` embedded icon (set at build time by electron-builder convention from `build/icon.ico`) likely already works — this fix addresses the **runtime** window/taskbar icon
- Windows caches taskbar icons aggressively; existing users may need to unpin/re-pin after upgrading
- The `setAppUserModelId` at line 50 uses `'Claude Code Command Center'` which differs from the `appId` `'com.remcovolmer.command'` — this is a separate concern but worth a follow-up

## References

- Existing pattern: `electron/main/services/HookInstaller.ts:28-35` (dev vs production path resolution)
- Icon files: `build/icon.ico`, `build/icon.icns`, `build/icon.png`, `build/icon.svg`
- electron-builder docs: `extraResources` copies files outside the asar to `resources/`
