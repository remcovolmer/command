import { describe, test, expect, vi, beforeEach } from 'vitest'

// Capture the watcher's scoped logger so tests can assert on warn calls
// (and dev-noise stays out of the test output).
const loggerSpies = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}))
vi.mock('../electron/main/services/Logger', () => ({
  createLogger: () => loggerSpies,
}))

import {
  isHookStateData,
  normalizeStateFile,
  ClaudeHookWatcher,
} from '../electron/main/services/ClaudeHookWatcher'

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
    expect(Object.keys(result)).toHaveLength(2)
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

// --- Session-terminal mapping tests ---
// These test the fix for concurrent sessions stealing each other's terminal mapping

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  watchFile: vi.fn(),
  unwatchFile: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}))

// Mocked fs functions (see vi.mock above) for atomic-write assertions
import * as fs from 'fs'

function createMockWindow() {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as unknown as import('electron').BrowserWindow
}

// Reach the vi.fn() behind the BrowserWindow cast for call assertions
function getSend(win: unknown) {
  return (win as { webContents: { send: ReturnType<typeof vi.fn> } }).webContents.send
}

describe('ClaudeHookWatcher session-terminal mapping', () => {
  let watcher: ClaudeHookWatcher
  let mockWindow: ReturnType<typeof createMockWindow>

  beforeEach(() => {
    mockWindow = createMockWindow()
    watcher = new ClaudeHookWatcher(mockWindow)
  })

  function processState(hookState: Record<string, unknown>) {
    // Drive the private processSessionState via type cast
    ;(
      watcher as unknown as { processSessionState(s: Record<string, unknown>): void }
    ).processSessionState(hookState)
  }

  test('registers terminal and maps session on SessionStart', () => {
    watcher.registerTerminal('t1', 'C:/projects/foo')

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })

    const sessions = watcher.getTerminalSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toEqual({ terminalId: 't1', sessionId: 's1' })
  })

  test('two terminals in same cwd get separate sessions', () => {
    watcher.registerTerminal('t1', 'C:/projects/foo')
    watcher.registerTerminal('t2', 'C:/projects/foo')

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })

    processState({
      session_id: 's2',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1001,
      hook_event: 'SessionStart',
    })

    const sessions = watcher.getTerminalSessions()
    expect(sessions).toHaveLength(2)
    const s1 = sessions.find((s) => s.sessionId === 's1')
    const s2 = sessions.find((s) => s.sessionId === 's2')
    expect(s1?.terminalId).toBe('t1')
    expect(s2?.terminalId).toBe('t2')
  })

  test('concurrent sessions do not steal each other on non-SessionStart events', () => {
    // Register two terminals, assign both sessions
    watcher.registerTerminal('t1', 'C:/projects/foo')
    watcher.registerTerminal('t2', 'C:/projects/foo')

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    processState({
      session_id: 's2',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1001,
      hook_event: 'SessionStart',
    })

    // Now s1 sends a PreToolUse event — should NOT steal t2
    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 2000,
      hook_event: 'PreToolUse',
    })

    // Verify mappings are stable
    const sessions = watcher.getTerminalSessions()
    const s1 = sessions.find((s) => s.sessionId === 's1')
    const s2 = sessions.find((s) => s.sessionId === 's2')
    expect(s1?.terminalId).toBe('t1')
    expect(s2?.terminalId).toBe('t2')
  })

  test('third session without a free terminal queues state instead of stealing', () => {
    // Only 2 terminals but 3 sessions
    watcher.registerTerminal('t1', 'C:/projects/foo')
    watcher.registerTerminal('t2', 'C:/projects/foo')

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    processState({
      session_id: 's2',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1001,
      hook_event: 'SessionStart',
    })

    // Third session sends a non-SessionStart event — should be queued, not steal
    processState({
      session_id: 's3',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 2000,
      hook_event: 'PreToolUse',
    })

    // s1 and s2 mappings should be unaffected
    const sessions = watcher.getTerminalSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions.find((s) => s.sessionId === 's1')?.terminalId).toBe('t1')
    expect(sessions.find((s) => s.sessionId === 's2')?.terminalId).toBe('t2')
    // s3 should NOT be mapped
    expect(sessions.find((s) => s.sessionId === 's3')).toBeUndefined()
  })

  test('SessionStart steals terminal when old session is dead (no SessionEnd)', () => {
    watcher.registerTerminal('t1', 'C:/projects/foo')

    // Session s1 starts
    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })

    // s1 dies without SessionEnd, s2 starts in same terminal
    processState({
      session_id: 's2',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 2000,
      hook_event: 'SessionStart',
    })

    // s2 should have stolen the terminal
    const sessions = watcher.getTerminalSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toEqual({ terminalId: 't1', sessionId: 's2' })
  })

  test('SessionEnd cleans up session mapping', () => {
    watcher.registerTerminal('t1', 'C:/projects/foo')

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'done',
      timestamp: 2000,
      hook_event: 'SessionEnd',
    })

    expect(watcher.getTerminalSessions()).toHaveLength(0)
  })

  test('duplicate state (same timestamp+event+state) is deduplicated', () => {
    watcher.registerTerminal('t1', 'C:/projects/foo')
    const send = getSend(mockWindow)

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    expect(send).toHaveBeenCalledTimes(1)

    // Same session, same timestamp+event+state = should be deduplicated
    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    expect(send).toHaveBeenCalledTimes(1) // NOT called again
  })

  test('same timestamp but different state is NOT deduplicated', () => {
    watcher.registerTerminal('t1', 'C:/projects/foo')
    const send = getSend(mockWindow)

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    expect(send).toHaveBeenCalledTimes(1)

    // Same timestamp but different state = genuine state change, should emit
    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'permission',
      timestamp: 1000,
      hook_event: 'PermissionRequest',
    })
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('stale event (older timestamp) is skipped', () => {
    watcher.registerTerminal('t1', 'C:/projects/foo')
    const send = getSend(mockWindow)

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 2000,
      hook_event: 'SessionStart',
    })
    expect(send).toHaveBeenCalledTimes(1)

    // Older timestamp = stale, should be skipped
    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'done',
      timestamp: 1000,
      hook_event: 'Stop',
    })
    expect(send).toHaveBeenCalledTimes(1) // NOT called again
  })

  test('input state (question) surfaces even when a racing busy was processed first with a higher timestamp', () => {
    // Reproduces the AskUserQuestion bug: async hook write-order race causes a 'busy'
    // write to be processed before the 'question'/'permission' write, but with a HIGHER
    // timestamp. The older-timestamp input state must NOT be dropped as stale.
    watcher.registerTerminal('t1', 'C:/projects/foo')
    const send = getSend(mockWindow)

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 2000, // racing busy won the timestamp
      hook_event: 'PreToolUse',
    })
    expect(send).toHaveBeenCalledTimes(1)

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'question',
      timestamp: 1500, // fired earlier / wrote with a lower timestamp
      hook_event: 'PreToolUse',
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith('terminal:state', 't1', 'question')
  })

  test('an unchanged input state is not re-emitted on re-read (no spam)', () => {
    watcher.registerTerminal('t1', 'C:/projects/foo')
    const send = getSend(mockWindow)

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'permission',
      timestamp: 2000,
      hook_event: 'PermissionRequest',
    })
    expect(send).toHaveBeenCalledTimes(1)

    // Exact re-read of the same permission — must be deduped.
    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'permission',
      timestamp: 2000,
      hook_event: 'PermissionRequest',
    })
    // An older-timestamp re-read of the SAME input state is also not a new surfacing.
    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'permission',
      timestamp: 1900,
      hook_event: 'PermissionRequest',
    })
    expect(send).toHaveBeenCalledTimes(1) // no re-emission
  })

  test('different sessions with same timestamp are processed independently', () => {
    watcher.registerTerminal('t1', 'C:/projects/foo')
    watcher.registerTerminal('t2', 'C:/projects/foo')
    const send = getSend(mockWindow)

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    processState({
      session_id: 's2',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    expect(send).toHaveBeenCalledTimes(2) // Both processed

    // Re-read same state for both = both deduplicated
    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    processState({
      session_id: 's2',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    expect(send).toHaveBeenCalledTimes(2) // No new calls
  })

  test('pending states from multiple sessions route to correct terminals', () => {
    // States arrive before terminals are registered
    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    processState({
      session_id: 's2',
      cwd: 'C:\\projects\\foo',
      state: 'done',
      timestamp: 1001,
      hook_event: 'Stop',
    })

    // Now register two terminals — pending states should route through session mapping
    watcher.registerTerminal('t1', 'C:/projects/foo')
    watcher.registerTerminal('t2', 'C:/projects/foo')

    // Both sessions should be mapped (s1 to t1 on replay, s2 to t2)
    const sessions = watcher.getTerminalSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions.find((s) => s.sessionId === 's1')).toBeDefined()
    expect(sessions.find((s) => s.sessionId === 's2')).toBeDefined()
    // They should be on different terminals
    const terminals = sessions.map((s) => s.terminalId)
    expect(new Set(terminals).size).toBe(2)
  })

  // normalizePath() lowercases ONLY on win32 (NTFS is case-insensitive). On Linux,
  // paths are case-sensitive, so registered paths and hook cwds must match exactly
  // after slash normalization. This test documents the Windows-only behavior.
  test.runIf(process.platform === 'win32')(
    'matching is case-insensitive on Windows (lowercase registration matches uppercase cwd)',
    () => {
      watcher.registerTerminal('t1', 'c:/projects/case-sensitivity')

      processState({
        session_id: 's1',
        cwd: 'C:\\Projects\\Case-Sensitivity',
        state: 'busy',
        timestamp: 1000,
        hook_event: 'SessionStart',
      })

      const sessions = watcher.getTerminalSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toEqual({ terminalId: 't1', sessionId: 's1' })
    }
  )

  test('unregisterTerminal cleans up all mappings', () => {
    watcher.registerTerminal('t1', 'C:/projects/foo')

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })

    watcher.unregisterTerminal('t1')

    expect(watcher.getTerminalSessions()).toHaveLength(0)
  })
})

