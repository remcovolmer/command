import { describe, test, expect } from 'vitest'
import { createRequire } from 'module'

// The hook is a standalone .cjs executed by Codex per event. Its pure decision
// logic is exported (the stdin wiring is guarded by `require.main === module`).
const require = createRequire(import.meta.url)
const { mapEventToState, shouldSkipWrite, INPUT_STATE_GUARD_MS } =
  require('../electron/main/hooks/codex-state-hook.cjs') as {
    mapEventToState: (data: { hook_event_name: string }) => string | null
    shouldSkipWrite: (
      current: { state: string; timestamp?: number } | undefined,
      incoming: { state: string; hook_event: string; timestamp: number },
      now: number,
      guardMs?: number
    ) => boolean
    INPUT_STATE_GUARD_MS: number
  }

describe('codex-state-hook mapEventToState', () => {
  test('working events map to busy', () => {
    expect(mapEventToState({ hook_event_name: 'SessionStart' })).toBe('busy')
    expect(mapEventToState({ hook_event_name: 'UserPromptSubmit' })).toBe('busy')
    expect(mapEventToState({ hook_event_name: 'PreToolUse' })).toBe('busy')
  })

  test('PermissionRequest maps to permission', () => {
    expect(mapEventToState({ hook_event_name: 'PermissionRequest' })).toBe('permission')
  })

  test('Stop maps to done', () => {
    expect(mapEventToState({ hook_event_name: 'Stop' })).toBe('done')
  })

  test('unmapped events return null (no state change)', () => {
    expect(mapEventToState({ hook_event_name: 'PostToolUse' })).toBeNull()
    expect(mapEventToState({ hook_event_name: 'PreCompact' })).toBeNull()
    expect(mapEventToState({ hook_event_name: 'SubagentStart' })).toBeNull()
  })
})

describe('codex-state-hook shouldSkipWrite', () => {
  const now = 1_000_000

  test('no current state never skips', () => {
    expect(shouldSkipWrite(undefined, { state: 'busy', hook_event: 'PreToolUse', timestamp: now }, now)).toBe(
      false
    )
  })

  test('redundant PreToolUse busy while already busy is skipped', () => {
    expect(
      shouldSkipWrite(
        { state: 'busy', timestamp: now - 10 },
        { state: 'busy', hook_event: 'PreToolUse', timestamp: now },
        now
      )
    ).toBe(true)
  })

  test('busy racing a fresh permission inside the guard window is skipped', () => {
    expect(
      shouldSkipWrite(
        { state: 'permission', timestamp: now - 100 },
        { state: 'busy', hook_event: 'PreToolUse', timestamp: now },
        now
      )
    ).toBe(true)
  })

  test('busy after the guard window elapses is allowed', () => {
    expect(
      shouldSkipWrite(
        { state: 'permission', timestamp: now - (INPUT_STATE_GUARD_MS + 100) },
        { state: 'busy', hook_event: 'UserPromptSubmit', timestamp: now },
        now
      )
    ).toBe(false)
  })

  test('done (Stop) is allowed to clear a pending permission', () => {
    expect(
      shouldSkipWrite(
        { state: 'permission', timestamp: now - 100 },
        { state: 'done', hook_event: 'Stop', timestamp: now },
        now
      )
    ).toBe(false)
  })
})
