/**
 * PTY grid-size validation shared by `terminal:resize` and `terminal:create`.
 * Pure (no electron/node-pty) so it is unit-testable.
 */

export const PTY_COLS_MIN = 1
export const PTY_COLS_MAX = 500
export const PTY_ROWS_MIN = 1
export const PTY_ROWS_MAX = 200

export interface PtySize {
  cols: number
  rows: number
}

function clampDimension(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(val)))
}

/**
 * Validate and clamp a renderer-supplied grid size. Returns null when either
 * dimension is not a finite number (the caller then falls back to a default).
 */
export function sanitizePtySize(cols: unknown, rows: unknown): PtySize | null {
  if (typeof cols !== 'number' || !Number.isFinite(cols)) return null
  if (typeof rows !== 'number' || !Number.isFinite(rows)) return null
  return {
    cols: clampDimension(cols, PTY_COLS_MIN, PTY_COLS_MAX),
    rows: clampDimension(rows, PTY_ROWS_MIN, PTY_ROWS_MAX),
  }
}
