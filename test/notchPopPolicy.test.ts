import { describe, test, expect } from 'vitest'
import { computeSurfaced, activeSurfacedIds } from '../electron/main/services/notchPopPolicy'
import type { NotchSession, TerminalState } from '../shared/ipc-types'

function session(id: string, state: TerminalState): NotchSession {
  return { id, projectId: 'p', projectName: 'P', title: 't', agentType: 'claude', state }
}

const FLASH = 6000

describe('computeSurfaced', () => {
  test('permission/question/stopped surface persistently (no deadline)', () => {
    for (const state of ['permission', 'question', 'stopped'] as const) {
      const { entries } = computeSurfaced(new Map(), [session('a', state)], 1000, FLASH)
      expect(entries.get('a')).toEqual({ state, deadline: null })
      expect(activeSurfacedIds(entries, 1_000_000)).toEqual(['a'])
    }
  })

  test('busy surfaces persistently (the live overview)', () => {
    const { entries } = computeSurfaced(new Map(), [session('a', 'busy')], 1000, FLASH)
    expect(entries.get('a')).toEqual({ state: 'busy', deadline: null })
    expect(activeSurfacedIds(entries, 1_000_000)).toEqual(['a'])
  })

  test('done surfaces briefly then auto-dismisses', () => {
    const first = computeSurfaced(new Map(), [session('a', 'done')], 1000, FLASH)
    expect(activeSurfacedIds(first.entries, 1000)).toEqual(['a'])
    expect(first.nextDeadline).toBe(1000 + FLASH)

    // Still done on a later tick: deadline preserved, not reset.
    const later = computeSurfaced(first.entries, [session('a', 'done')], 4000, FLASH)
    expect(later.entries.get('a')?.deadline).toBe(1000 + FLASH)

    // After the deadline it is no longer active, and does not re-flash.
    const expired = computeSurfaced(later.entries, [session('a', 'done')], 8000, FLASH)
    expect(activeSurfacedIds(expired.entries, 8000)).toEqual([])
    expect(expired.nextDeadline).toBeNull()
  })

  test('done then permission on the same session becomes persistent', () => {
    const first = computeSurfaced(new Map(), [session('a', 'done')], 1000, FLASH)
    const escalated = computeSurfaced(first.entries, [session('a', 'permission')], 2000, FLASH)
    expect(escalated.entries.get('a')).toEqual({ state: 'permission', deadline: null })
    expect(activeSurfacedIds(escalated.entries, 1_000_000)).toEqual(['a'])
  })

  test('a fresh finish flashes again after the session went busy in between', () => {
    const done1 = computeSurfaced(new Map(), [session('a', 'done')], 1000, FLASH)
    const busy = computeSurfaced(done1.entries, [session('a', 'busy')], 2000, FLASH)
    expect(busy.entries.get('a')).toEqual({ state: 'busy', deadline: null })
    const done2 = computeSurfaced(busy.entries, [session('a', 'done')], 3000, FLASH)
    expect(done2.entries.get('a')?.deadline).toBe(3000 + FLASH)
  })

  test('surfaces multiple concurrent sessions', () => {
    const sessions = [session('a', 'permission'), session('b', 'done'), session('c', 'busy')]
    const { entries } = computeSurfaced(new Map(), sessions, 1000, FLASH)
    expect(new Set(activeSurfacedIds(entries, 1000))).toEqual(new Set(['a', 'b', 'c']))
  })
})
