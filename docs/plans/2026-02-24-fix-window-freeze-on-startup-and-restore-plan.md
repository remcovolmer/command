---
title: "Fix: Window Freeze on Startup and Restore"
type: fix
status: completed
date: 2026-02-24
origin: docs/brainstorms/2026-02-23-performance-optimization-brainstorm.md
---

# Fix: Window Freeze on Startup and Restore

## Overview

De app freezet 3-10 seconden bij eerste startup en bij window restore na minimize, zelfs met maar 1-3 projecten en <5 terminals. Dit komt door blokkerende operaties in de main process en een cascade van re-initialisaties bij window restore.

## Problem Statement

Ondanks eerdere performance optimalisaties (LRU pool, async reads in ClaudeHookWatcher, code splitting) blijft de app vastlopen. De oorzaak zit in **synchrone service-initialisatie** in `createWindow()` en **thundering herd** effecten bij window restore.

Root causes (in volgorde van impact):

| Oorzaak | Locatie | Geschatte blokkade |
|---------|---------|-------------------|
| 11 services synchroon geïnitialiseerd in `createWindow()` | `electron/main/index.ts:243-267` | 500-1500ms |
| `AutomationService.checkMissedRuns()` + `garbageCollectWorktrees()` blokkeren startup | `electron/main/index.ts:266-271` | 200-1000ms |
| `ProjectPersistence.readFileSync()` op projects.json | `ProjectPersistence.ts:94` | 50-100ms |
| Hardcoded 1s delay + parallel session restoration I/O | `electron/main/index.ts:1125-1132` | 1000-1800ms |
| GitHub polling resume thundering herd bij window focus | `electron/main/index.ts:283-288` | 500-2000ms |
| Monaco still eagerly imported via `import * as monaco` in EditorContainer chunk | `EditorContainer.tsx:4` | 100-300ms |
| Zustand hydration subscriber fires `setActiveWatcher` before renderer ready | `projectStore.ts:1302-1313` | 100-200ms |

**Totaal bij startup: 2-6 seconden blokkade.** Bij restore: 1-4 seconden door GitHub thundering herd + xterm re-fit cascade.

## Proposed Solution

Twee fasen: eerst de startup-blokkades fixen (snelle winst), dan de window-restore freeze.

### Phase 1: Unblock Startup (Quick Wins)

**1.1 Defer non-critical services tot na window show**

In `electron/main/index.ts`, splits de service-initialisatie:
- **Before `win.loadFile()`**: Alleen `TerminalManager`, `ProjectPersistence`, `HookWatcher` (nodig voor eerste render)
- **After `ready-to-show` event**: De rest (`AutomationService`, `GitHubService`, `GitService`, `UpdateService`, `TaskService`)

```typescript
// electron/main/index.ts
win.once('ready-to-show', () => {
  win.show()
  // Defer non-critical services
  setTimeout(() => {
    automationService.startAllSchedulers()
    automationService.checkMissedRuns()
    automationService.garbageCollectWorktrees(allProjects.map(p => p.path))
  }, 0) // Next tick, after paint
})
```

**Bestanden:**
- `electron/main/index.ts:243-273` — herstructureer `createWindow()`

**1.2 Async ProjectPersistence.loadState()**

Vervang `readFileSync` door `fs.promises.readFile`:

```typescript
// ProjectPersistence.ts
private async loadState(): Promise<PersistedState> {
  try {
    if (await pathExists(this.stateFilePath)) {
      const data = await fs.promises.readFile(this.stateFilePath, 'utf-8')
      return JSON.parse(data)
    }
  } catch { /* ... */ }
  return { projects: [], sessions: [] }
}
```

**Bestanden:**
- `electron/main/services/ProjectPersistence.ts:91-96` — async maken
- `electron/main/index.ts` — constructor call aanpassen voor async init

**1.3 Remove hardcoded 1s session restoration delay**

Vervang de `setTimeout(1000)` door een event-driven approach: restore sessions zodra de renderer meldt dat de store gehydrateerd is.

```typescript
// Renderer stuurt 'store:hydrated' IPC na Zustand hydration
// Main process wacht daarop in plaats van hardcoded delay
ipcMain.once('store:hydrated', () => {
  restoreSessions().catch(console.error)
})
```

