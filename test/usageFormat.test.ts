import { describe, test, expect } from 'vitest'
import { usageLevel, formatResetTime, formatCredits, windowLabel } from '../src/utils/usageFormat'

describe('usageLevel', () => {
  test('maps thresholds: <70 normal, 70-89 warning, >=90 danger', () => {
    expect(usageLevel(0)).toBe('normal')
    expect(usageLevel(69)).toBe('normal')
    expect(usageLevel(70)).toBe('warning')
    expect(usageLevel(89)).toBe('warning')
    expect(usageLevel(90)).toBe('danger')
    expect(usageLevel(100)).toBe('danger')
  })
})

describe('windowLabel', () => {
  test('prefers the window label when present (Codex)', () => {
    expect(windowLabel({ utilization: 1, resetsAt: '', label: 'wk' }, '5h')).toBe('wk')
  })

  test('falls back to the per-slot default when no label (Claude)', () => {
    expect(windowLabel({ utilization: 45, resetsAt: '2026-06-11T17:50:00+00:00' }, '5h')).toBe('5h')
    expect(windowLabel({ utilization: 6, resetsAt: '2026-06-16T11:00:00+00:00' }, 'wk')).toBe('wk')
  })
})

describe('formatResetTime', () => {
  const now = new Date('2026-06-11T10:00:00')

  test('same local day renders time only', () => {
    expect(formatResetTime('2026-06-11T17:50:00', now)).toBe('17:50')
  })

  test('other day renders short weekday plus time', () => {
    // 2026-06-15 is a Monday
    expect(formatResetTime('2026-06-15T13:00:00', now)).toBe('Mon 13:00')
  })

  test('invalid input returns null instead of garbage', () => {
    expect(formatResetTime('not-a-date', now)).toBeNull()
    expect(formatResetTime('', now)).toBeNull()
  })
})

describe('formatCredits', () => {
  test('formats cents into a currency amount', () => {
    expect(formatCredits(7784, 'EUR')).toBe('€77.84')
    expect(formatCredits(0, 'USD')).toBe('$0.00')
  })

  test('falls back to plain number on unknown currency code', () => {
    expect(formatCredits(7784, 'NOT_A_CODE')).toBe('77.84 NOT_A_CODE')
  })
})
