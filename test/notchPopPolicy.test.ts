import { describe, test, expect } from 'vitest'
import { computeSurfacedIds } from '../electron/main/services/notchPopPolicy'
import type { NotchSession, TerminalState } from '../shared/ipc-types'

function session(id: string, state: TerminalState): NotchSession {
  return { id, projectId: 'p', projectName: 'P', title: 't', agentType: 'claude', state }
}

describe('computeSurfacedIds', () => {
  test('surfaces every live session (busy/permission/question/stopped/done)', () => {
    const sessions = [
      session('a', 'busy'),
      session('b', 'permission'),
      session('c', 'question'),
      session('d', 'stopped'),
      session('e', 'done'),
    ]
    expect(computeSurfacedIds(sessions, new Set())).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
  })

  test('a done session the user has seen (acknowledged) is not surfaced', () => {
    const sessions = [session('a', 'busy'), session('e', 'done')]
    expect(computeSurfacedIds(sessions, new Set(['e']))).toEqual(new Set(['a']))
  })

  test('acknowledgement only suppresses done — a session that went back to busy still surfaces', () => {
    // 'e' was acknowledged while done, but is now busy again -> surfaces.
    const sessions = [session('e', 'busy')]
    expect(computeSurfacedIds(sessions, new Set(['e']))).toEqual(new Set(['e']))
  })

  test('empty feed surfaces nothing', () => {
    expect(computeSurfacedIds([], new Set())).toEqual(new Set())
  })
})
