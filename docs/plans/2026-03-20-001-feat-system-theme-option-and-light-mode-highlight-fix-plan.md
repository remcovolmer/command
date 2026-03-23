---
title: "feat: Add system theme option and fix light mode highlight colors"
type: feat
status: active
date: 2026-03-20
---

# feat: Add system theme option and fix light mode highlight colors

## Overview

Two issues:
1. **No system theme option** — the app only supports manual `light`/`dark` toggle. There's no way to follow the OS preference (`prefers-color-scheme`).
2. **Highlight color broken in light mode** — `--sidebar-highlight: #572c1e` is identical in both `:root` and `.dark`. This dark brown is unreadable on the light sidebar background. Affects sidebar project items, worktree items, and terminal/editor tab bar active states.

## Problem Statement

- `src/index.css:44` and `src/index.css:88` both define `--sidebar-highlight: #572c1e` — a dark brownish-red that only works on dark backgrounds.
- The highlight is used in 5 places: `Sidebar.tsx:326`, `SortableProjectItem.tsx:151,236`, `TerminalTabBar.tsx:75,133`.
- Theme type is `'light' | 'dark'` with no `'system'` option.
- No `prefers-color-scheme` media query or `matchMedia` listener exists anywhere in the codebase.

## Proposed Solution

### 1. Fix light mode highlight color

Change `--sidebar-highlight` in `:root` (light mode) to a warm, readable highlight that fits the light palette. Something like `oklch(0.92 0.04 40)` (warm light peach/amber) that provides visible contrast on the light sidebar (`oklch(0.9663...)`) while keeping text readable.

**Files to change:**
- `src/index.css:44` — change `:root` `--sidebar-highlight` to a light-appropriate value

### 2. Add `'system'` theme option

Expand the theme type from `'light' | 'dark'` to `'light' | 'dark' | 'system'`.

**Files to change:**

#### Type & Store (`src/stores/projectStore.ts`)
- Change theme type from `'light' | 'dark'` to `'light' | 'dark' | 'system'`
- Update default from `'light'` to `'system'`
- Update `toggleTheme` to cycle: `light → dark → system → light`

#### Theme application (`src/App.tsx:387-394`)
- Replace simple `useEffect` with one that:
  - If `theme === 'system'`: read `window.matchMedia('(prefers-color-scheme: dark)')` and add a listener for changes
  - If `theme === 'light'` or `'dark'`: apply directly (current behavior)
  - Clean up the media query listener on unmount/change
  - Call `invalidateTerminalThemeCache()` when the resolved theme changes (so terminal colors update)

#### Settings UI (`src/components/Settings/GeneralSection.tsx`)
- Add an "Appearance" section at the top with a 3-option selector: Light / Dark / System
- Use the existing toggle switch pattern or a simple segmented control

#### Theme toggle button (sidebar)
- Update the existing `Ctrl+Shift+T` toggle to cycle through 3 states
- Show appropriate icon for each state (sun/moon/monitor)

## Acceptance Criteria

- [ ] Light mode sidebar highlight is readable (warm light color, not dark brown)
- [ ] Light mode terminal tab bar highlight is readable (same CSS variable fix)
- [ ] Settings has an Appearance section with Light / Dark / System options
- [ ] System option follows OS `prefers-color-scheme` and responds to live OS changes
- [ ] `Ctrl+Shift+T` cycles through light → dark → system
- [ ] Terminal theme cache is invalidated when resolved theme changes
- [ ] Default theme for new installs is `system`

## MVP

### src/index.css (light mode highlight fix)

```css
:root {
  /* ... */
  --sidebar-highlight: oklch(0.92 0.04 40);  /* warm peach for light mode */
}

.dark {
  /* ... */
  --sidebar-highlight: #572c1e;  /* existing dark mode value - keep as is */
}
```

### src/stores/projectStore.ts (theme type expansion)

```typescript
// Theme state
theme: 'light' | 'dark' | 'system'

// Default
theme: 'system',

// Toggle cycles through 3 states
toggleTheme: () =>
  set((state) => ({
    theme: state.theme === 'light' ? 'dark' : state.theme === 'dark' ? 'system' : 'light'
  })),
```

### src/App.tsx (system theme detection)

```typescript
useEffect(() => {
  const applyTheme = (resolved: 'light' | 'dark') => {
    if (resolved === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    invalidateTerminalThemeCache()
  }

  if (theme === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    applyTheme(mq.matches ? 'dark' : 'light')
    const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  } else {
    applyTheme(theme)
  }
}, [theme])
```

### src/components/Settings/GeneralSection.tsx (appearance section)

```tsx
{/* Appearance section */}
<div>
  <h3 className="text-sm font-semibold text-foreground mb-1">Appearance</h3>
  <p className="text-xs text-muted-foreground mb-3">Choose your preferred theme.</p>
  <div className="rounded-lg border border-border p-4">
    <div className="flex items-center gap-2">
      {(['light', 'dark', 'system'] as const).map((option) => (
        <button
          key={option}
          onClick={() => setTheme(option)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            theme === option
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-accent'
          }`}
        >
          {option === 'light' ? '☀️ Light' : option === 'dark' ? '🌙 Dark' : '🖥️ System'}
        </button>
      ))}
    </div>
  </div>
</div>
```

## Technical Considerations

- **Terminal theme cache**: `invalidateTerminalThemeCache()` from `src/utils/terminalTheme.ts` must be called whenever the resolved theme changes. Currently it's not called on theme toggle — this needs to be added regardless of the system option.
- **Persisted state migration**: Existing users have `theme: 'light'` or `'dark'` persisted. The Zustand persist middleware will load these fine since the new type is a superset. No migration needed.
- **Editor themes**: Already handled correctly in `CodeEditor.tsx` and `DiffEditorView.tsx` via `theme === 'dark' ? 'vs-dark' : 'vs'`. For `'system'`, these components need to read the resolved theme, not the setting. Consider adding a `resolvedTheme` selector or computing it inline.

## Sources

- `src/index.css:44,88` — CSS variable definitions (identical `--sidebar-highlight` in both modes)
- `src/stores/projectStore.ts:46,252,778-781` — theme state and actions
- `src/App.tsx:387-394` — theme class toggling effect
- `src/components/Settings/GeneralSection.tsx` — settings UI (no appearance section)
- `src/components/Sidebar/SortableProjectItem.tsx:151,236` — sidebar highlight usage
- `src/components/Sidebar/Sidebar.tsx:326` — sidebar highlight usage
- `src/components/Terminal/TerminalTabBar.tsx:75,133` — tab bar highlight usage
- `src/utils/terminalTheme.ts` — terminal theme from CSS variables
