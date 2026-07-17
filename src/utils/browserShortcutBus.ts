// A tiny renderer-side bus for browser keyboard shortcuts. Two producers feed
// it — the app-chrome path (App.tsx useHotkeys, when the app has focus) and the
// webview-focus path (main-process before-input-event, forwarded over IPC and
// re-emitted here) — and the active BrowserTab consumes it. Decoupling the
// producers from the (possibly many, mostly hidden) BrowserTab instances keeps
// App.tsx from needing a ref into whichever browser tab is active.

export type BrowserShortcutAction =
  | 'browser.zoomIn'
  | 'browser.zoomOut'
  | 'browser.zoomReset'
  | 'browser.find'
  | 'browser.hardReload'

type Handler = (action: BrowserShortcutAction) => void

const listeners = new Set<Handler>()

export function onBrowserShortcut(handler: Handler): () => void {
  listeners.add(handler)
  return () => {
    listeners.delete(handler)
  }
}

export function emitBrowserShortcut(action: BrowserShortcutAction): void {
  for (const handler of listeners) handler(action)
}

// `satisfies Record<BrowserShortcutAction, true>` makes this a compile error to
// forget when a new action is added to the union — the set can't silently drift.
const ACTION_MAP = {
  'browser.zoomIn': true,
  'browser.zoomOut': true,
  'browser.zoomReset': true,
  'browser.find': true,
  'browser.hardReload': true,
} satisfies Record<BrowserShortcutAction, true>

/** Narrow an untrusted string (e.g. an IPC payload) to a known action. */
export function isBrowserShortcutAction(value: string): value is BrowserShortcutAction {
  return Object.prototype.hasOwnProperty.call(ACTION_MAP, value)
}
