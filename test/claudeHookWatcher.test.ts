import { describe, test, expect } from 'vitest'
import { isHookStateData, normalizeStateFile } from '../electron/main/services/ClaudeHookWatcher'

function makeHookState(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    cwd: 'C:\\Users\\test',
    state: 'busy',
    timestamp: Date.now(),
    hook_event: 'PreToolUse',
    ...overrides,
  }
}

describe('isHookStateData', () => {
  test('returns true for valid hook state data', () => {
    expect(isHookStateData(makeHookState())).toBe(true)
  })

  test('returns false for null/undefined', () => {
    expect(isHookStateData(null)).toBe(false)
    expect(isHookStateData(undefined)).toBe(false)
  })

  test('returns false for non-object', () => {
    expect(isHookStateData('string')).toBe(false)
    expect(isHookStateData(42)).toBe(false)
  })

  test('returns false when required fields are missing', () => {
    expect(isHookStateData({ session_id: 'x' })).toBe(false)
    expect(isHookStateData({ session_id: 'x', state: 'busy' })).toBe(false)
    expect(isHookStateData({ session_id: 'x', state: 'busy', timestamp: 1 })).toBe(false)
  })

  test('allows missing cwd (optional)', () => {
    const data = makeHookState()
    delete (data as Record<string, unknown>).cwd
    expect(isHookStateData(data)).toBe(true)
  })
})

describe('normalizeStateFile', () => {
  test('returns empty for null/undefined', () => {
    expect(normalizeStateFile(null)).toEqual({})
    expect(normalizeStateFile(undefined)).toEqual({})
  })

  test('returns empty for non-object', () => {
    expect(normalizeStateFile('string')).toEqual({})
    expect(normalizeStateFile(42)).toEqual({})
  })

  test('returns empty for empty object', () => {
    expect(normalizeStateFile({})).toEqual({})
  })

  test('handles clean multi-session format', () => {
    const session1 = makeHookState({ session_id: 'aaa-111' })
    const session2 = makeHookState({ session_id: 'bbb-222', state: 'done' })
    const input = {
      'aaa-111': session1,
      'bbb-222': session2,
    }

    const result = normalizeStateFile(input)
    expect(Object.keys(result)).toHaveLength(2)
    expect(result['aaa-111'].state).toBe('busy')
    expect(result['bbb-222'].state).toBe('done')
  })

  test('handles legacy single-session format (flat fields at root)', () => {
    const input = makeHookState({ session_id: 'legacy-id' })

    const result = normalizeStateFile(input)
    expect(Object.keys(result)).toHaveLength(1)
    expect(result['legacy-id']).toBeDefined()
    expect(result['legacy-id'].state).toBe('busy')
  })

  test('handles mixed format (legacy root fields + nested sessions)', () => {
    // This is the actual bug scenario: root has flat legacy fields AND nested session objects
    const session1 = makeHookState({ session_id: 'session-1', state: 'done' })
    const session2 = makeHookState({ session_id: 'session-2', state: 'permission' })
    const input = {
      // Legacy flat fields at root level
      session_id: 'old-session',
      cwd: 'C:\\old\\path',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'UserPromptSubmit',
      // Nested session objects
      'session-1': session1,
      'session-2': session2,
    }

    const result = normalizeStateFile(input)
    // Should include the nested sessions, NOT short-circuit on legacy root
    expect(Object.keys(result).length).toBeGreaterThanOrEqual(2)
    expect(result['session-1']).toBeDefined()
    expect(result['session-2']).toBeDefined()
    expect(result['session-1'].state).toBe('done')
    expect(result['session-2'].state).toBe('permission')
  })

  test('skips invalid entries in multi-session format', () => {
    const valid = makeHookState({ session_id: 'valid-1' })
    const input = {
      'valid-1': valid,
      'invalid-1': { not: 'a session' },
      'invalid-2': 'just a string',
      'invalid-3': null,
    }

    const result = normalizeStateFile(input)
    expect(Object.keys(result)).toHaveLength(1)
    expect(result['valid-1']).toBeDefined()
  })

  test('handles real-world corrupted state file format', () => {
    // Actual data observed in ~/.claude/command-center-state.json
    const input = {
      session_id: '50bf7487-788b-4a82-bd96-7667da988f08',
      cwd: 'c:\\Users\\RemcoVolmer\\Code\\command',
      state: 'busy',
      timestamp: 1770294770449,
      hook_event: 'UserPromptSubmit',
      '0b5bf2fb-5249-40fc-a186-eee346141267': {
        session_id: '0b5bf2fb-5249-40fc-a186-eee346141267',
        cwd: 'C:\\Users\\RemcoVolmer\\Code\\command\\.worktrees\\fix-performance',
        state: 'done',
        timestamp: 1771949058826,
        hook_event: 'Stop',
      },
      'a15d1620-e873-44fa-bd47-bb20d1ff35c4': {
        session_id: 'a15d1620-e873-44fa-bd47-bb20d1ff35c4',
        cwd: 'C:\\Users\\RemcoVolmer\\Code\\pascal_jurisprudentie',
        state: 'busy',
        timestamp: 1771949160554,
        hook_event: 'UserPromptSubmit',
      },
    }

    const result = normalizeStateFile(input)
    // Must find the nested sessions
    expect(result['0b5bf2fb-5249-40fc-a186-eee346141267']).toBeDefined()
    expect(result['a15d1620-e873-44fa-bd47-bb20d1ff35c4']).toBeDefined()
    expect(result['0b5bf2fb-5249-40fc-a186-eee346141267'].state).toBe('done')
    expect(result['a15d1620-e873-44fa-bd47-bb20d1ff35c4'].state).toBe('busy')
  })
})
