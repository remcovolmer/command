// @vitest-environment jsdom

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Automation, Project, Worktree } from '../src/types'

// Bypass persist middleware (no localStorage, no onRehydrateStorage side effects)
// — same pattern as fileExplorerGitGating.test.tsx.
vi.mock('zustand/middleware', () => ({
  persist: (fn: unknown) => fn,
}))

// Controllable electron API mock. Reset per test in beforeEach.
const api = {
  terminal: { create: vi.fn() },
  worktree: { create: vi.fn(), remove: vi.fn() },
  automation: { recordLaunch: vi.fn() },
  notification: { show: vi.fn() },
}
vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => api,
}))

import { useProjectStore } from '../src/stores/projectStore'
import { useLaunchAutomation } from '../src/hooks/useLaunchAutomation'

function makeProject(type: 'code' | 'project'): Project {
  return { id: 'p1', name: 'Proj', path: '/p1', type, createdAt: 0, sortOrder: 0, pinned: false }
}

function makeAutomation(over: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    name: 'Daily review',
    prompt: 'review the code',
    projectId: 'p1',
    defaultTarget: 'chat',
    trigger: { type: 'schedule', cron: '0 9 * * *' },
    enabled: true,
    timeoutMinutes: 30,
    createdAt: 't',
    updatedAt: 't',
    ...over,
  }
}

function seed(projectType: 'code' | 'project') {
  useProjectStore.setState({
    projects: [makeProject(projectType)],
    terminals: {},
    worktrees: {},
    activeProjectId: 'p1',
    activeTerminalId: 'term-existing',
    automationsOverviewVisible: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.terminal.create.mockResolvedValue('new-term-id')
  api.worktree.remove.mockResolvedValue(undefined)
  api.automation.recordLaunch.mockResolvedValue(null)
  const wt: Worktree = {
    id: 'wt1',
    projectId: 'p1',
    name: 'daily-review-abc',
    branch: 'automation/daily-review-abc',
    path: '/p1/.worktrees/daily-review-abc',
    createdAt: 0,
    isLocked: false,
  }
  api.worktree.create.mockResolvedValue(wt)
})

describe('useLaunchAutomation — focus-neutral launch (R21)', () => {
  test('chat launch does NOT change the active project/terminal and tags origin', async () => {
    seed('code')
    const { result } = renderHook(() => useLaunchAutomation())

    await act(async () => {
      await result.current.launch(makeAutomation({ defaultTarget: 'chat' }))
    })

    const state = useProjectStore.getState()
    // Focus is untouched — the headline invariant.
    expect(state.activeProjectId).toBe('p1')
    expect(state.activeTerminalId).toBe('term-existing')
    // The spawned chat is registered, marked as automation-originated.
    expect(state.terminals['new-term-id']).toBeDefined()
    expect(state.terminals['new-term-id'].origin).toBe('automation')
    expect(state.terminals['new-term-id'].worktreeId).toBeNull()
    // Prompt passed as the initialPrompt positional arg; no worktree for chat target.
    expect(api.terminal.create).toHaveBeenCalledWith(
      'p1',
      undefined,
      'claude',
      undefined,
      'review the code'
    )
    expect(api.worktree.create).not.toHaveBeenCalled()
    // Logged into run history.
    expect(api.automation.recordLaunch).toHaveBeenCalledWith('a1', {
      terminalId: 'new-term-id',
      worktreeBranch: undefined,
    })
  })

  test('per-launch override to worktree wins over the stored default', async () => {
    seed('code')
    const { result } = renderHook(() => useLaunchAutomation())

    await act(async () => {
      await result.current.launch(makeAutomation({ defaultTarget: 'chat' }), 'worktree')
    })

    const state = useProjectStore.getState()
    expect(api.worktree.create).toHaveBeenCalledTimes(1)
    expect(state.worktrees['wt1']).toBeDefined()
    // Chat created inside the new worktree; focus still unchanged.
    expect(api.terminal.create).toHaveBeenCalledWith(
      'p1',
      'wt1',
      'claude',
      undefined,
      'review the code'
    )
    expect(state.activeProjectId).toBe('p1')
    expect(state.activeTerminalId).toBe('term-existing')
  })
})

describe('useLaunchAutomation — guards', () => {
  test('worktree launch on a non-Git (Project-type) project is rejected before spawning', async () => {
    seed('project') // non-code → no Git repo
    const { result } = renderHook(() => useLaunchAutomation())

    let returned: string | null = 'sentinel'
    await act(async () => {
      returned = await result.current.launch(makeAutomation({ defaultTarget: 'worktree' }))
    })

    expect(returned).toBeNull()
    expect(api.notification.show).toHaveBeenCalledTimes(1)
    expect(api.worktree.create).not.toHaveBeenCalled()
    expect(api.terminal.create).not.toHaveBeenCalled()
  })

  test('a failed chat spawn after worktree creation removes the orphaned worktree', async () => {
    seed('code')
    api.terminal.create.mockResolvedValue(null) // spawn failed
    const { result } = renderHook(() => useLaunchAutomation())

    await act(async () => {
      await result.current.launch(makeAutomation({ defaultTarget: 'worktree' }))
    })

    // The worktree we created must not be left orphaned.
    expect(api.worktree.remove).toHaveBeenCalledWith('wt1', false)
    expect(useProjectStore.getState().worktrees['wt1']).toBeUndefined()
  })
})
