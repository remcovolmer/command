import { describe, test, expect } from 'vitest'
import { createRequire } from 'module'

// The hook is a standalone .cjs executed by Claude Code per event. Its pure decision
// logic is exported (the stdin wiring is guarded by `require.main === module`).
const require = createRequire(import.meta.url)
const { mapEventToState, shouldSkipWrite, INPUT_STATE_GUARD_MS } = require(
  '../electron/main/hooks/claude-state-hook.cjs'
) as {
  mapEventToState: (data: Record<string, unknown>) => string | null
  shouldSkipWrite: (
    current: { state: string; timestamp: number } | undefined,
    incoming: { state: string; hook_event: string },
    now: number,
    guardMs?: number
  ) => boolean
  INPUT_STATE_GUARD_MS: number
}

describe('mapEventToState', () => {
  test('AskUserQuestion PreToolUse maps to question', () => {
    expect(mapEventToState({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' })).toBe('question')
  })

  test('other tool PreToolUse maps to busy', () => {
    expect(mapEventToState({ hook_event_name: 'PreToolUse', tool_name: 'Bash' })).toBe('busy')
  })

  test('PermissionRequest maps to permission (AskUserQuestion also fires this)', () => {
    expect(mapEventToState({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' })).toBe('permission')
  })

  test('Notification permission_prompt maps to permission', () => {
    expect(mapEventToState({ hook_event_name: 'Notification', notification_type: 'permission_prompt' })).toBe('permission')
  })

  test('Notification idle_prompt maps to done', () => {
    expect(mapEventToState({ hook_event_name: 'Notification', notification_type: 'idle_prompt' })).toBe('done')
  })

  test('Notification with unhandled type maps to null', () => {
    expect(mapEventToState({ hook_event_name: 'Notification', notification_type: 'auth_success' })).toBeNull()
  })

  test('lifecycle events map correctly', () => {
    expect(mapEventToState({ hook_event_name: 'SessionStart' })).toBe('busy')
    expect(mapEventToState({ hook_event_name: 'UserPromptSubmit' })).toBe('busy')
    expect(mapEventToState({ hook_event_name: 'Stop' })).toBe('done')
    expect(mapEventToState({ hook_event_name: 'SessionEnd' })).toBe('done')
  })

  test('unknown event maps to null', () => {
    expect(mapEventToState({ hook_event_name: 'PostToolUse' })).toBeNull()
    expect(mapEventToState({})).toBeNull()
  })
})

describe('shouldSkipWrite', () => {
  const now = 1_000_000

  test('no current state never skips', () => {
    expect(shouldSkipWrite(undefined, { state: 'busy', hook_event: 'PreToolUse' }, now)).toBe(false)
  })

  test('skips redundant busy when already busy', () => {
    expect(
      shouldSkipWrite({ state: 'busy', timestamp: now }, { state: 'busy', hook_event: 'PreToolUse' }, now)
    ).toBe(true)
  })

  // --- The bug: a racing busy must not clobber a fresh input state ---

  test('skips busy that would clobber a FRESH question (race partner)', () => {
    const current = { state: 'question', timestamp: now - 100 }
    expect(shouldSkipWrite(current, { state: 'busy', hook_event: 'PreToolUse' }, now)).toBe(true)
  })

  test('skips busy that would clobber a FRESH permission', () => {
    const current = { state: 'permission', timestamp: now - 500 }
    expect(shouldSkipWrite(current, { state: 'busy', hook_event: 'PreToolUse' }, now)).toBe(true)
  })

  test('allows busy to clear an OLD input state (genuine resume after answer)', () => {
    const current = { state: 'question', timestamp: now - (INPUT_STATE_GUARD_MS + 100) }
    expect(shouldSkipWrite(current, { state: 'busy', hook_event: 'PreToolUse' }, now)).toBe(false)
  })

  test('skips idle done (Notification) while an input state is pending', () => {
    const current = { state: 'permission', timestamp: now - 90_000 } // 90s old, idle fired
    expect(shouldSkipWrite(current, { state: 'done', hook_event: 'Notification' }, now)).toBe(true)
  })

  test('allows a real Stop done to clear an input state', () => {
    const current = { state: 'question', timestamp: now - 100 }
    expect(shouldSkipWrite(current, { state: 'done', hook_event: 'Stop' }, now)).toBe(false)
  })

  test('never skips an incoming input state (question/permission must surface)', () => {
    const current = { state: 'busy', timestamp: now }
    expect(shouldSkipWrite(current, { state: 'question', hook_event: 'PreToolUse' }, now)).toBe(false)
    expect(shouldSkipWrite(current, { state: 'permission', hook_event: 'PermissionRequest' }, now)).toBe(false)
  })
})
