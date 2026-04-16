export const MAX_TERMINAL_WRITE_BYTES = 1_000_000

export type TerminalWriteValidation =
  | { ok: true; data: string }
  | { ok: false; reason: 'invalid-type' }
  | { ok: false; reason: 'too-large'; size: number; limit: number }

export function validateTerminalWritePayload(
  data: unknown,
  limit: number = MAX_TERMINAL_WRITE_BYTES,
): TerminalWriteValidation {
  if (typeof data !== 'string') return { ok: false, reason: 'invalid-type' }
  if (data.length > limit) return { ok: false, reason: 'too-large', size: data.length, limit }
  return { ok: true, data }
}

export function formatOversizeMessage(size: number, limit: number): { title: string; body: string } {
  const sizeKb = Math.round(size / 1024)
  const limitKb = Math.round(limit / 1024)
  return {
    title: 'Paste too large',
    body: `${sizeKb} KB exceeds the ${limitKb} KB terminal input limit. Use a file for larger content.`,
  }
}