**Bestanden:**
- `electron/main/index.ts:1125-1132` — hardcoded timeout vervangen
- `src/stores/projectStore.ts` — hydration callback toevoegen
- `electron/preload/index.ts` — nieuw IPC channel exposen

**1.4 Lazy-load Monaco properly**

De `import * as monaco from 'monaco-editor'` in `EditorContainer.tsx` laadt het volledige Monaco pakket zodra de EditorContainer chunk loadt. Verplaats naar dynamic import:

```typescript
// EditorContainer.tsx — verwijder top-level import
// Gebruik lazy config init bij eerste editor open
let monacoConfigured = false
async function ensureMonacoConfigured() {
  if (monacoConfigured) return
  const monaco = await import('monaco-editor')
  const { loader } = await import('@monaco-editor/react')
  loader.config({ monaco })
  monacoConfigured = true
}
```

**Bestanden:**
- `src/components/Editor/EditorContainer.tsx:3-10` — dynamic import

### Phase 2: Fix Window Restore Freeze

**2.1 Stagger GitHub polling resume**

In plaats van alle polls tegelijk te hervatten bij `focus`, stagger ze met een interval:

```typescript
// electron/main/index.ts
win.on('focus', () => {
  githubService?.resumeAllPolling({ staggerMs: 500 })
})
```

**Bestanden:**
- `electron/main/index.ts:283-288` — stagger toevoegen
- `electron/main/services/GitHubService.ts` — `resumeAllPolling` aanpassen voor stagger parameter

**2.2 Debounce xterm fit on restore**

Wanneer de window uit minimize komt, triggeren alle zichtbare terminals een `FitAddon.fit()`. Debounce dit met een single requestAnimationFrame:

```typescript
// useXtermInstance.ts — batch alle resize events
// In plaats van individuele fit() per terminal,
// gebruik een centraal resize event dat 1x fired
```

**Bestanden:**
- `src/hooks/useXtermInstance.ts` — debounce logic rond `safeFit()`

**2.3 Guard Zustand hydration subscriber**

Voorkom dat de `setActiveWatcher` subscriber fired vóór de renderer klaar is:

```typescript
// projectStore.ts — voeg ready guard toe
let isRendererReady = false
export const markRendererReady = () => { isRendererReady = true }

useProjectStore.subscribe((state, prevState) => {
  if (!isRendererReady) return // Skip hydration-triggered changes
  if (state.activeProjectId && state.activeProjectId !== prevState.activeProjectId) {
    // ...
  }
})
```

**Bestanden:**
- `src/stores/projectStore.ts:1302-1313` — guard toevoegen
- `src/App.tsx` — `markRendererReady()` aanroepen na mount

## Acceptance Criteria

- [x] App startup: window toont content binnen 1 seconde
- [x] Window restore na minimize: geen merkbare freeze (<200ms)
- [x] Alle bestaande tests slagen (`npm run test`)
- [x] Geen regressie in terminal state detection (ClaudeHookWatcher)
- [x] Geen regressie in session persistence (terminals hervatten na restart)
- [x] Monaco editor laadt pas bij eerste file-open (was al correct via React.lazy)

## Dependencies & Risks

**Risico's:**
- Async `ProjectPersistence.loadState()` verandert de initialisatievolgorde — IPC handlers die projects nodig hebben moeten wachten op init
- Verwijderen van 1s delay kan race condition veroorzaken als renderer nog niet klaar is — daarom event-driven approach
- GitHub stagger kan kortstondig verouderde PR status tonen (acceptabel)

**Geen breaking changes:** Alle wijzigingen zijn intern; geen API/IPC contract changes voor de renderer behalve het nieuwe `store:hydrated` event.

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-02-23-performance-optimization-brainstorm.md](docs/brainstorms/2026-02-23-performance-optimization-brainstorm.md) — key decisions: deferred loading, async I/O, Vite code splitting
- **Existing solution:** [docs/solutions/performance-issues/terminal-lru-pooling-memory-optimization.md](docs/solutions/performance-issues/terminal-lru-pooling-memory-optimization.md)
- **FileWatcher learnings:** [docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md](docs/solutions/performance-issues/filewatcher-memory-leak-chokidar-startup.md) — promise-chain serialization lock pattern
