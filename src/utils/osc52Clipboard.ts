/**
 * Honors OSC 52 clipboard-write sequences emitted by terminal applications.
 *
 * Claude Code (and other TUIs) implement "copy on select" and the /copy command
 * by emitting OSC 52 — the terminal escape sequence for writing the system
 * clipboard: `ESC ] 52 ; <Pc> ; <base64> BEL/ST`. xterm.js ships no built-in
 * OSC 52 handler and silently drops the sequence, so those copies never reach
 * the OS clipboard inside Command. We parse the write here and route it through
 * the Electron-native clipboard (navigator.clipboard is unavailable in the
 * packaged file:// renderer — see api.clipboard and electron-file-origin
 * clipboard handling).
 *
 * Three deliberate constraints:
 * - Reads (`Pd === '?'`) are refused. An OSC 52 read asks the terminal to send
 *   the current clipboard contents back to the program — a clipboard
 *   exfiltration vector. We classify it but never respond.
 * - Writes are decoded as UTF-8 (not latin1) so non-ASCII text — Dutch
 *   diacritics, emoji — round-trips instead of turning into mojibake. This is
 *   the failure mode behind Claude Code issue #42417 on Windows.
 * - Identical consecutive writes are deduped. Claude Code re-emits the same
 *   OSC 52 on every render while a selection is held during streaming (issue
 *   #41954 — "TUI selection spams clipboard on every render"), which would
 *   otherwise hammer the clipboard IPC hundreds of times per second.
 */

export type Osc52Action =
  | { kind: 'write'; text: string }
  | { kind: 'read' }
  | { kind: 'ignore'; reason: string }

// Upper bound on the base64 payload we decode. xterm already caps the whole OSC
// payload at PAYLOAD_LIMIT (10 MB), and the main-process clipboard IPC caps the
// decoded text at 10 MB — so this is not the binding safety bound. It is a
// tighter, defensive limit (mirroring osc8LinkRouter's MAX_URI_LENGTH) that
// rejects an absurd payload before the synchronous atob/UTF-8 decode rather than
// after: a real terminal selection or /copy is orders of magnitude smaller.
const MAX_OSC52_BASE64_LENGTH = 3_000_000

/**
 * Decode a base64 string as UTF-8. Returns null when the input is not valid
 * base64 so the caller can ignore malformed payloads instead of throwing.
 */
function decodeBase64Utf8(b64: string): string | null {
  try {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * Parse the payload xterm hands an OSC 52 handler (everything after `OSC 52 ;`,
 * i.e. `<Pc>;<Pd>`). Pc is the clipboard-selection spec (ignored — Command
 * always targets the single system clipboard); Pd is base64 data for a write,
 * or `?` for a read request.
 */
export function parseOsc52(data: string): Osc52Action {
  const sep = data.indexOf(';')
  if (sep === -1) return { kind: 'ignore', reason: 'no separator' }

  const payload = data.slice(sep + 1)
  if (payload === '?') return { kind: 'read' }
  // Empty payload is an OSC 52 clipboard-clear. We skip it rather than wipe the
  // user's clipboard on a stray/empty sequence.
  if (payload === '') return { kind: 'ignore', reason: 'empty payload' }
  if (payload.length > MAX_OSC52_BASE64_LENGTH) {
    return { kind: 'ignore', reason: 'payload exceeds length limit' }
  }

  const text = decodeBase64Utf8(payload)
  if (text === null || text === '') return { kind: 'ignore', reason: 'invalid base64' }
  return { kind: 'write', text }
}

export interface Osc52ClipboardHandler {
  /** Handle the payload xterm passes to a registered OSC 52 handler. */
  handle(data: string): void
}

export function createOsc52ClipboardHandler(options: {
  writeText: (text: string) => void
}): Osc52ClipboardHandler {
  const { writeText } = options
  let lastWritten: string | null = null

  return {
    handle(data: string): void {
      const action = parseOsc52(data)
      if (action.kind !== 'write') return
      // Dedupe identical consecutive writes (streaming re-emit — issue #41954).
      if (action.text === lastWritten) return
      lastWritten = action.text
      writeText(action.text)
    },
  }
}
