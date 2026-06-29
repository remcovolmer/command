---
title: Zustand onRehydrateStorage throws a TDZ ReferenceError when it calls useStore.getState() during create()-time hydration
date: 2026-06-29
category: runtime-errors
module: Renderer state store (projectStore / Zustand persist)
problem_type: runtime_error
component: frontend_stimulus
symptoms:
  - "Sidebar plan-usage indicator stays on 'usage n/a' indefinitely; toggling it off/on (Ctrl+Shift+U) and restarting the app do not help"
  - "Renderer console logs 'Zustand hydration failed: ReferenceError: Cannot access useProjectStore before initialization (projectStore.ts)'"
  - "Main process never polls the usage endpoint and the renderer never receives usage:update, even though the endpoint, credentials, and IPC wiring are all correct in isolation"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components: ["src/stores/projectStore.ts", "electron/main/services/UsageService.ts"]
tags: ["zustand", "persist", "onrehydratestorage", "temporal-dead-zone", "hydration", "electron-ipc"]
---

# Zustand onRehydrateStorage throws a TDZ ReferenceError when it calls useStore.getState() during create()-time hydration

## Problem

The sidebar plan-usage indicator was permanently stuck on `usage n/a`. The root cause was not in the usage feature at all: the store's `persist` rehydration callback referenced the store singleton (`useProjectStore.getState()`) **synchronously during hydration**, which runs inside the `create()` call — before the `useProjectStore` const is assigned. That threw a temporal-dead-zone `ReferenceError` and aborted the rest of the rehydrate callback, silently dropping every side effect wired after the throwing line.

## Symptoms

- Indicator stuck on the `usage n/a` placeholder; no bar, no percentages.
- Toggling the feature off/on did nothing, and a restart didn't fix it.
- Renderer console: `Zustand hydration failed: ReferenceError: Cannot access 'useProjectStore' before initialization`.
- The whole usage pipeline checked out in isolation — the OAuth endpoint returned `200` with valid data, the Electron main-process `fetch` worked, the `UsageService` state machine emitted `usage:update` correctly, and the preload/IPC wiring was intact. Yet the running app never polled and never subscribed.

## What Didn't Work

- **Toggling the setting / restarting** — the toggle reached the main process and made it poll + emit, but nothing in the renderer was listening (the `usage:update` subscription was registered in the same aborted callback), so the data went nowhere.
- **Suspecting the network / Electron runtime** — verified via a headless `npx electron` probe that both global `fetch` (undici) and `net.fetch` returned `200`, and that the verbatim `UsageService` state machine emitted `ok` data on the exact startup→toggle sequence. All green, which (correctly) redirected the investigation away from main and toward the renderer.
- **Assuming the subscription was simply never registered** — misleading at first, because `storeHydrated()` (a few lines *above* the throw) did fire, which made it look like the callback had run. The give-away was that `setEnabled` was never called on the service at all, narrowing the abort to *between* `storeHydrated()` and the usage wiring.

## Solution

Use the `state` parameter that Zustand passes into the `onRehydrateStorage` callback instead of reaching for the not-yet-initialized store singleton. References that run *later* (e.g. inside an `onUpdate` handler that fires after init) can still safely use `useProjectStore.getState()`.

```ts
// src/stores/projectStore.ts — onRehydrateStorage: () => (state, error) => { ... }

// BEFORE — throws TDZ ReferenceError, aborting the rest of the callback:
terminalPool.setMaxSize(useProjectStore.getState().terminalPoolSize)
try {
  const api = getElectronAPI()
  api.usage.setEnabled(useProjectStore.getState().showUsageIndicator).catch(() => {})
  unsubUsageUpdate?.()
  unsubUsageUpdate = api.usage.onUpdate((data) => {
    useProjectStore.getState().setUsageData(data) // safe: runs later, after init
  })
} catch { /* ... */ }

// AFTER — use the hydrated `state` param for synchronous reads:
if (state) terminalPool.setMaxSize(state.terminalPoolSize)
try {
  const api = getElectronAPI()
  api.usage.setEnabled(state?.showUsageIndicator ?? true).catch(() => {})
  unsubUsageUpdate?.()
  unsubUsageUpdate = api.usage.onUpdate((data) => {
    useProjectStore.getState().setUsageData(data) // still fine — deferred callback
  })
} catch { /* ... */ }
```

## Why This Works

With a synchronous storage backend (localStorage via `createJSONStorage`), Zustand's `persist` runs hydration *during* `create()`, and invokes the `onRehydrateStorage` post-callback synchronously in the same tick. At that moment the module-level `const useProjectStore = create(...)` assignment has not completed, so any reference to `useProjectStore` inside the callback hits the temporal dead zone and throws. The thrown line was not wrapped in a `try/catch`, so it aborted everything after it — `usage.setEnabled`, the `usage:update` subscription, the `isRendererReady` flag, and the terminal-pool-size sync all silently never ran. The `state` argument is the already-hydrated state object, available without touching the half-initialized singleton, so the callback completes and all the wiring runs.

## Prevention

- **Never call `useStore.getState()` (or otherwise reference the store const) synchronously inside `onRehydrateStorage`.** Use the `(state, error)` parameters for synchronous reads. The singleton is only safe inside deferred callbacks (event handlers, subscriptions, timeouts) that fire after `create()` returns.
- **Don't wire IPC subscriptions or other critical side effects after an unguarded line that can throw.** A single uncaught throw in a rehydrate callback silently kills every side effect below it. If a callback must do several independent things, isolate them so one failure can't cascade.
- **Make services observable.** `UsageService` logged nothing about its poll outcome, which turned a renderer-side bug into a long main-vs-renderer hunt. A one-line breadcrumb at the emit boundary would have pointed at the renderer immediately. (For the actual diagnosis, the decisive move was forwarding renderer `console-message` events to the main log via `win.webContents.on('console-message', ...)` in dev.)

## Related Issues

- Fixed in remcovolmer/command#143.
- [milkdown-debounce-defeats-sync-guard](../logic-errors/milkdown-debounce-defeats-sync-guard.md) — another `projectStore`-area timing bug (`async_timing`) where a side effect fired at the wrong moment relative to state updates.
