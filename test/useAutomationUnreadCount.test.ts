// @vitest-environment jsdom

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import type { AutomationRun } from '../src/types'

// Capture subscribers + the listRuns stub so each test can drive the hook
// without round-tripping through Electron IPC.
const { listRunsMock, completedSubs, failedSubs } = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  completedSubs: [] as Array<(run: AutomationRun) => void>,
  failedSubs: [] as Array<(run: AutomationRun) => void>,
}))

vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({
    automation: {
      listRuns: listRunsMock,
      onRunCompleted: (cb: (run: AutomationRun) => void) => {
        completedSubs.push(cb)
        return () => {
          const i = completedSubs.indexOf(cb)
          if (i >= 0) completedSubs.splice(i, 1)
        }
      },
      onRunFailed: (cb: (run: AutomationRun) => void) => {
        failedSubs.push(cb)
        return () => {
          const i = failedSubs.indexOf(cb)
          if (i >= 0) failedSubs.splice(i, 1)
        }
      },
    },
  }),
}))

import { useAutomationUnreadCount } from '../src/hooks/useAutomationUnreadCount'

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1',
    automationId: 'auto-1',
    projectId: 'proj-1',
    status: 'completed',
    startedAt: '2026-06-30T00:00:00Z',
    read: false,
    ...overrides,
  }
}

describe('useAutomationUnreadCount', () => {
  beforeEach(() => {
    listRunsMock.mockReset()
    completedSubs.length = 0
    failedSubs.length = 0
  })
  afterEach(() => cleanup())

  test('counts only unread runs that are not still running', async () => {
    listRunsMock.mockResolvedValue([
      makeRun({ id: '1', read: false, status: 'completed' }), // counts
      makeRun({ id: '2', read: true, status: 'completed' }), // read -> excluded
      makeRun({ id: '3', read: false, status: 'running' }), // running -> excluded
      makeRun({ id: '4', read: false, status: 'failed' }), // counts
    ])
    const { result } = renderHook(() => useAutomationUnreadCount())
    await waitFor(() => expect(result.current).toBe(2))
  })

  test('recomputes when a run completes', async () => {
    listRunsMock.mockResolvedValue([])
    const { result } = renderHook(() => useAutomationUnreadCount())
    await waitFor(() => expect(result.current).toBe(0))

    listRunsMock.mockResolvedValue([makeRun({ id: '1', read: false, status: 'completed' })])
    await act(async () => {
      completedSubs.forEach((cb) => cb(makeRun({ id: '1' })))
    })
    await waitFor(() => expect(result.current).toBe(1))
  })

  test('recomputes when a run fails', async () => {
    listRunsMock.mockResolvedValue([])
    const { result } = renderHook(() => useAutomationUnreadCount())
    await waitFor(() => expect(result.current).toBe(0))

    listRunsMock.mockResolvedValue([makeRun({ id: '1', read: false, status: 'failed' })])
    await act(async () => {
      failedSubs.forEach((cb) => cb(makeRun({ id: '1', status: 'failed' })))
    })
    await waitFor(() => expect(result.current).toBe(1))
  })

  test('swallows a listRuns rejection (count stays put) and recovers on the next event', async () => {
    listRunsMock.mockRejectedValueOnce(new Error('ipc failed'))
    const { result } = renderHook(() => useAutomationUnreadCount())
    // The rejected initial load must not throw; the count holds at its default.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current).toBe(0)

    // A later event re-fetches successfully and updates the count.
    listRunsMock.mockResolvedValue([makeRun({ id: '1', read: false, status: 'completed' })])
    await act(async () => {
      completedSubs.forEach((cb) => cb(makeRun({ id: '1' })))
    })
    await waitFor(() => expect(result.current).toBe(1))
  })

  test('unsubscribes both listeners on unmount', () => {
    listRunsMock.mockResolvedValue([])
    const { unmount } = renderHook(() => useAutomationUnreadCount())
    expect(completedSubs.length).toBe(1)
    expect(failedSubs.length).toBe(1)
    unmount()
    expect(completedSubs.length).toBe(0)
    expect(failedSubs.length).toBe(0)
  })
})
