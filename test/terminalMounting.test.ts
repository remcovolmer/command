import { describe, test, expect } from 'vitest'
import { getMountedChats, getViewportActiveTerminalId } from '../src/utils/terminalMounting'
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
