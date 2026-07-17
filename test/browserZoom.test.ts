import { describe, test, expect } from 'vitest'
import {
  clampZoom,
  zoomIn,
  zoomOut,
  zoomLabel,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
} from '../src/utils/browserZoom'

describe('clampZoom', () => {
  test('clamps below the minimum', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
  })

  test('clamps above the maximum', () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM)
  })

  test('leaves an in-range factor unchanged', () => {
    expect(clampZoom(1.5)).toBe(1.5)
  })

  test('NaN falls back to the default', () => {
    expect(clampZoom(Number.NaN)).toBe(DEFAULT_ZOOM)
  })
})

describe('zoomIn', () => {
  test('steps up to the next ladder stop', () => {
    expect(zoomIn(1.0)).toBe(1.1)
    expect(zoomIn(1.1)).toBe(1.25)
  })

  test('caps at the maximum instead of overshooting', () => {
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM)
    expect(zoomIn(4.5)).toBe(MAX_ZOOM)
  })
})

describe('zoomOut', () => {
  test('steps down to the previous ladder stop', () => {
    expect(zoomOut(1.0)).toBe(0.9)
    expect(zoomOut(1.25)).toBe(1.1)
  })

  test('floors at the minimum instead of undershooting', () => {
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM)
    expect(zoomOut(0.3)).toBe(MIN_ZOOM)
  })
})

describe('zoomLabel', () => {
  test('formats as a rounded percentage', () => {
    expect(zoomLabel(1)).toBe('100%')
    expect(zoomLabel(1.25)).toBe('125%')
    expect(zoomLabel(0.67)).toBe('67%')
  })
})
