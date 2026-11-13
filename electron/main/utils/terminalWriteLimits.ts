export const MAX_TERMINAL_WRITE_BYTES = 1_000_000

export type TerminalWriteValidation =
  | { ok: true; data: string }
  | { ok: false; reason: 'invalid-type' }
  | { ok: false; reason: 'too-large'; size: number; limit: number }

export function validateTerminalWritePayload(
  data: unknown,
  limit: number = MAX_TERMINAL_WRITE_BYTES
): TerminalWriteValidation {
  if (typeof data !== 'string') return { ok: false, reason: 'invalid-type' }
  if (data.length > limit) return { ok: false, reason: 'too-large', size: data.length, limit }
  return { ok: true, data }
}

export function formatOversizeMessage(
  size: number,
  limit: number
): { title: string; body: string } {
  const sizeKb = Math.round(size / 1024)
  const limitKb = Math.round(limit / 1024)
  return {
    title: 'Paste too large',
    body: `${sizeKb} KB exceeds the ${limitKb} KB terminal input limit. Use a file for larger content.`,
  }
}

/**
 * Decide how a validated terminal:write payload reaches node-pty.
 *
 * Text input (xterm onData) is a JS string that node-pty encodes as UTF-8.
 * Binary input (xterm onBinary — legacy X10 mouse reports) is a "binary
 * string" with one char per byte; it must be written as those raw bytes, or
 * bytes >= 0x80 (cells beyond column/row 95) get UTF-8 expanded into two.
 * A binary string with a char above 0xFF is malformed and yields null (drop).
 * `binary` is untrusted IPC input: only a literal `true` selects the raw path.
 */
export function encodePtyInput(data: string, binary: unknown): string | Buffer | null {
  if (binary !== true) return data
  for (let i = 0; i < data.length; i++) {
    if (data.charCodeAt(i) > 0xff) return null
  }
  return Buffer.from(data, 'latin1')
}
