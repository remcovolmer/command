// Maps a webview guest key event (Electron `before-input-event`) to a browser
// action the renderer should run. This exists because key events inside a
// focused <webview> never reach the host renderer's document, so the main
// process must intercept them and forward the intent.
//
// These are the DEFAULT bindings only. User-rebound shortcuts still work while
// the app chrome (not the webview) has focus, via the renderer's useHotkeys.
// Syncing per-user config into the main process is deliberately out of scope —
// the defaults cover the common case where the webview holds focus.
//
// Kept as a pure function over a minimal input shape so it is unit-testable
// without an Electron runtime (mirrors webviewSecurity.ts).

export type BrowserShortcutAction =
  | 'browser.zoomIn'
  | 'browser.zoomOut'
  | 'browser.zoomReset'
  | 'browser.find'
  | 'browser.hardReload'

/** The fields of Electron's `Input` object this matcher reads. */
export interface KeyInputLike {
  type: string
  key: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

/**
 * Return the browser action for a guest key event, or null when it isn't one
 * of the intercepted shortcuts. Only keyDown events match; keyUp and everything
 * else fall through so normal page input is untouched.
 */
export function matchBrowserShortcut(input: KeyInputLike): BrowserShortcutAction | null {
  if (input.type !== 'keyDown') return null
  if (input.alt) return null

  // Primary modifier: Ctrl on Windows/Linux, Cmd (meta) on macOS. Accept either
  // so the same matcher works cross-platform.
  const primary = input.control || input.meta
  if (!primary) return null

  const key = input.key.toLowerCase()

  // Shift combos. On US layouts the main-row `+` and `_` require Shift, so
  // "Ctrl and +" arrives as Ctrl+Shift+= (key '+') and must still zoom.
  if (input.shift) {
    if (key === 'r') return 'browser.hardReload'
    if (key === '+' || key === '=') return 'browser.zoomIn'
    if (key === '-' || key === '_') return 'browser.zoomOut'
    return null
  }

  // The rest are primary-modifier-only (no shift).
  switch (key) {
    case '=':
    case '+':
      return 'browser.zoomIn'
    case '-':
    case '_':
      return 'browser.zoomOut'
    case '0':
      return 'browser.zoomReset'
    case 'f':
      return 'browser.find'
    default:
      return null
  }
}