describe('ClaudeHookWatcher state file atomic write', () => {
  let watcher: ClaudeHookWatcher

  function processState(hookState: Record<string, unknown>) {
    ;(
      watcher as unknown as { processSessionState(s: Record<string, unknown>): void }
    ).processSessionState(hookState)
  }

  function endSession(sessionId: string) {
    // SessionStart to map the session, then SessionEnd to trigger the
    // state-file cleanup write.
    processState({
      session_id: sessionId,
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })
    processState({
      session_id: sessionId,
      cwd: 'C:\\projects\\foo',
      state: 'done',
      timestamp: 2000,
      hook_event: 'SessionEnd',
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    watcher = new ClaudeHookWatcher(createMockWindow())
    watcher.registerTerminal('t1', 'C:/projects/foo')
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ s1: makeHookState({ session_id: 's1' }) })
    )
  })

  test('SessionEnd rewrites the state file via temp file + rename', () => {
    endSession('s1')

    // Write goes to the temp file, never directly to the state file
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
    const [writePath, written] = vi.mocked(fs.writeFileSync).mock.calls[0]
    expect(String(writePath)).toMatch(/command-center-state\.json\.tmp$/)
    expect(JSON.parse(String(written))).toEqual({})

    // Rename moves the temp file over the state file, after the write
    expect(fs.renameSync).toHaveBeenCalledTimes(1)
    const [from, to] = vi.mocked(fs.renameSync).mock.calls[0]
    expect(from).toBe(writePath)
    expect(String(to)).toMatch(/command-center-state\.json$/)
    expect(vi.mocked(fs.renameSync).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(fs.writeFileSync).mock.invocationCallOrder[0]
    )
  })

  test('a crash during the temp write leaves the original state file untouched', () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('disk full')
    })

    // Must not throw (errors are swallowed) and must not rename a broken temp file
    expect(() => endSession('s1')).not.toThrow()
    expect(fs.renameSync).not.toHaveBeenCalled()
  })

  test('no write happens when the session is not in the state file', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ other: makeHookState() }))

    endSession('s1')

    expect(fs.writeFileSync).not.toHaveBeenCalled()
    expect(fs.renameSync).not.toHaveBeenCalled()
  })
})

