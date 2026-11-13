import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The hook is a standalone .cjs executed by Claude Code per event. Its pure decision
// logic is exported (the stdin wiring is guarded by `require.main === module`).
const require = createRequire(import.meta.url)
const { mapEventToState, shouldSkipWrite, recordState, stateDirFor, INPUT_STATE_GUARD_MS } =
  require('../electron/main/hooks/claude-state-hook.cjs') as {
    mapEventToState: (
      data: Record<string, unknown>,
      current?: { state: string; timestamp?: number }
    ) => string | null
    shouldSkipWrite: (
      current: { state: string; timestamp: number } | undefined,
      incoming: { state: string; hook_event: string },
      now: number,
      guardMs?: number
    ) => boolean
    recordState: (
      stateDir: string,
      data: Record<string, unknown>,
      env: Record<string, string | undefined>,
      now?: () => number
    ) => Promise<'ignored' | 'skipped' | 'written'>
    stateDirFor: (home: string) => string
    INPUT_STATE_GUARD_MS: number
  }

describe('mapEventToState', () => {
  test('AskUserQuestion PreToolUse maps to question', () => {
    expect(mapEventToState({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' })).toBe(
      'question'
    )
  })

  test('other tool PreToolUse maps to busy', () => {
    expect(mapEventToState({ hook_event_name: 'PreToolUse', tool_name: 'Bash' })).toBe('busy')
  })

  test('PermissionRequest maps to permission (AskUserQuestion also fires this)', () => {
    expect(
      mapEventToState({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' })
    ).toBe('permission')
  })

  test('Notification permission_prompt maps to permission', () => {
    expect(
      mapEventToState({ hook_event_name: 'Notification', notification_type: 'permission_prompt' })
    ).toBe('permission')
  })

  test('Notification idle_prompt maps to done', () => {
    expect(
      mapEventToState({ hook_event_name: 'Notification', notification_type: 'idle_prompt' })
    ).toBe('done')
  })

  test('Notification with unhandled type maps to null', () => {
    expect(
      mapEventToState({ hook_event_name: 'Notification', notification_type: 'auth_success' })
    ).toBeNull()
  })

  test('lifecycle events map correctly', () => {
    expect(mapEventToState({ hook_event_name: 'SessionStart' })).toBe('busy')
    expect(mapEventToState({ hook_event_name: 'UserPromptSubmit' })).toBe('busy')
    expect(mapEventToState({ hook_event_name: 'Stop' })).toBe('done')
  })

  // Full event → state table, including the events added for the audit findings.
  test.each([
    [{ hook_event_name: 'SessionStart', source: 'startup' }, 'busy'],
    [{ hook_event_name: 'SessionStart', source: 'compact' }, 'busy'],
    [{ hook_event_name: 'SessionStart', source: 'clear' }, 'done'],
    [{ hook_event_name: 'SessionStart', source: 'resume' }, 'done'],
    [{ hook_event_name: 'UserPromptSubmit' }, 'busy'],
    [{ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, 'busy'],
    [{ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }, 'question'],
    [{ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, 'permission'],
    [{ hook_event_name: 'PostToolUse', tool_name: 'Bash' }, 'busy'],
    [{ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash' }, 'busy'],
    [{ hook_event_name: 'Stop' }, 'done'],
    [{ hook_event_name: 'StopFailure', error: 'rate_limit' }, 'done'],
    [{ hook_event_name: 'SessionEnd', reason: 'clear' }, 'done'],
    [{ hook_event_name: 'SessionEnd', reason: 'resume' }, 'done'],
    [{ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, 'stopped'],
    [{ hook_event_name: 'SessionEnd', reason: 'logout' }, 'stopped'],
    [{ hook_event_name: 'SessionEnd', reason: 'other' }, 'stopped'],
    [{ hook_event_name: 'Notification', notification_type: 'permission_prompt' }, 'permission'],
    [{ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' }, 'question'],
    [{ hook_event_name: 'Notification', notification_type: 'elicitation_url_dialog' }, 'question'],
    [{ hook_event_name: 'Notification', notification_type: 'agent_needs_input' }, 'question'],
    [{ hook_event_name: 'Notification', notification_type: 'idle_prompt' }, 'done'],
    [{ hook_event_name: 'Notification', notification_type: 'agent_completed' }, null],
    [{ hook_event_name: 'SubagentStop' }, null],
  ])('%o maps to %s', (data, expected) => {
    expect(mapEventToState(data)).toBe(expected)
  })

  describe('subagent events (agent_id)', () => {
    const sub = { agent_id: 'agent-1', agent_type: 'Explore' }
    const post = { ...sub, hook_event_name: 'PostToolUse', tool_name: 'Bash' }
    const postFail = { ...sub, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash' }

    test('input requests still surface', () => {
      expect(mapEventToState({ ...sub, hook_event_name: 'PermissionRequest' })).toBe('permission')
      expect(
        mapEventToState({ ...sub, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' })
      ).toBe('question')
    })

    test('PreToolUse busy stays suppressed, even over a stored input state', () => {
      const pre = { ...sub, hook_event_name: 'PreToolUse', tool_name: 'Bash' }
      expect(mapEventToState(pre)).toBeNull()
      expect(mapEventToState(pre, { state: 'permission' })).toBeNull()
      expect(mapEventToState(pre, { state: 'question' })).toBeNull()
    })

    test('PostToolUse(Failure) clears a stored permission/question to busy', () => {
      expect(mapEventToState(post, { state: 'permission' })).toBe('busy')
      expect(mapEventToState(post, { state: 'question' })).toBe('busy')
      expect(mapEventToState(postFail, { state: 'permission' })).toBe('busy')
      expect(mapEventToState(postFail, { state: 'question' })).toBe('busy')
    })

    test('PostToolUse(Failure) is suppressed when no input state is stored', () => {
      for (const ev of [post, postFail]) {
        expect(mapEventToState(ev)).toBeNull()
        expect(mapEventToState(ev, { state: 'done' })).toBeNull()
        expect(mapEventToState(ev, { state: 'busy' })).toBeNull()
        expect(mapEventToState(ev, { state: 'stopped' })).toBeNull()
      }
    })
  })

  test('unknown event maps to null', () => {
    expect(mapEventToState({ hook_event_name: 'PreCompact' })).toBeNull()
    expect(mapEventToState({})).toBeNull()
  })
})

describe('shouldSkipWrite', () => {
  const now = 1_000_000

  test('no current state never skips', () => {
    expect(shouldSkipWrite(undefined, { state: 'busy', hook_event: 'PreToolUse' }, now)).toBe(false)
  })

  test('skips redundant PostToolUse busy when already busy', () => {
    expect(
      shouldSkipWrite(
        { state: 'busy', timestamp: now },
        { state: 'busy', hook_event: 'PostToolUse' },
        now
      )
    ).toBe(true)
  })

  test('PostToolUse busy clears a permission once the guard window has passed', () => {
    const current = { state: 'permission', timestamp: now - (INPUT_STATE_GUARD_MS + 100) }
    expect(shouldSkipWrite(current, { state: 'busy', hook_event: 'PostToolUse' }, now)).toBe(false)
  })

  test('SessionEnd stopped is never skipped, even over a fresh input state', () => {
    const current = { state: 'permission', timestamp: now - 10 }
    expect(shouldSkipWrite(current, { state: 'stopped', hook_event: 'SessionEnd' }, now)).toBe(
      false
    )
  })

  test('skips redundant busy when already busy', () => {
    expect(
      shouldSkipWrite(
        { state: 'busy', timestamp: now },
        { state: 'busy', hook_event: 'PreToolUse' },
        now
      )
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
    expect(shouldSkipWrite(current, { state: 'question', hook_event: 'PreToolUse' }, now)).toBe(
      false
    )
    expect(
      shouldSkipWrite(current, { state: 'permission', hook_event: 'PermissionRequest' }, now)
    ).toBe(false)
  })
})

describe('recordState (per-session state files)', () => {
  const SID_A = 'aaaaaaaa-1111-4111-8111-111111111111'
  const SID_B = 'bbbbbbbb-2222-4222-8222-222222222222'
  const TERMINAL = 'cccccccc-3333-4333-8333-333333333333'
  let home: string
  let dir: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'claude-state-hook-'))
    dir = stateDirFor(home)
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  const read = (sid: string) => JSON.parse(readFileSync(join(dir, `${sid}.json`), 'utf-8'))

  test('stateDirFor points at ~/.claude/command-center-state', () => {
    expect(stateDirFor(home)).toBe(join(home, '.claude', 'command-center-state'))
  })

  test('writes one file per session, with the PTY terminal id from the env', async () => {
    const result = await recordState(
      dir,
      { session_id: SID_A, cwd: 'C:/p', hook_event_name: 'UserPromptSubmit' },
      { COMMAND_CENTER_TERMINAL_ID: TERMINAL }
    )
    expect(result).toBe('written')
    expect(read(SID_A)).toMatchObject({
      session_id: SID_A,
      cwd: 'C:/p',
      state: 'busy',
      hook_event: 'UserPromptSubmit',
      terminal_id: TERMINAL,
    })
    // No temp files left behind
    expect(readdirSync(dir)).toEqual([`${SID_A}.json`])
  })

  test('omits terminal_id outside Command or when the env value is not a UUID', async () => {
    await recordState(dir, { session_id: SID_A, hook_event_name: 'Stop' }, {})
    expect(read(SID_A).terminal_id).toBeUndefined()
    await recordState(
      dir,
      { session_id: SID_B, hook_event_name: 'Stop' },
      { COMMAND_CENTER_TERMINAL_ID: '../evil' }
    )
    expect(read(SID_B).terminal_id).toBeUndefined()
  })

  test('rejects non-UUID session ids (they become file names)', async () => {
    expect(await recordState(dir, { session_id: '../../x', hook_event_name: 'Stop' }, {})).toBe(
      'ignored'
    )
  })

  test('events that do not change state write nothing', async () => {
    expect(await recordState(dir, { session_id: SID_A, hook_event_name: 'PreCompact' }, {})).toBe(
      'ignored'
    )
  })

  test('concurrent writes of different sessions never erase each other (lost-update fix)', async () => {
    const sids = Array.from(
      { length: 12 },
      (_, i) => `${String(i).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
    )
    await Promise.all(
      sids.map((sid) => recordState(dir, { session_id: sid, hook_event_name: 'Stop' }, {}))
    )
    for (const sid of sids) expect(read(sid).state).toBe('done')
  })

  test('the input-state guard reads the session file: a racing busy does not clobber a fresh question', async () => {
    let t = 1_000_000
    const now = () => t
    await recordState(
      dir,
      { session_id: SID_A, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' },
      {},
      now
    )
    t += 100
    expect(
      await recordState(dir, { session_id: SID_A, hook_event_name: 'UserPromptSubmit' }, {}, now)
    ).toBe('skipped')
    expect(read(SID_A).state).toBe('question')
    t += INPUT_STATE_GUARD_MS + 1
    expect(
      await recordState(
        dir,
        { session_id: SID_A, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' },
        {},
        now
      )
    ).toBe('written')
    expect(read(SID_A).state).toBe('busy')
  })

  test('a subagent permission is cleared by its PostToolUse once the user approves', async () => {
    let t = 1_000_000
    const now = () => t
    const sub = { session_id: SID_A, agent_id: 'agent-1', tool_name: 'Bash' }
    await recordState(dir, { session_id: SID_A, hook_event_name: 'Stop' }, {}, now)
    // Subagent noise does not overwrite the main chat's done.
    t += 100
    expect(await recordState(dir, { ...sub, hook_event_name: 'PostToolUse' }, {}, now)).toBe(
      'ignored'
    )
    expect(read(SID_A).state).toBe('done')
    // Subagent asks permission → orange.
    t += 100
    await recordState(dir, { ...sub, hook_event_name: 'PermissionRequest' }, {}, now)
    expect(read(SID_A).state).toBe('permission')
    // A subagent PreToolUse never clears it.
    t += INPUT_STATE_GUARD_MS + 1
    expect(await recordState(dir, { ...sub, hook_event_name: 'PreToolUse' }, {}, now)).toBe(
      'ignored'
    )
    expect(read(SID_A).state).toBe('permission')
    // User approved → the subagent's PostToolUse clears the dot.
    expect(await recordState(dir, { ...sub, hook_event_name: 'PostToolUse' }, {}, now)).toBe(
      'written'
    )
    expect(read(SID_A).state).toBe('busy')
  })

  test('a subagent PostToolUse inside the guard window is still skipped by the guard', async () => {
    let t = 1_000_000
    const now = () => t
    const sub = { session_id: SID_A, agent_id: 'agent-1', tool_name: 'Bash' }
    await recordState(dir, { ...sub, hook_event_name: 'PermissionRequest' }, {}, now)
    t += 100
    expect(await recordState(dir, { ...sub, hook_event_name: 'PostToolUseFailure' }, {}, now)).toBe(
      'skipped'
    )
    expect(read(SID_A).state).toBe('permission')
  })

  test('a corrupt existing session file is overwritten, not fatal', async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${SID_A}.json`), '{not json')
    expect(await recordState(dir, { session_id: SID_A, hook_event_name: 'Stop' }, {})).toBe(
      'written'
    )
    expect(read(SID_A).state).toBe('done')
  })
})
