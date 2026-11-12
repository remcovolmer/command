import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const close = vi.fn()
vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({ terminal: { close } }),
}))

import { closeWorktreeTerminals } from '../src/utils/worktreeCleanup'
import type { TerminalSession } from '../src/types'

const term = (id: string, state: TerminalSession['state']) => ({ id, state }) as TerminalSession

describe('closeWorktreeTerminals', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    close.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('closes every terminal, including stopped ones whose shell may still be alive', async () => {
    const removeTerminal = vi.fn()
    const done = closeWorktreeTerminals(
      [term('a', 'busy'), term('b', 'stopped'), term('c', 'done')],
      removeTerminal
    )
    await vi.runAllTimersAsync()
    await done

    expect(close.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
    expect(removeTerminal.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
  })

  test('waits for handle release after closing', async () => {
    let resolved = false
    void closeWorktreeTerminals([term('b', 'stopped')], vi.fn()).then(() => (resolved = true))
    await vi.advanceTimersByTimeAsync(499)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
  })

  test('no terminals: nothing closed, no wait', async () => {
    await closeWorktreeTerminals([], vi.fn())
    expect(close).not.toHaveBeenCalled()
  })
})
