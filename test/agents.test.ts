import { describe, test, expect } from 'vitest'
import { AGENT_IDS, AGENT_DISPLAY, isAgentType } from '../shared/agents'
import { AGENT_SPAWN, buildAgentCommand } from '../electron/main/services/agents'

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
  })

  test('codex resumes via subcommand; pi via --session; mode flags are claude-only', () => {
    expect(buildAgentCommand('codex', {})).toBe('codex')
    expect(buildAgentCommand('codex', { resumeSessionId: 'uuid-1' })).toBe('codex resume "uuid-1"')
    expect(buildAgentCommand('codex', { claudeMode: 'full-auto' })).toBe('codex')
    expect(buildAgentCommand('pi', {})).toBe('pi')
    expect(buildAgentCommand('pi', { resumeSessionId: 's1' })).toBe('pi --session "s1"')
  })

  test('only claude and codex report state via a hook', () => {
    expect(AGENT_SPAWN.claude.hasHook).toBe(true)
    expect(AGENT_SPAWN.codex.hasHook).toBe(true)
    expect(AGENT_SPAWN.pi.hasHook).toBe(false)
  })
})