describe('ClaudeHookWatcher state change listeners', () => {
  let watcher: ClaudeHookWatcher
  let mockWindow: ReturnType<typeof createMockWindow>

  function processState(hookState: Record<string, unknown>) {
    ;(
      watcher as unknown as { processSessionState(s: Record<string, unknown>): void }
    ).processSessionState(hookState)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockWindow = createMockWindow()
    watcher = new ClaudeHookWatcher(mockWindow)
    watcher.registerTerminal('t1', 'C:/projects/foo')
  })

  test('a throwing listener logs a warning and does not stop other listeners', () => {
    const throwing = vi.fn(() => {
      throw new Error('listener boom')
    })
    const healthy = vi.fn()
    watcher.addStateChangeListener(throwing)
    watcher.addStateChangeListener(healthy)

    processState({
      session_id: 's1',
      cwd: 'C:\\projects\\foo',
      state: 'busy',
      timestamp: 1000,
      hook_event: 'SessionStart',
    })

    expect(throwing).toHaveBeenCalled()
    expect(healthy).toHaveBeenCalledWith('t1', 'busy')
    expect(loggerSpies.warn).toHaveBeenCalledWith('State change listener threw:', expect.any(Error))
    // The renderer emission still happened despite the throwing listener
    expect(getSend(mockWindow)).toHaveBeenCalledWith('terminal:state', 't1', 'busy')
  })
})
