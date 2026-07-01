// Upper bound on clipboard payloads crossing IPC. A terminal selection is
// already bounded by scrollback, but cap defensively so a malformed or huge
// payload can't stall the main process on clipboard I/O.
export const MAX_CLIPBOARD_TEXT_BYTES = 10_000_000 // 10 MB

/**
 * Validate text destined for the OS clipboard. Returns the string when it is a
 * safe, in-bounds string; returns null for non-strings or oversize payloads so
 * the IPC handler can no-op instead of throwing.
 */
export function sanitizeClipboardText(
  data: unknown,
  limit: number = MAX_CLIPBOARD_TEXT_BYTES
): string | null {
  if (typeof data !== 'string') return null
  if (data.length > limit) return null
  return data
}
