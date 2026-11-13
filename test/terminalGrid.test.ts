import { describe, test, expect, afterEach } from 'vitest'
import {
  cellFromCharSize,
  estimateTerminalGrid,
  gridFromViewport,
  registerLiveGrid,
  unregisterLiveGrid,
} from '../src/utils/terminalGrid'

describe('cellFromCharSize', () => {
  test('rounds like the xterm renderer at dpr 1', () => {
    // 8.4px wide char → floor 8; 18px high char → floor(18 * 1.15) = 20
    expect(cellFromCharSize(8.4, 18, 1.15, 1)).toEqual({ width: 8, height: 20 })
  })

  test('rounds in device pixels at fractional dpr', () => {
    // dpr 1.5: width floor(8.4*1.5)=12 → 8; height floor(ceil(18*1.5)*1.15)=floor(31.05)=31 → 31/1.5
    const cell = cellFromCharSize(8.4, 18, 1.15, 1.5)
    expect(cell?.width).toBeCloseTo(8)
    expect(cell?.height).toBeCloseTo(31 / 1.5)
  })

  test('rejects unmeasurable metrics', () => {
    expect(cellFromCharSize(0, 18, 1.15, 1)).toBeUndefined()
    expect(cellFromCharSize(8, Number.NaN, 1.15, 1)).toBeUndefined()
    expect(cellFromCharSize(8, 18, 1.15, 0)).toBeUndefined()
  })
})

describe('gridFromViewport', () => {
  const cell = { width: 8, height: 20 }

  test('subtracts the padding on both sides and floors', () => {
    // (1024 - 24) / 8 = 125 cols, (624 - 24) / 20 = 30 rows
    expect(gridFromViewport(1024, 624, cell, 12)).toEqual({ cols: 125, rows: 30 })
    expect(gridFromViewport(1031, 643, cell, 12)).toEqual({ cols: 125, rows: 30 })
  })

  test('hidden or collapsed viewport yields undefined', () => {
    expect(gridFromViewport(0, 0, cell, 12)).toBeUndefined()
    expect(gridFromViewport(30, 600, cell, 12)).toBeUndefined()
    expect(gridFromViewport(800, 20, cell, 12)).toBeUndefined()
  })

  test('invalid cell yields undefined', () => {
    expect(gridFromViewport(800, 600, { width: 0, height: 20 }, 12)).toBeUndefined()
  })
})

describe('estimateTerminalGrid', () => {
  afterEach(() => {
    unregisterLiveGrid('chat-1')
    unregisterLiveGrid('side-1')
  })

  test('prefers the live grid of the given terminal of the same kind', () => {
    registerLiveGrid('chat-1', 'chat', { cols: 140, rows: 42 })
    expect(estimateTerminalGrid('chat', 'chat-1')).toEqual({ cols: 140, rows: 42 })
  })

  test('ignores a live grid of another kind, and an unregistered one', () => {
    registerLiveGrid('side-1', 'sidecar', { cols: 90, rows: 12 })
    // No DOM in this environment → nothing else to measure.
    expect(estimateTerminalGrid('chat', 'side-1')).toBeUndefined()
    registerLiveGrid('chat-1', 'chat', { cols: 140, rows: 42 })
    unregisterLiveGrid('chat-1')
    expect(estimateTerminalGrid('chat', 'chat-1')).toBeUndefined()
  })

  test('reads the grid live (follows later resizes)', () => {
    const term = { cols: 100, rows: 30 }
    registerLiveGrid('chat-1', 'chat', term)
    term.cols = 120
    expect(estimateTerminalGrid('chat', 'chat-1')).toEqual({ cols: 120, rows: 30 })
  })
})
