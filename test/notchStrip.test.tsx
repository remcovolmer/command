// @vitest-environment jsdom

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NotchStrip } from '@/components/Notch/NotchStrip'
import type { NotchPayload, NotchSession } from '@/types'

let stateCb: ((payload: NotchPayload) => void) | null = null
const focusSession = vi.fn()
const setEnabled = vi.fn()
const resize = vi.fn()

const session = (over: Partial<NotchSession>): NotchSession => ({
  id: 'a',
  projectId: 'p1',
  projectName: 'Alpha',
  title: 'Trace events',
  agentType: 'claude',
  state: 'busy',
  ...over,
})

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  stateCb = null
  focusSession.mockReset()
  setEnabled.mockReset()
  resize.mockReset()
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  // @ts-expect-error minimal stub — only the notch surface the component uses
  window.electronAPI = {
    notch: {
      onState: (cb: (payload: NotchPayload) => void) => {
        stateCb = cb
        return () => {}
      },
      focusSession,
      setEnabled,
      resize,
    },
  }
})

afterEach(() => {
  cleanup()
  // @ts-expect-error remove the stub between tests
  delete window.electronAPI
})

function push(payload: NotchPayload): void {
  act(() => {
    stateCb?.(payload)
  })
}

describe('NotchStrip', () => {
  test('collapsed shows a session summary reflecting the feed', () => {
    render(<NotchStrip />)
    expect(screen.getByTestId('notch-strip')).toBeTruthy()
    push({ sessions: [session({ id: 'a' }), session({ id: 'b' })], surfacedIds: [] })
    expect(screen.getByTestId('notch-count').textContent).toContain('2')
  })

  test('hover expands and clicking a session row returns to it', () => {
    render(<NotchStrip />)
    push({
      sessions: [session({ id: 'a', title: 'Trace events', state: 'permission' })],
      surfacedIds: ['a'],
    })
    fireEvent.mouseEnter(screen.getByTestId('notch-strip'))
    fireEvent.click(screen.getByRole('button', { name: /Trace events/ }))
    expect(focusSession).toHaveBeenCalledWith('a')
  })

  test('the hide button turns the notch off', () => {
    render(<NotchStrip />)
    push({ sessions: [session({ id: 'a' })], surfacedIds: ['a'] })
    fireEvent.mouseEnter(screen.getByTestId('notch-strip'))
    fireEvent.click(screen.getByRole('button', { name: /Verberg notch/ }))
    expect(setEnabled).toHaveBeenCalledWith(false)
  })

  test('two projects sharing a display name stay separate groups (keyed by projectId)', () => {
    render(<NotchStrip />)
    push({
      sessions: [
        session({ id: 'a', projectId: 'p1', projectName: 'Alpha' }),
        session({ id: 'b', projectId: 'p2', projectName: 'Alpha' }),
      ],
      surfacedIds: ['a', 'b'],
    })
    fireEvent.mouseEnter(screen.getByTestId('notch-strip'))
    // Two distinct projects -> two group headers, even with the same name.
    expect(screen.getAllByText('Alpha')).toHaveLength(2)
  })
})
