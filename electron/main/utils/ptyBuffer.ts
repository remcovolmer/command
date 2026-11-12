/**
 * Mode-preserving trim for the capped PTY output buffers in TerminalManager.
 *
 * When an evicted terminal's buffer exceeds its cap we must drop the oldest
 * output. A naive front-trim can discard the DECSET/DECRST sequences that put
 * the terminal into its current mode (alt screen, mouse tracking, focus
 * reporting, bracketed paste, …). Replaying only the tail then leaves xterm in
 * a different mode than the program (Claude Code) believes it set, which breaks
 * scrolling and mouse input. It can also cut an escape sequence or a UTF-16
 * surrogate pair in half, rendering garbage.
 *
 * trimPreservingModes() therefore:
 *   1. picks a cut at or after the excess (preferring a line boundary, as before),
 *   2. moves the cut forward until it is outside any escape sequence and not
 *      between the halves of a surrogate pair,
 *   3. records the final set/reset state of the tracked private modes seen in
 *      the discarded prefix and prepends equivalent sequences to the tail.
 *
 * Pure (no electron/node-pty) so it is unit-testable.
 */

/**
 * DEC private modes whose state must survive a trim. Mouse/focus/paste/alt
 * screen are what Claude Code's fullscreen mode relies on; cursor keys (1),
 * autowrap (7), cursor visibility (25) and synchronized output (2026) are
 * cheap to carry along and equally visible when they drift.
 */
const TRACKED_PRIVATE_MODES: ReadonlySet<number> = new Set([
  1, 7, 25, 47, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 1047, 1049, 2004, 2026,
])

const ESC = 0x1b

type ScanState = 'ground' | 'esc' | 'csi' | 'string' | 'string-esc'

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/**
 * Record DECSET (`CSI ? Pm h`) / DECRST (`CSI ? Pm l`) for tracked modes,
 * including multi-parameter forms like `CSI ? 1000 ; 1006 h`. Map order is
 * kept as "order of last change" (delete + set) so replay reproduces
 * interacting modes (e.g. 1000/1002/1003 share one mouse-protocol slot).
 */
function recordCsi(params: string, final: number, modes: Map<number, boolean>): void {
  if (final !== 0x68 /* h */ && final !== 0x6c /* l */) return
  if (!params.startsWith('?')) return
  const enabled = final === 0x68
  for (const part of params.slice(1).split(';')) {
    if (part === '') continue
    const mode = Number(part)
    if (!Number.isInteger(mode) || !TRACKED_PRIVATE_MODES.has(mode)) continue
    modes.delete(mode)
    modes.set(mode, enabled)
  }
}

/**
 * Scan `data` from the start, recording tracked mode changes, and return the
 * first index >= `target` at which the VT parser is in ground state (not inside
 * an escape/control string) and that does not fall between a surrogate pair.
 * Everything before the returned index is "discarded" and has been scanned.
 */
export function findSafeCut(data: string, target: number, modes: Map<number, boolean>): number {
  let state: ScanState = 'ground'
  let csiStart = 0
  let i = 0

  while (i < data.length) {
    if (i >= target && state === 'ground') {
      if (i > 0 && isHighSurrogate(data.charCodeAt(i - 1)) && isLowSurrogate(data.charCodeAt(i))) {
        i++
        continue
      }
      return i
    }

    const c = data.charCodeAt(i)
    switch (state) {
      case 'ground':
        if (c === ESC) state = 'esc'
        break
      case 'esc':
        if (c === 0x5b /* [ */) {
          state = 'csi'
          csiStart = i + 1
        } else if (
          c === 0x5d /* ] OSC */ ||
          c === 0x50 /* P DCS */ ||
          c === 0x58 /* X SOS */ ||
          c === 0x5e /* ^ PM */ ||
          c === 0x5f /* _ APC */
        ) {
          state = 'string'
        } else if (c === ESC || (c >= 0x20 && c <= 0x2f)) {
          // Restarted escape, or an intermediate (e.g. ESC ( B) — wait for the final byte.
          state = 'esc'
        } else {
          state = 'ground'
        }
        break
      case 'csi':
        if (c >= 0x40 && c <= 0x7e) {
          recordCsi(data.slice(csiStart, i), c, modes)
          state = 'ground'
        } else if (c === ESC) {
          state = 'esc'
        } else if (c === 0x18 /* CAN */ || c === 0x1a /* SUB */) {
          state = 'ground'
        }
        break
      case 'string':
        if (c === 0x07 /* BEL */ || c === 0x18 || c === 0x1a) state = 'ground'
        else if (c === ESC) state = 'string-esc'
        break
      case 'string-esc':
        if (c === 0x5c /* \ → ST */) {
          state = 'ground'
        } else {
          // ESC not followed by '\' aborts the string and starts a new escape:
          // re-process this byte in 'esc' state.
          state = 'esc'
          continue
        }
        break
    }
    i++
  }

  return data.length
}

/** Serialize recorded mode state as DECSET/DECRST sequences, in order of last change. */
export function modeRestorePrefix(modes: ReadonlyMap<number, boolean>): string {
  let prefix = ''
  for (const [mode, enabled] of modes) {
    prefix += `\x1b[?${mode}${enabled ? 'h' : 'l'}`
  }
  return prefix
}

/**
 * Trim `buffer` from the front so its payload fits `maxSize`, preserving the
 * tracked terminal mode state of the discarded prefix (prepended as a small
 * restore prefix) and never cutting inside an escape sequence or surrogate pair.
 */
export function trimPreservingModes(buffer: string, maxSize: number): string {
  if (buffer.length <= maxSize) return buffer

  const excess = buffer.length - maxSize
  const lineBreak = buffer.indexOf('\n', excess)
  const target = lineBreak !== -1 ? lineBreak + 1 : excess

  const modes = new Map<number, boolean>()
  const cut = findSafeCut(buffer, target, modes)
  return modeRestorePrefix(modes) + buffer.slice(cut)
}
