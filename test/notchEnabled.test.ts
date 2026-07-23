import { describe, test, expect, beforeEach, vi } from 'vitest'

// Capture the partialize option so the persist contract is testable.
const persistCapture = vi.hoisted(() => ({
  partialize: undefined as
    | ((state: Record<string, unknown>) => Record<string, unknown>)
    | undefined,
}))

// Bypass the localStorage-backed persist middleware (mirrors projectStore.test).
vi.mock('zustand/middleware', () => ({
  persist: (
    fn: unknown,
    options?: { partialize?: (state: Record<string, unknown>) => Record<string, unknown> },
  ) => {
    persistCapture.partialize = options?.partialize
    return fn
  },
}))

// Spy on the single-owner side effect the store action fires.
const { notchSetEnabled } = vi.hoisted(() => ({ notchSetEnabled: vi.fn() }))
vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({
    notch: { setEnabled: notchSetEnabled },
    usage: { setEnabled: vi.fn(() => Promise.resolve()), onUpdate: vi.fn(() => () => {}) },
  }),
}))

import { useProjectStore } from '@/stores/projectStore'

describe('notch enable toggle', () => {
  beforeEach(() => {
    notchSetEnabled.mockReset()
    useProjectStore.getState().setNotchEnabled(true)
  })

  test('defaults to enabled', () => {
    expect(useProjectStore.getState().notchEnabled).toBe(true)
  })

  test('toggleNotchEnabled flips the flag and pushes the change to main', () => {
    useProjectStore.getState().toggleNotchEnabled()
    expect(useProjectStore.getState().notchEnabled).toBe(false)
    expect(notchSetEnabled).toHaveBeenLastCalledWith(false)

    useProjectStore.getState().toggleNotchEnabled()
    expect(useProjectStore.getState().notchEnabled).toBe(true)
    expect(notchSetEnabled).toHaveBeenLastCalledWith(true)
  })

  test('setNotchEnabled sets an explicit value (used by the strip hide echo)', () => {
    useProjectStore.getState().setNotchEnabled(false)
    expect(useProjectStore.getState().notchEnabled).toBe(false)
    expect(notchSetEnabled).toHaveBeenLastCalledWith(false)
  })

  test('notchEnabled is included in the persisted (partialized) state', () => {
    const partial = persistCapture.partialize?.(
      useProjectStore.getState() as unknown as Record<string, unknown>,
    )
    expect(partial).toHaveProperty('notchEnabled')
  })
})
