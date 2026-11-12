/**
 * Pure decisions + small DOM helpers behind useFocusRecovery: when focus has
 * dead-ended on <body> (a focused node unmounted, an input closed, the window
 * came back with nothing focused), hand it back to the active chat terminal —
 * but never take it from a real target or from a user who deliberately
 * clicked/selected something non-focusable.
 */

/** The active chat's xterm input (same element refocusActiveTerminal targets). */
export const ACTIVE_CHAT_TEXTAREA_SELECTOR =
  '[data-terminal-active="true"] .xterm-helper-textarea'

/**
 * Surfaces that own focus while open, even when activeElement is momentarily
 * <body> (e.g. a dialog whose input focuses itself in an effect). Dialogs use
 * role="dialog" + aria-modal (ui/Dialog.tsx); menus may mark themselves.
 */
export const FOCUS_OWNER_SELECTOR =
  '[role="dialog"], [aria-modal="true"], [role="menu"], [data-focus-owner]'

export function focusActiveChatTerminal(doc: Document = document): boolean {
  const textarea = doc.querySelector<HTMLElement>(ACTIVE_CHAT_TEXTAREA_SELECTOR)
  if (!textarea) return false
  textarea.focus()
  return true
}

/** True when nothing meaningful holds focus (activeElement is <body>/<html>/null). */
export function isFocusOnBody(doc: Document = document): boolean {
  const active = doc.activeElement
  return !active || active === doc.body || active === doc.documentElement
}

export function hasFocusOwningOverlay(doc: Document = document): boolean {
  return doc.querySelector(FOCUS_OWNER_SELECTOR) !== null
}

/** A non-collapsed text selection in the page — the user is selecting/copying. */
export function hasTextSelection(win: Window = window): boolean {
  const sel = win.getSelection()
  return !!sel && !sel.isCollapsed && sel.toString().length > 0
}

/** Any xterm instance's input (chat or sidecar shell). */
export function isTerminalInput(target: EventTarget | null): boolean {
  return target instanceof Element && target.classList.contains('xterm-helper-textarea')
}

/**
 * Esc dismisses the topmost toast. In a terminal Esc is also Claude Code's
 * interrupt key, so there the toast is dismissed but the key is NOT consumed —
 * a visible toast must never make the user's interrupt silently fail.
 */
export function shouldConsumeToastEscape(target: EventTarget | null): boolean {
  return !isTerminalInput(target)
}

/**
 * Why we are considering a refocus:
 * - 'focus-lost'   a focused element blurred to nowhere / was removed, not by a pointer press
 * - 'pointer'      the user pressed on something non-focusable (text, empty chrome) — their choice
 * - 'window-focus' the window regained OS focus
 */
export type RefocusCause = 'focus-lost' | 'pointer' | 'window-focus'

export interface RefocusInput {
  cause: RefocusCause
  /** activeElement is <body>/null right now. */
  focusOnBody: boolean
  /** document.hasFocus() — false while another app or the webview guest has native focus. */
  windowFocused: boolean
  /** A dialog/menu is open and owns (or is about to take) focus. */
  overlayOpen: boolean
  /** The user has a text selection in the page. */
  textSelected: boolean
  /** An active chat terminal input exists to receive focus. */
  terminalAvailable: boolean
}

export function shouldRefocusTerminal(input: RefocusInput): boolean {
  if (input.cause === 'pointer') return false
  if (!input.terminalAvailable) return false
  // Never steal from a real target (input, Monaco, Milkdown, sidecar, webview).
  if (!input.focusOnBody) return false
  // Window blur also blurs the focused element; recover only once we're back.
  if (!input.windowFocused) return false
  if (input.overlayOpen) return false
  if (input.textSelected) return false
  return true
}

export function readRefocusInput(cause: RefocusCause, doc: Document = document): RefocusInput {
  const win = doc.defaultView ?? window
  return {
    cause,
    focusOnBody: isFocusOnBody(doc),
    windowFocused: doc.hasFocus(),
    overlayOpen: hasFocusOwningOverlay(doc),
    textSelected: hasTextSelection(win),
    terminalAvailable: doc.querySelector(ACTIVE_CHAT_TEXTAREA_SELECTOR) !== null,
  }
}

/**
 * Id of the chat a click selected, when the click landed on a chat selector —
 * a chat tab (data-tab-id) or a sidebar chat row (data-chat-select-id). Callers
 * compare it with the active chat id: re-clicking the active chat should put
 * the caret back in it (clicking a different chat already focuses it on
 * activation). Content tabs also carry data-tab-id, but their ids never equal
 * a terminal id.
 */
export function chatSelectIdFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const el = target.closest('[data-chat-select-id], [data-tab-id]')
  if (!el) return null
  return el.getAttribute('data-chat-select-id') ?? el.getAttribute('data-tab-id')
}

/** True when the <webview> guest holds focus from the host's point of view. */
export function isWebviewFocused(doc: Document = document): boolean {
  return doc.activeElement?.tagName === 'WEBVIEW'
}

/**
 * Hand native focus back from a <webview> that is about to hide or unmount.
 * Without this the guest keeps OS-level keyboard focus and host input stays
 * dead until the window is blurred and refocused.
 */
export function releaseWebviewFocus(
  webview: HTMLElement | null,
  focusHost: () => void,
  doc: Document = document
): boolean {
  if (!webview || doc.activeElement !== webview) return false
  webview.blur()
  focusHost()
  return true
}

/**
 * A file dragged over the window must never reach Chromium's default drop
 * handling, which navigates the whole renderer to file://… and replaces the
 * UI. Only file drags nobody handled are blocked; in-page text drags and
 * components that accept drops (they preventDefault themselves) are left alone.
 */
export function shouldBlockFileDrop(
  types: readonly string[] | null | undefined,
  defaultPrevented: boolean
): boolean {
  if (defaultPrevented || !types) return false
  return types.includes('Files')
}
