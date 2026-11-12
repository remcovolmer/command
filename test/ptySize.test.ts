import { describe, test, expect } from 'vitest'
import { sanitizePtySize } from '../electron/main/utils/ptySize'
import { parseCreateSize } from '../electron/main/handlers/terminalCreate'

describe('sanitizePtySize', () => {
  test('passes through a normal size', () => {
    expect(sanitizePtySize(120, 40)).toEqual({ cols: 120, rows: 40 })
  })

  test('floors fractional values', () => {
    expect(sanitizePtySize(120.9, 40.2)).toEqual({ cols: 120, rows: 40 })
  })

  test('clamps to [1, 500] cols and [1, 200] rows', () => {
    expect(sanitizePtySize(0, -5)).toEqual({ cols: 1, rows: 1 })
    expect(sanitizePtySize(10_000, 10_000)).toEqual({ cols: 500, rows: 200 })
  })

  test('rejects non-numbers and non-finite values', () => {
    expect(sanitizePtySize('120', 40)).toBeNull()
    expect(sanitizePtySize(120, undefined)).toBeNull()
    expect(sanitizePtySize(Number.NaN, 40)).toBeNull()
    expect(sanitizePtySize(120, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('parseCreateSize (terminal:create size payload)', () => {
  test('accepts and clamps an object payload', () => {
    expect(parseCreateSize({ cols: 9999, rows: 30 })).toEqual({ cols: 500, rows: 30 })
  })

  test('returns null for missing or malformed payloads', () => {
    expect(parseCreateSize(undefined)).toBeNull()
    expect(parseCreateSize(null)).toBeNull()
    expect(parseCreateSize(120)).toBeNull()
    expect(parseCreateSize({ cols: 120 })).toBeNull()
    expect(parseCreateSize({ cols: 'wide', rows: 30 })).toBeNull()
  })
})
