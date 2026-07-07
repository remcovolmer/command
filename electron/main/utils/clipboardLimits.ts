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

// Upper bound on image payloads (base64 data-URL length) crossing IPC. Screen
// captures can be large; cap so a runaway capture can't stall the main process
// on clipboard I/O.
export const MAX_CLIPBOARD_IMAGE_BYTES = 20_000_000 // ~20 MB of base64 text

// Anchored prefix test — matches only at index 0, so it stays O(prefix) even on
// a multi-megabyte data URL. An empty-payload prefix ("...base64,") still slips
// through here; the IPC handler's nativeImage.isEmpty() check is the second gate.
const IMAGE_DATA_URL_PREFIX = /^data:image\/(png|jpe?g|webp);base64,/

/**
 * Validate an image data URL destined for the OS clipboard. Returns the data
 * URL when it is an in-bounds base64 PNG/JPEG/WebP; returns null for
 * non-strings, oversize payloads, or non-image URLs so the IPC handler can
 * no-op instead of throwing.
 */
export function sanitizeClipboardImage(
  data: unknown,
  limit: number = MAX_CLIPBOARD_IMAGE_BYTES
): string | null {
  if (typeof data !== 'string') return null
  if (data.length > limit) return null
  if (!IMAGE_DATA_URL_PREFIX.test(data)) return null
  return data
}
