import { describe, test, expect } from 'vitest'
import {
  areChatsVisible,
  getCloseHotkeyDecision,
  getMountedChats,
  getViewportActiveTerminalId,
} from '../src/utils/terminalMounting'
import type { TerminalSession } from '../src/types'

function term(id: string, overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    projectId: 'p1',
    state: 'done',
    lastActivity: 0,
    title: id,
    type: 'claude',
    worktreeId: null,
    ...overrides,
  } as TerminalSession
}

describe('getMountedChats', () => {
  test('keeps chats of every project mounted, in store order, excluding shells', () => {
    const terminals = {
      a: term('a', { projectId: 'p1' }),
      b: term('b', { projectId: 'p2', worktreeId: 'w1' }),
      shell: term('shell', { type: 'normal' }),
      side: term('side', { projectId: 'p2' }),
      c: term('c', { projectId: 'p1' }),
    }
    const ids = getMountedChats(terminals, { ctx: ['side'] }).map((t) => t.id)
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

describe('getViewportActiveTerminalId', () => {
  const terminals = { a: term('a', { projectId: 'p1' }), b: term('b', { projectId: 'p2' }) }

  test('the active chat of the active project is active', () => {
    expect(getViewportActiveTerminalId(terminals, 'a', 'p1', true)).toBe('a')
  })

  test('nothing is active behind an overview', () => {
    expect(getViewportActiveTerminalId(terminals, 'a', 'p1', false)).toBeNull()
  })

  test('a chat of a non-active project is not active', () => {
    expect(getViewportActiveTerminalId(terminals, 'b', 'p1', true)).toBeNull()
  })

  test('no active terminal or project → null', () => {
    expect(getViewportActiveTerminalId(terminals, null, 'p1', true)).toBeNull()
    expect(getViewportActiveTerminalId(terminals, 'a', null, true)).toBeNull()
    expect(getViewportActiveTerminalId(terminals, 'gone', 'p1', true)).toBeNull()
  })
})

describe('areChatsVisible', () => {
  const open = {
    automationsOverviewVisible: false,
    projectOverviewVisible: false,
    hasActiveProject: true,
    projectChatCount: 2,
  }

  test('an active project with chats and no overview shows its chats', () => {
    expect(areChatsVisible(open)).toBe(true)
  })

  test('the automations overview, welcome screen or project overview covers them', () => {
    expect(areChatsVisible({ ...open, automationsOverviewVisible: true })).toBe(false)
    expect(areChatsVisible({ ...open, hasActiveProject: false })).toBe(false)
    expect(areChatsVisible({ ...open, projectOverviewVisible: true })).toBe(false)
    expect(areChatsVisible({ ...open, projectChatCount: 0 })).toBe(false)
  })
})

describe('getCloseHotkeyDecision', () => {
  const terminals = {
    run: term('run', { state: 'busy' }),
    idle: term('idle', { state: 'done' }),
    dead: term('dead', { state: 'stopped' }),
    other: term('other', { projectId: 'p2', state: 'stopped' }),
  }

  test('a running or idle chat on screen asks for confirmation', () => {
    expect(getCloseHotkeyDecision(terminals, 'run', 'p1', true)).toBe('confirm')
    expect(getCloseHotkeyDecision(terminals, 'idle', 'p1', true)).toBe('confirm')
  })

  test('a stopped chat on screen closes directly', () => {
    expect(getCloseHotkeyDecision(terminals, 'dead', 'p1', true)).toBe('close')
  })

  test('a chat behind an overlay is ignored, even when stopped', () => {
    expect(getCloseHotkeyDecision(terminals, 'run', 'p1', false)).toBe('ignore')
    expect(getCloseHotkeyDecision(terminals, 'dead', 'p1', false)).toBe('ignore')
  })

  test('no on-screen chat → ignore', () => {
    expect(getCloseHotkeyDecision(terminals, null, 'p1', true)).toBe('ignore')
    expect(getCloseHotkeyDecision(terminals, 'run', null, true)).toBe('ignore')
    expect(getCloseHotkeyDecision(terminals, 'other', 'p1', true)).toBe('ignore')
    expect(getCloseHotkeyDecision(terminals, 'gone', 'p1', true)).toBe('ignore')
  })
})
