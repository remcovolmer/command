/** Ctrl+V as a raw byte: lets Claude Code read a clipboard image itself. */
export const RAW_CTRL_V = '\x16'

const BRACKETED_PASTE_MARKERS = /\x1b\[20[01]~/g

export type PasteAction =
  /** Feed through xterm's input path (onData) — text paste. */
  | { kind: 'input'; data: string }
  /** Write straight to the PTY — no text on the clipboard (e.g. an image). */
  | { kind: 'raw'; data: string }

/**
 * Decide what Ctrl+V sends, mirroring xterm's own paste handling
 * (Clipboard.ts: newline normalisation + bracketing when DECSET 2004 is on).
 *
 * One deliberate difference from xterm's `paste()`: inside a bracketed paste,
 * newlines become `\n`, not `\r`. TerminalManager.writePtySafe strips every
 * `\r` inside a bracketed block on Windows for payloads over its 512-byte
 * chunk threshold (docs/solutions/integration-issues/node-pty-paste-truncation.md),
 * so xterm's `\r` newlines would vanish from large pastes. Unbracketed pastes
 * keep xterm's `\r` (Enter) semantics for plain shells.
 *
 * Embedded paste markers are stripped so pasted content cannot terminate the
 * bracket early and inject keystrokes.
 */
export function buildPasteAction(
  text: string | null | undefined,
  bracketedPasteMode: boolean
): PasteAction {
  if (!text) return { kind: 'raw', data: RAW_CTRL_V }
  const clean = text.replace(BRACKETED_PASTE_MARKERS, '')
  if (bracketedPasteMode) {
    return { kind: 'input', data: `\x1b[200~${clean.replace(/\r\n?/g, '\n')}\x1b[201~` }
  }
  return { kind: 'input', data: clean.replace(/\r?\n/g, '\r') }
}
