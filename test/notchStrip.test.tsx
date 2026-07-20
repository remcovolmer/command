// @vitest-environment jsdom

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { NotchStrip } from '@/components/Notch/NotchStrip'
import type { NotchPayload, NotchSession } from '@/types'

let stateCb: ((payload: NotchPayload) => void) | null = null

const session = (id: string): NotchSession => ({
  id,
  projectId: 'p',
  projectName: 'Project',
  title: 'Session',
  agentType: 'claude',
  state: 'busy',
})

beforeEach(() => {
  stateCb = null
  // @ts-expect-error minimal stub — only the notch surface the component uses
  window.electronAPI = {
    notch: {
      onState: (cb: (payload: NotchPayload) => void) => {
        stateCb = cb
        return () => {}
      },
    },
  }
})

afterEach(() => {
  cleanup()
  // @ts-expect-error remove the stub between tests
  delete window.electronAPI
})

describe('NotchStrip', () => {
  test('renders and reflects the pushed session count', () => {
    render(<NotchStrip />)
    expect(screen.getByTestId('notch-strip')).toBeTruthy()
    expect(screen.getByTestId('notch-count').textContent).toBe('0')

    act(() => {
      stateCb?.({ sessions: [session('a'), session('b')] })
    })
    expect(screen.getByTestId('notch-count').textContent).toBe('2')
  })
})
