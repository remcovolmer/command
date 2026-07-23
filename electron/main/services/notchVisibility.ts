/**
 * Pure visibility + placement logic for the notch strip, split out from
 * NotchService so it can be unit-tested without an Electron runtime.
 */

export interface NotchVisibilityState {
  /** Is the main Command window the focused/foreground window? */
  mainForeground: boolean
  /** Is the notch feature enabled (sidebar toggle / hide button)? */
  enabled: boolean
  /** Are there any sessions currently surfaced for display? */
  hasContent: boolean
}

/**
 * The strip is shown only when the main window is backgrounded, the notch is
 * enabled, and there is something to surface. While Command is foreground the
 * user already has the full in-app UI, so the strip stays hidden.
 */
export function shouldShowStrip(state: NotchVisibilityState): boolean {
  return !state.mainForeground && state.enabled && state.hasContent
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Top-center placement within a display's work area, clamped so the strip
 * always stays fully on-screen (including when the display sits at a non-zero
 * origin on a multi-monitor desktop).
 */
export function computeStripBounds(
  workArea: Rect,
  size: { width: number; height: number },
  margin = 8,
): Rect {
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)
  const idealX = workArea.x + Math.round((workArea.width - width) / 2)
  const maxX = workArea.x + workArea.width - width
  const x = Math.max(workArea.x, Math.min(idealX, maxX))
  const y = workArea.y + margin
  return { x, y, width, height }
}
