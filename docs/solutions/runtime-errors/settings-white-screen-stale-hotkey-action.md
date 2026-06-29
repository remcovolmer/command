---
title: Opening Settings white-screens the whole app when a persisted hotkey action was removed from code
date: 2026-06-29
status: solved
category: runtime-errors
module: Hotkey configuration / Settings
problem_type: runtime_error
severity: critical
components:
  - src/utils/hotkeys.ts
  - src/components/Settings/HotkeyRow.tsx
  - src/stores/projectStore.ts
root_cause: logic_error
resolution_type: code_fix
tags:
  - hotkeys
  - zustand-persist
  - rehydration
  - white-screen
  - react-render-crash
  - error-boundary
  - settings
related_issues:
  - https://github.com/remcovolmer/command/pull/142
---

# Opening Settings white-screens the whole app when a persisted hotkey action was removed from code

## Problem

After upgrading to 0.21.0, pressing the Settings button (gear icon, or `Ctrl + ,`) turned the entire window blank and froze the app — only a restart recovered it. It reproduced for every user who had run a build from before 0.21.0; a fresh install was fine.

## Symptoms

- Whole window goes white and unresponsive the moment the Settings dialog should appear.
- No visible error dialog — the renderer just unmounts.
- DevTools console (if open) shows `TypeError: Cannot read properties of undefined (reading 'key')` originating in `HotkeyRow`.
- The `Ctrl + /` shortcuts overlay does **not** crash on the same data (it shows two dead "Split/Unsplit terminal" rows instead).

## What Didn't Work

- **Suspecting an infinite render loop.** "Freeze" first read like a runaway `useState`/`useEffect` loop (CPU pegged). `GeneralSection`'s `onNestedDialogChange` effect was a candidate, but its dependency is a stable `useState` setter — no loop. The freeze was actually the unmounted/blank renderer, not a loop.
- **Looking only at the section components.** `HotkeySection`, `GeneralSection`, and `AccountsSection` render cleanly in isolation. The crash is data-dependent on the user's persisted store, not on the component tree alone.

## Solution

Two layers, both on the `fix/settings-open` branch (PR #142):

**1. Make rehydration reconciliation bidirectional** — `mergeMissingHotkeyDefaults` previously only backfilled new defaults; it now also prunes actions absent from `DEFAULT_HOTKEY_CONFIG`:

```ts
// src/utils/hotkeys.ts
export function mergeMissingHotkeyDefaults(config: HotkeyConfig): HotkeyConfig {
  let changed = false
  const merged = { ...config }

  // Backfill actions added after the config was persisted.
  for (const action of Object.keys(DEFAULT_HOTKEY_CONFIG) as HotkeyAction[]) {
    if (!merged[action]) {
      merged[action] = DEFAULT_HOTKEY_CONFIG[action]
      changed = true
    }
  }

  // Prune actions removed since the config was persisted (e.g. split-view).
  for (const action of Object.keys(merged)) {
    if (!(action in DEFAULT_HOTKEY_CONFIG)) {
      delete (merged as Record<string, HotkeyBinding>)[action]
      changed = true
    }
  }

  return changed ? merged : config
}
```

**2. Guard the crash site** — `HotkeyRow` no longer dereferences an undefined default:

```ts
// src/components/Settings/HotkeyRow.tsx
const defaultBinding = DEFAULT_HOTKEY_CONFIG[action]
const isDefault =
  defaultBinding !== undefined &&
  binding.key === defaultBinding.key &&
  binding.modifiers.length === defaultBinding.modifiers.length &&
  binding.modifiers.every((m) => defaultBinding.modifiers.includes(m))
```

## Why This Works

The causal chain:

1. #141 (0.21.0) removed the split-view feature, deleting `terminal.split` / `terminal.unsplit` from both the `HotkeyAction` type and `DEFAULT_HOTKEY_CONFIG`.
2. Those actions still lived in every pre-0.21.0 user's persisted `hotkeyConfig` (localStorage key `command-center-storage`).
3. On rehydration (`onRehydrateStorage` → `mergeMissingHotkeyDefaults`), the function only *added* missing defaults — it never *removed* unknown actions, so the ghosts survived.
4. `HotkeySection` calls `getHotkeysByCategory(hotkeyConfig)`, which iterates **all** persisted entries (incl. the ghosts) and renders a `HotkeyRow` for each.
5. `HotkeyRow` computed `DEFAULT_HOTKEY_CONFIG[action].key`. For a ghost action that lookup is `undefined`, so `.key` threw a `TypeError` during render.
6. There is **no ErrorBoundary anywhere in the renderer**, so a thrown render error unmounts the entire React tree → blank white screen, app frozen.

Pruning at the data source (step 3) removes the ghosts before any consumer sees them; the `HotkeyRow` guard (step 5) is a render-time backstop for the pre-hydration window and any future code path. The `Ctrl + /` overlay never crashed because it only reads the persisted binding's own fields (`description`, `modifiers`, `enabled`) and never looks the action up in the current defaults — the same data, but only the unguarded consumer died.

## Prevention

- **Persisted-config reconciliation must be bidirectional.** Any "merge defaults into persisted state" routine has to prune keys that no longer exist as well as backfill new ones. Backfill-only quietly accumulates dead keys that become render-time landmines after a feature removal.
- **Never dereference the current default set for a key sourced from persisted state** without a presence check — persisted data outlives the code that produced it.
- **Tests** (`test/hotkeys.test.ts`, `describe('mergeMissingHotkeyDefaults')`): assert a config carrying a removed action (`terminal.split`) is pruned, that every surviving key resolves to a real default, that missing defaults are still backfilled, that user customizations survive, and that a no-op returns the same reference. The prune test fails on the pre-fix code, so the crash path stays locked.
- **Systemic gap worth a follow-up:** the renderer has **zero ErrorBoundaries**, so any uncaught render exception white-screens the whole app rather than degrading one panel. An app-level (and ideally per-dialog) ErrorBoundary would have turned this catastrophic crash into a contained, recoverable error. Not bundled into this fix to keep scope tight.

## Related Issues

- PR #142 — https://github.com/remcovolmer/command/pull/142
- Introduced by #141 (split-view removal, release 0.21.0, commit `a63ce1c`).
