// @vitest-environment jsdom

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NotchStrip } from '@/components/Notch/NotchStrip'
import type { NotchPayload, NotchSession } from '@/types'

let stateCb: ((payload: NotchPayload) => void) | null = null
const focusSession = vi.fn()
const setEnabled = vi.fn()

const session = (over: Partial<NotchSession>): NotchSession => ({
  id: 'a',
  projectId: 'p1',
  projectName: 'Alpha',
  title: 'Trace events',
  agentType: 'claude',
  state: 'busy',
  ...over,
})

beforeEach(() => {
  stateCb = null
  focusSession.mockReset()
  setEnabled.mockReset()
  // @ts-expect-error minimal stub — only the notch surface the component uses
  window.electronAPI = {
    notch: {
      onState: (cb: (payload: NotchPayload) => void) => {
        stateCb = cb
        return () => {}
      },
      focusSession,
      setEnabled,
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
})
