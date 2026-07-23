import { describe, test, expect } from 'vitest'
import { deriveNotchSessions } from '@/utils/notchFeed'
import type { Project, TerminalSession } from '@/types'

function term(over: Partial<TerminalSession>): TerminalSession {
  return {
    id: 'x',
    projectId: 'p1',
    worktreeId: null,
    state: 'busy',
    lastActivity: 0,
    title: 't',
    type: 'claude',
    ...over,
  }
}

const projects = [
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
] as Project[]

describe('deriveNotchSessions', () => {
  test('maps agent sessions across projects and worktrees, resolving project names', () => {
    const terminals = {
      a: term({ id: 'a', projectId: 'p1', type: 'claude', state: 'permission', title: 'Trace events' }),
      b: term({ id: 'b', projectId: 'p2', type: 'codex', state: 'done', worktreeId: 'wt1' }),
    }
    const out = deriveNotchSessions(terminals, projects)
    expect(out).toHaveLength(2)
    expect(out.find((s) => s.id === 'a')).toMatchObject({
      projectName: 'Alpha',
      agentType: 'claude',
      state: 'permission',
      title: 'Trace events',
    })
    expect(out.find((s) => s.id === 'b')).toMatchObject({
      projectName: 'Beta',
      agentType: 'codex',
      state: 'done',
    })
  })

  test('excludes plain normal shells', () => {
    const terminals = {
      a: term({ id: 'a', type: 'normal' }),
      b: term({ id: 'b', type: 'claude' }),
    }
    expect(deriveNotchSessions(terminals, projects).map((s) => s.id)).toEqual(['b'])
  })

  test('includes stopped agents (the notch surfaces stopped, unlike isVisibleState)', () => {
    const terminals = { a: term({ id: 'a', type: 'claude', state: 'stopped' }) }
    expect(deriveNotchSessions(terminals, projects)).toHaveLength(1)
  })

  test('prefers generatedTitle, falls back to title then Untitled; unknown project resolves to Unknown', () => {
    const terminals = {
      a: term({ id: 'a', projectId: 'zzz', generatedTitle: 'Gen', title: 'Raw' }),
      b: term({ id: 'b', title: '', generatedTitle: undefined }),
    }
    const out = deriveNotchSessions(terminals, projects)
    expect(out.find((s) => s.id === 'a')).toMatchObject({ title: 'Gen', projectName: 'Unknown' })
    expect(out.find((s) => s.id === 'b')?.title).toBe('Untitled')
  })
})
