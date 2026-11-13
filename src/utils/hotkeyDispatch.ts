import type { HotkeyAction, HotkeyBinding, HotkeyConfig } from '../types/hotkeys'
import { DEFAULT_HOTKEY_CONFIG, matchesBinding } from './hotkeys'

/**
 * A hotkey handler reports whether it actually handled the key. Only handled
 * keys are consumed (preventDefault + stopPropagation); a handler that returns
 * false lets the event continue to xterm / Monaco / the focused control, so a
 * binding never swallows a key whose action doesn't apply right now.
 */
export type HotkeyHandler = () => boolean
export type HotkeyHandlers = Partial<Record<HotkeyAction, HotkeyHandler>>

/** Which UI region currently holds focus — the input to region-scoped actions. */
export interface FocusContext {
  inChatTerminal: boolean
  inShellDrawer: boolean
  inFileExplorer: boolean
  inSidebar: boolean
  inBrowser: boolean
}

// Region markers. The chat container carries `.chat-terminal`; the others are
// data attributes on the region roots.
const REGION_SELECTORS = {
  inChatTerminal: '.chat-terminal',
  inShellDrawer: '[data-shell-drawer]',
  inFileExplorer: '[data-file-explorer]',
  inSidebar: '[data-sidebar]',
  inBrowser: '[data-browser-pane]',
} as const satisfies Record<keyof FocusContext, string>

export function getFocusContext(target: EventTarget | null): FocusContext {
  const el = target instanceof Element ? target : null
  const within = (selector: string) => el?.closest(selector) != null
  return {
    inChatTerminal: within(REGION_SELECTORS.inChatTerminal),
    inShellDrawer: within(REGION_SELECTORS.inShellDrawer),
    inFileExplorer: within(REGION_SELECTORS.inFileExplorer),
    inSidebar: within(REGION_SELECTORS.inSidebar),
    inBrowser: within(REGION_SELECTORS.inBrowser),
  }
}

/**
 * Region scoping: an action listed here only fires when its predicate holds
 * for the focused region; otherwise the key is left alone. Unlisted actions
 * are global.
 */
export const HOTKEY_SCOPES: Partial<Record<HotkeyAction, (ctx: FocusContext) => boolean>> = {
  // File-explorer item actions act on the explorer selection — only meaningful
  // (and only safe: Delete, F2, Ctrl+Shift+C are common keys elsewhere) when
  // the explorer itself has focus. F2 also renames the active sidebar project.
  'fileExplorer.newFile': (ctx) => ctx.inFileExplorer,
  'fileExplorer.newFolder': (ctx) => ctx.inFileExplorer,
  'fileExplorer.delete': (ctx) => ctx.inFileExplorer,
  'fileExplorer.copyPath': (ctx) => ctx.inFileExplorer,
  'fileExplorer.rename': (ctx) => ctx.inFileExplorer || ctx.inSidebar,
  // The git UI lives in the explorer flyout.
  'git.stageAll': (ctx) => ctx.inFileExplorer,
  'git.unstageAll': (ctx) => ctx.inFileExplorer,
  'git.commit': (ctx) => ctx.inFileExplorer,
  'git.discardAll': (ctx) => ctx.inFileExplorer,
  // Browser zoom/find/reload only when the browser pane has focus; otherwise
  // Ctrl+F / Ctrl+= / Ctrl+Shift+R belong to the chat, editor or shell. (With
  // the guest itself focused, the main process intercepts them instead.)
  'browser.zoomIn': (ctx) => ctx.inBrowser,
  'browser.zoomOut': (ctx) => ctx.inBrowser,
  'browser.zoomReset': (ctx) => ctx.inBrowser,
  'browser.find': (ctx) => ctx.inBrowser,
  'browser.hardReload': (ctx) => ctx.inBrowser,
  // Ctrl+W closes the active chat — but in a sidecar shell it is readline's
  // delete-word, and in the browser pane it must not close a chat behind it.
  // (Inputs/Monaco/Milkdown never reach this: useHotkeys skips editable targets.)
  'terminal.close': (ctx) => !ctx.inShellDrawer && !ctx.inBrowser,
}

export function isActionInScope(action: HotkeyAction, ctx: FocusContext): boolean {
  const scope = HOTKEY_SCOPES[action]
  return scope ? scope(ctx) : true
}

/**
 * Resolve a key event against the registered handlers. Tries every matching,
 * in-scope action in registration order and stops at the first handler that
 * reports it handled the key. Returns that action, or null when nothing
 * handled it (the caller must then leave the event untouched).
 *
 * Persisted configs from existing users may predate newly added actions, so a
 * missing binding falls back to its default.
 */
export function dispatchHotkey(
  e: KeyboardEvent,
  config: Partial<HotkeyConfig>,
  handlers: HotkeyHandlers,
  ctx: FocusContext
): HotkeyAction | null {
  for (const [action, handler] of Object.entries(handlers) as [HotkeyAction, HotkeyHandler][]) {
    if (!handler) continue
    const binding: HotkeyBinding | undefined = config[action] ?? DEFAULT_HOTKEY_CONFIG[action]
    if (!binding || !matchesBinding(e, binding)) continue
    if (!isActionInScope(action, ctx)) continue
    if (handler()) return action
  }
  return null
}
