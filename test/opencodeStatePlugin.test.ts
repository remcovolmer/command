import { describe, test, expect } from 'vitest'

// The plugin is a standalone ESM module loaded by opencode (Bun). Its pure
// decision logic rides on the plugin function as properties (opencode refuses
// files with non-function exports, so they cannot be module exports).
import { CommandCenterState } from '../electron/main/hooks/opencode-command-center.js'

const { mapEventToState, extractSession, shouldSkipWrite, INPUT_STATE_GUARD_MS } =
  CommandCenterState as unknown as {
    mapEventToState: (event: { type?: string; properties?: object } | null | undefined) => string | null
    extractSession: (event: unknown) => { sessionId: string | null; cwd: string | null }
    shouldSkipWrite: (
      current: { state: string; timestamp?: number } | undefined,
      incoming: { state: string; hook_event: string; timestamp: number },
      now: number,
      guardMs?: number
    ) => boolean
    INPUT_STATE_GUARD_MS: number
  }

describe('opencode-state-plugin mapEventToState', () => {
  test('lifecycle events map to busy', () => {
    expect(mapEventToState({ type: 'session.created', properties: {} })).toBe('busy')
    expect(mapEventToState({ type: 'session.updated', properties: {} })).toBe('busy')
    expect(
      mapEventToState({ type: 'session.status', properties: { status: { type: 'busy' } } })
    ).toBe('busy')
    // Unknown status payloads fail open to busy (a status event means work).
    expect(mapEventToState({ type: 'session.status', properties: {} })).toBe('busy')
  })

  test('permission.asked maps to permission', () => {
    expect(mapEventToState({ type: 'permission.asked', properties: {} })).toBe('permission')
  })

  test('idle and error map to done', () => {
    expect(mapEventToState({ type: 'session.idle', properties: {} })).toBe('done')
    expect(
      mapEventToState({ type: 'session.status', properties: { status: { type: 'idle' } } })
    ).toBe('done')
    // A failed run still waits for the user, like a finished one.
    expect(mapEventToState({ type: 'session.error', properties: {} })).toBe('done')
  })

  test('unmapped and malformed events return null (no state change)', () => {
    expect(mapEventToState({ type: 'message.updated', properties: {} })).toBeNull()
    expect(mapEventToState({ type: 'plugin.added', properties: {} })).toBeNull()
    expect(mapEventToState({ type: 'catalog.updated', properties: {} })).toBeNull()
    expect(mapEventToState(null)).toBeNull()
    expect(mapEventToState(undefined)).toBeNull()
    expect(mapEventToState({})).toBeNull()
  })
})

describe('opencode-state-plugin extractSession', () => {
  test('reads the v1 bus shape (properties.sessionID + info.directory)', () => {
    expect(
      extractSession({
        type: 'session.created',
        properties: { sessionID: 'ses_abc', info: { directory: 'C:\\proj' } },
      })
    ).toEqual({ sessionId: 'ses_abc', cwd: 'C:\\proj' })
  })

  test('falls back to info.id when sessionID is absent', () => {
    expect(extractSession({ type: 'x', properties: { info: { id: 'ses_def' } } })).toEqual({
      sessionId: 'ses_def',
      cwd: null,
    })
  })

  test('missing ids yield nulls instead of throwing', () => {
    expect(extractSession({ type: 'session.idle', properties: {} })).toEqual({
      sessionId: null,
      cwd: null,
    })
    expect(extractSession(null)).toEqual({ sessionId: null, cwd: null })
  })
})

describe('opencode-state-plugin shouldSkipWrite', () => {
  const now = 1_000_000

  test('no current state never skips', () => {
    expect(
      shouldSkipWrite(undefined, { state: 'busy', hook_event: 'tool.execute.before', timestamp: now }, now)
    ).toBe(false)
  })

  test('redundant tool-execute busy while already busy is skipped', () => {
    expect(
      shouldSkipWrite(
        { state: 'busy', timestamp: now - 10 },
        { state: 'busy', hook_event: 'tool.execute.before', timestamp: now },
        now
      )
    ).toBe(true)
  })

  test('busy racing a fresh permission inside the guard window is skipped', () => {
    expect(
      shouldSkipWrite(
        { state: 'permission', timestamp: now - 100 },
        { state: 'busy', hook_event: 'session.status', timestamp: now },
        now
      )
    ).toBe(true)
  })

  test('busy after the guard window elapses is allowed', () => {
    expect(
      shouldSkipWrite(
        { state: 'permission', timestamp: now - (INPUT_STATE_GUARD_MS + 100) },
        { state: 'busy', hook_event: 'session.updated', timestamp: now },
        now
      )
    ).toBe(false)
  })

  test('done (idle) is allowed to clear a pending permission', () => {
    expect(
      shouldSkipWrite(
        { state: 'permission', timestamp: now - 100 },
        { state: 'done', hook_event: 'session.idle', timestamp: now },
        now
      )
    ).toBe(false)
  })
})

describe('opencode-state-plugin entrypoint', () => {
  test('exposes the bus event plus tool and permission slots', async () => {
    const hooks = (await CommandCenterState()) as Record<string, unknown>
    expect(typeof hooks.event).toBe('function')
    expect(typeof hooks['tool.execute.before']).toBe('function')
    expect(typeof hooks['permission.ask']).toBe('function')
  })
})
