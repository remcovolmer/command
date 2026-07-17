// Zoom helpers for the built-in browser. Kept pure so clamping and stepping are
// unit-testable without a live <webview>.

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 5.0
export const DEFAULT_ZOOM = 1.0

// Preset ladder for +/- stepping, so a step lands on a familiar percentage
// (mirroring typical browser zoom stops) instead of an arbitrary float.
const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0,
]

const EPSILON = 1e-6

/** Clamp a raw factor into the supported range; NaN falls back to 100%. */
export function clampZoom(factor: number): number {
  if (Number.isNaN(factor)) return DEFAULT_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor))
}

/** Next step up the ladder from the current factor (capped at MAX_ZOOM). */
export function zoomIn(factor: number): number {
  const current = clampZoom(factor)
  return ZOOM_STEPS.find((s) => s > current + EPSILON) ?? MAX_ZOOM
}

/** Next step down the ladder from the current factor (floored at MIN_ZOOM). */
export function zoomOut(factor: number): number {
  const current = clampZoom(factor)
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < current - EPSILON) return ZOOM_STEPS[i]
  }
  return MIN_ZOOM
}

/** Human-readable percentage label, e.g. 1.25 -> "125%". */
export function zoomLabel(factor: number): string {
  return `${Math.round(clampZoom(factor) * 100)}%`
}
