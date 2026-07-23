import { describe, test, expect } from 'vitest'
import {
  shouldShowStrip,
  computeStripBounds,
  type Rect,
} from '../electron/main/services/notchVisibility'

describe('shouldShowStrip', () => {
  test('shows only when backgrounded, enabled, and has content', () => {
    expect(
      shouldShowStrip({ mainForeground: false, enabled: true, hasContent: true }),
    ).toBe(true)
  })

  test('hidden while the main window is foreground', () => {
    expect(
      shouldShowStrip({ mainForeground: true, enabled: true, hasContent: true }),
    ).toBe(false)
  })

  test('hidden when disabled (presentation mode), even backgrounded with content', () => {
    expect(
      shouldShowStrip({ mainForeground: false, enabled: false, hasContent: true }),
    ).toBe(false)
  })

  test('hidden when there is nothing to surface', () => {
    expect(
      shouldShowStrip({ mainForeground: false, enabled: true, hasContent: false }),
    ).toBe(false)
  })
})

describe('computeStripBounds', () => {
  const size = { width: 380, height: 140 }

  test('centers horizontally at the top of the work area', () => {
    const workArea: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
    const bounds = computeStripBounds(workArea, size, 8)
    expect(bounds.width).toBe(380)
    expect(bounds.height).toBe(140)
    expect(bounds.x).toBe(Math.round((1920 - 380) / 2))
    expect(bounds.y).toBe(8)
  })

  test('offsets by the display origin on a secondary monitor', () => {
    const workArea: Rect = { x: 1920, y: 0, width: 1920, height: 1040 }
    const bounds = computeStripBounds(workArea, size, 8)
    expect(bounds.x).toBe(1920 + Math.round((1920 - 380) / 2))
    expect(bounds.y).toBe(8)
  })

  test('clamps a strip wider than the work area and keeps it on-screen', () => {
    const workArea: Rect = { x: 100, y: 50, width: 300, height: 200 }
    const bounds = computeStripBounds(workArea, size, 8)
    expect(bounds.width).toBe(300)
    expect(bounds.x).toBe(100)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
    expect(bounds.y).toBe(58)
  })
})
