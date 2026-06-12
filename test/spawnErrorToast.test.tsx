// @vitest-environment jsdom

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { SpawnFailedEvent } from '../src/types'

// Capture the latest spawn-failed subscriber so each test can emit events
// directly without round-tripping through Electron IPC mocks.
let lastSubscriber: ((event: SpawnFailedEvent) => void) | null = null

vi.mock('../src/utils/terminalEvents', () => {
  return {
    terminalEvents: {
      onSpawnFailed: (cb: (event: SpawnFailedEvent) => void) => {
        lastSubscriber = cb
        return () => {
          if (lastSubscriber === cb) lastSubscriber = null
        }
      },
    },
  }
})

// SpawnErrorToast pulls the crash-log opener from electronAPI; stub so it
// doesn't throw under jsdom (window.electronAPI is undefined here).
vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({
    app: { openCrashLog: vi.fn(async () => ({ success: true })) },
  }),
}))

// Toast registry uses module-level state — reset between tests.
import { _resetToastRegistry, dismissTopmostToast } from '../src/utils/toastRegistry'
import { SpawnErrorToast } from '../src/components/notifications/SpawnErrorToast'

function emit(event: SpawnFailedEvent) {
  if (!lastSubscriber) throw new Error('toast component did not subscribe')
  act(() => {
    lastSubscriber!(event)
  })
}

describe('SpawnErrorToast', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _resetToastRegistry()
    lastSubscriber = null
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    consoleErrorSpy.mockRestore()
  })

  test('CWD_MISSING renders the missing-directory title and body', () => {
    render(<SpawnErrorToast />)
    emit({ code: 'CWD_MISSING', cwd: 'C:\\gone', message: 'missing' })
    expect(screen.getByText('Working directory not found')).toBeTruthy()
    expect(screen.getByText(/C:\\gone no longer exists/)).toBeTruthy()
  })

  test('CWD_NOT_DIR renders the not-a-directory title', () => {
    render(<SpawnErrorToast />)
    emit({ code: 'CWD_NOT_DIR', cwd: 'C:\\file.txt', message: 'not a dir' })
    expect(screen.getByText('Working directory invalid')).toBeTruthy()
    expect(screen.getByText(/C:\\file\.txt is not a directory/)).toBeTruthy()
  })

  test('SPAWN_FAILED renders the failed-to-start title and the Open crash.log button', () => {
    render(<SpawnErrorToast />)
    emit({ code: 'SPAWN_FAILED', cwd: 'C:\\x', message: 'native' })
    expect(screen.getByText('Failed to start shell')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Open crash\.log/i })).toBeTruthy()
  })

  test('non-SPAWN_FAILED variants do NOT show the Open crash.log button', () => {
    render(<SpawnErrorToast />)
    emit({ code: 'CWD_MISSING', cwd: 'C:\\gone', message: '' })
    expect(screen.queryByRole('button', { name: /Open crash\.log/i })).toBeNull()
  })

  test('auto-dismiss fires after 8000ms and removes the toast', () => {
    vi.useFakeTimers()
    try {
      render(<SpawnErrorToast />)
      emit({ code: 'SPAWN_FAILED', cwd: 'C:\\x', message: 'm' })
      expect(screen.getByText('Failed to start shell')).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(8000)
      })
      expect(screen.queryByText('Failed to start shell')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('unmount with pending toasts does not trigger setState-after-unmount warnings', () => {
    vi.useFakeTimers()
    try {
      const { unmount } = render(<SpawnErrorToast />)
      emit({ code: 'SPAWN_FAILED', cwd: 'C:\\x', message: 'm' })
      // Unmount while the auto-dismiss timer is still pending. If the timer
      // fires after unmount and tries setToasts, React emits a console.error.
      unmount()
      act(() => {
        vi.advanceTimersByTime(10000)
      })
      // No setState-after-unmount warnings from React
      const calls = consoleErrorSpy.mock.calls.map((c) => String(c[0]))
      const offenders = calls.filter((s) => /unmounted component/i.test(s) || /act\(/.test(s))
      expect(offenders).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  test('dedup: emitting twice with same (code, cwd) keeps a single toast and refreshes the timer', () => {
    vi.useFakeTimers()
    try {
      render(<SpawnErrorToast />)
      emit({ code: 'CWD_MISSING', cwd: 'C:\\gone', message: 'first' })
      // Advance most of the auto-dismiss window before re-emitting; if the
      // timer were NOT refreshed, the original 8s would still fire and the
      // toast would disappear at 8s total.
      act(() => {
        vi.advanceTimersByTime(7000)
      })
      emit({ code: 'CWD_MISSING', cwd: 'C:\\gone', message: 'second' })
      // Only one toast on screen
      expect(screen.getAllByText('Working directory not found').length).toBe(1)
      // 1.5s after the second emit (8.5s total) — would have been dismissed
      // already if the timer hadn't been refreshed by dedup.
      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(screen.queryByText('Working directory not found')).toBeTruthy()
      // After full 8s from second emit it should be gone.
      act(() => {
        vi.advanceTimersByTime(7000)
      })
      expect(screen.queryByText('Working directory not found')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('toast registers with the dismiss-topmost registry so Escape can dismiss it', () => {
    render(<SpawnErrorToast />)
    emit({ code: 'CWD_MISSING', cwd: 'C:\\gone', message: '' })
    expect(screen.getByText('Working directory not found')).toBeTruthy()
    let dismissed = false
    act(() => {
      dismissed = dismissTopmostToast()
    })
    expect(dismissed).toBe(true)
    expect(screen.queryByText('Working directory not found')).toBeNull()
    // Registry is empty now
    expect(dismissTopmostToast()).toBe(false)
  })
})
