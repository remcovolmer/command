import { describe, test, expect } from 'vitest'
import { AGENT_IDS, AGENT_DISPLAY, isAgentType } from '../shared/agents'
import { AGENT_SPAWN, buildAgentCommand, buildPromptArg, opencodeSessionListContains, resolveHeadlessSpec, parseHeadlessOutput } from '../electron/main/services/agents'

describe('agent registry', () => {
  test('AGENT_IDS covers exactly the display and spawn map keys', () => {
    const ids = [...AGENT_IDS].sort()
    expect(Object.keys(AGENT_DISPLAY).sort()).toEqual(ids)
    expect(Object.keys(AGENT_SPAWN).sort()).toEqual(ids)
  })

  test('every agent has display metadata and a spawn spec', () => {
    for (const id of AGENT_IDS) {
      expect(AGENT_DISPLAY[id].label.length).toBeGreaterThan(0)
      expect(AGENT_SPAWN[id].binary.length).toBeGreaterThan(0)
    }
  })

  test('isAgentType accepts agents and rejects normal / junk', () => {
    expect(isAgentType('claude')).toBe(true)
    expect(isAgentType('codex')).toBe(true)
    expect(isAgentType('pi')).toBe(true)
    expect(isAgentType('opencode')).toBe(true)
    expect(isAgentType('normal')).toBe(false)
    expect(isAgentType('')).toBe(false)
    expect(isAgentType(undefined)).toBe(false)
    expect(isAgentType(42)).toBe(false)
  })

  test('claude keeps its existing command shape (no regression)', () => {
    expect(buildAgentCommand('claude', {})).toBe('claude')
    expect(buildAgentCommand('claude', { resumeSessionId: 'abc' })).toBe('claude --resume "abc"')
    expect(buildAgentCommand('claude', { claudeMode: 'auto' })).toBe('claude --enable-auto-mode')
    expect(buildAgentCommand('claude', { claudeMode: 'full-auto' })).toBe(
      'claude --dangerously-skip-permissions'
    )
    expect(buildAgentCommand('claude', { resumeSessionId: 'x', claudeMode: 'auto' })).toBe(
      'claude --resume "x" --enable-auto-mode'
    )
    expect(buildAgentCommand('claude', { resumeSessionId: 'x', claudeMode: 'full-auto' })).toBe(
      'claude --resume "x" --dangerously-skip-permissions'
    )
  })

  test('codex maps only Full Auto to its approvals-and-sandbox bypass', () => {
    expect(buildAgentCommand('codex', {})).toBe('codex')
    expect(buildAgentCommand('codex', { claudeMode: 'chat' })).toBe('codex')
    expect(buildAgentCommand('codex', { claudeMode: 'auto' })).toBe('codex')
    expect(buildAgentCommand('codex', { claudeMode: 'full-auto' })).toBe(
      'codex --dangerously-bypass-approvals-and-sandbox'
    )
    expect(buildAgentCommand('codex', { resumeSessionId: 'uuid-1' })).toBe('codex resume "uuid-1"')
    expect(
      buildAgentCommand('codex', {
        resumeSessionId: 'uuid-1',
        claudeMode: 'full-auto',
      })
    ).toBe('codex resume "uuid-1" --dangerously-bypass-approvals-and-sandbox')
  })

  test('pi resumes via --session and ignores every mode value', () => {
    expect(buildAgentCommand('pi', {})).toBe('pi')
    expect(buildAgentCommand('pi', { resumeSessionId: 's1' })).toBe('pi --session "s1"')
    expect(buildAgentCommand('pi', { claudeMode: 'chat' })).toBe('pi')
    expect(buildAgentCommand('pi', { claudeMode: 'auto' })).toBe('pi')
    expect(buildAgentCommand('pi', { claudeMode: 'full-auto' })).toBe('pi')
  })

  test('only claude, codex and opencode report state via a hook', () => {
    expect(AGENT_SPAWN.claude.hasHook).toBe(true)
    expect(AGENT_SPAWN.codex.hasHook).toBe(true)
    expect(AGENT_SPAWN.opencode.hasHook).toBe(true)
    expect(AGENT_SPAWN.pi.hasHook).toBe(false)
  })

  test('opencode resumes via --session and maps only Full Auto to --auto', () => {
    expect(buildAgentCommand('opencode', {})).toBe('opencode')
    expect(buildAgentCommand('opencode', { claudeMode: 'chat' })).toBe('opencode')
    expect(buildAgentCommand('opencode', { claudeMode: 'auto' })).toBe('opencode')
    expect(buildAgentCommand('opencode', { claudeMode: 'full-auto' })).toBe('opencode --auto')
    expect(buildAgentCommand('opencode', { resumeSessionId: 'ses_abc123' })).toBe(
      'opencode --session "ses_abc123"'
    )
  })

  test('initial prompt goes positionally after --, except opencode via --prompt', () => {
    // Quoted prompts arrive shell-quoted (see quotePromptForShell).
    expect(buildPromptArg('claude', "'do the thing'")).toBe(" -- 'do the thing'")
    expect(buildPromptArg('codex', "'do the thing'")).toBe(" -- 'do the thing'")
    expect(buildPromptArg('pi', "'do the thing'")).toBe(" -- 'do the thing'")
    // opencode's positional is a project path — the prompt needs its flag.
    expect(buildPromptArg('opencode', "'do the thing'")).toBe(" --prompt 'do the thing'")
  })

  test('opencodeSessionListContains matches ids, fail-closed on garbage', () => {
    const list = JSON.stringify([
      { id: 'ses_abc', title: 'a' },
      { id: 'ses_def', title: 'b' },
    ])
    expect(opencodeSessionListContains(list, 'ses_abc')).toBe(true)
    expect(opencodeSessionListContains(list, 'ses_missing')).toBe(false)
    expect(opencodeSessionListContains('[]', 'ses_abc')).toBe(false)
    expect(opencodeSessionListContains('not json', 'ses_abc')).toBe(false)
    expect(opencodeSessionListContains('{"id":"ses_abc"}', 'ses_abc')).toBe(false)
    expect(opencodeSessionListContains('', 'ses_abc')).toBe(false)
  })

  test('headless claude keeps its exact argv (no regression)', () => {
    const spec = resolveHeadlessSpec('claude')
    expect(spec.binary).toBe('claude')
    expect(spec.buildArgs('do it')).toEqual([
      '-p',
      'do it',
      '--output-format',
      'json',
      '--dangerously-skip-permissions',
    ])
  })

  test('headless opencode runs non-interactively with JSON events', () => {
    const spec = resolveHeadlessSpec('opencode')
    expect(spec.binary).toBe('opencode')
    expect(spec.buildArgs('do it')).toEqual(['run', '--format', 'json', '--auto', 'do it'])
  })

  test('agents without a headless spec fall back to claude', () => {
    expect(resolveHeadlessSpec('codex').binary).toBe('claude')
    expect(resolveHeadlessSpec('pi').binary).toBe('claude')
  })

  test('claude headless parser reads the JSON envelope, raw fallback otherwise', () => {
    expect(parseHeadlessOutput('claude', '{"result":"did stuff","session_id":"abc-123"}')).toEqual(
      { output: 'did stuff', sessionId: 'abc-123' }
    )
    expect(parseHeadlessOutput('claude', 'plain text output')).toEqual({
      output: 'plain text output',
    })
  })

  test('opencode headless parser accumulates NDJSON text parts and the session id', () => {
    const ndjson = [
      '{"type":"step_start","timestamp":1,"sessionID":"ses_test123","part":{"type":"step-start"}}',
      '{"type":"text","timestamp":2,"sessionID":"ses_test123","part":{"type":"text","text":"Hello "}}',
      '{"type":"text","timestamp":3,"sessionID":"ses_test123","part":{"type":"text","text":"world"}}',
      '{"type":"step_finish","timestamp":4,"sessionID":"ses_test123","part":{"type":"step-finish","reason":"stop"}}',
    ].join('\n')
    expect(parseHeadlessOutput('opencode', ndjson)).toEqual({
      output: 'Hello world',
      sessionId: 'ses_test123',
    })
  })

  test('opencode headless parser falls back to raw stdout without text parts', () => {
    expect(parseHeadlessOutput('opencode', 'not json at all')).toEqual({
      output: 'not json at all',
      sessionId: undefined,
    })
  })
})
