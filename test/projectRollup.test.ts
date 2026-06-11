import { describe, test, expect } from 'vitest'
import { getProjectRollupState } from '../src/utils/projectRollup'
import type { TerminalSession, TerminalState } from '../src/types'

function makeTerminal(
  state: TerminalState,
  index: number,
  type: 'claude' | 'normal' = 'claude'
): TerminalSession {
  return {
    id: `term-${index}`,
    projectId: 'proj-1',
    worktreeId: null,
    state,
    lastActivity: Date.now(),
    title: 'Chat',
    type,
  }
}

function rollup(states: TerminalState[]) {
  return getProjectRollupState(states.map((state, i) => makeTerminal(state, i)))
}

describe('getProjectRollupState', () => {
  test('attention wins over done and busy', () => {
    expect(rollup(['busy', 'done', 'question'])).toBe('attention')
    expect(rollup(['busy', 'done', 'permission'])).toBe('attention')
  })

  test('done wins over busy when no attention state present', () => {
    expect(rollup(['busy', 'done'])).toBe('done')
  })

  test('busy when only busy terminals', () => {
    expect(rollup(['busy'])).toBe('busy')
  })

  test('null for empty terminal list', () => {
    expect(rollup([])).toBeNull()
  })

  test('stopped never contributes to the rollup', () => {
    expect(rollup(['stopped'])).toBeNull()
    expect(rollup(['stopped', 'busy'])).toBe('busy')
  })

  test('permission and question are treated identically', () => {
    expect(rollup(['permission'])).toBe(rollup(['question']))
    expect(rollup(['done', 'permission'])).toBe(rollup(['done', 'question']))
  })

  test('normal (sidecar) terminals never contribute, even in state done', () => {
    // Sidecar shells get state 'done' and never update; counting them would
    // keep the rollup permanently green.
    expect(getProjectRollupState([makeTerminal('done', 0, 'normal')])).toBeNull()
    expect(
      getProjectRollupState([makeTerminal('done', 0, 'normal'), makeTerminal('busy', 1, 'claude')])
    ).toBe('busy')
    expect(
      getProjectRollupState([
        makeTerminal('permission', 0, 'normal'),
        makeTerminal('busy', 1, 'claude'),
      ])
    ).toBe('busy')
  })
})
