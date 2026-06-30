// @vitest-environment jsdom

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

// The rail reads many store selectors and the automation-unread hook. Mock the
// store with a controllable fake-state object (selectors run against it) and the
// hook with a settable count, so the badge logic is tested in isolation.
const { fakeState, setAutomationCount } = vi.hoisted(() => {
  const state = {
    fileExplorerVisible: false,
    fileExplorerActiveTab: 'files' as 'files' | 'git' | 'tasks' | 'automations',
    setFileExplorerActiveTab: () => {},
    setFileExplorerVisible: () => {},
    activeProjectId: 'proj-1' as string | null,
    activeTerminalId: null as string | null,
    terminals: {} as Record<string, { worktreeId: string | null }>,
    worktrees: {} as Record<string, { id: string }>,
    sidecarTerminals: {} as Record<string, unknown[]>,
    sidecarTerminalCollapsed: true,
    toggleShellDrawer: () => {},
    openBrowserTab: () => {},
    gitStatus: {} as Record<
      string,
      { staged: unknown[]; modified: unknown[]; untracked: unknown[]; conflicted: unknown[] }
    >,
    tasksData: {} as Record<string, { nowCount: number }>,
    _automationCount: 0,
  }
  return {
    fakeState: state,
    setAutomationCount: (n: number) => {
      state._automationCount = n
    },
  }
})

vi.mock('../src/stores/projectStore', () => ({
  useProjectStore: (selector: (s: typeof fakeState) => unknown) => selector(fakeState),
}))

vi.mock('../src/hooks/useAutomationUnreadCount', () => ({
  useAutomationUnreadCount: () => fakeState._automationCount,
}))

import { ActivityRail } from '../src/components/Layout/ActivityRail'

function gitStatus(staged: number, modified: number, untracked: number, conflicted: number) {
  const arr = (n: number) => Array.from({ length: n }, (_, i) => i)
  return { staged: arr(staged), modified: arr(modified), untracked: arr(untracked), conflicted: arr(conflicted) }
}

describe('ActivityRail badges', () => {
  beforeEach(() => {
    fakeState.fileExplorerVisible = false
    fakeState.fileExplorerActiveTab = 'files'
    fakeState.activeProjectId = 'proj-1'
    fakeState.activeTerminalId = null
    fakeState.gitStatus = {}
    fakeState.tasksData = {}
    fakeState._automationCount = 0
  })
  afterEach(() => cleanup())

  test('no counts: no badge text on any panel icon', () => {
    render(<ActivityRail />)
    for (const label of ['Files', 'Git', 'Tasks', 'Automations']) {
      expect(screen.getByTitle(label).textContent).toBe('')
    }
  })

  test('git changes badge sums staged/modified/untracked/conflicted', () => {
    fakeState.gitStatus = { 'proj-1': gitStatus(2, 1, 0, 0) }
    render(<ActivityRail />)
    expect(within(screen.getByTitle('Git')).getByText('3')).toBeTruthy()
  })

  test('tasks badge shows nowCount', () => {
    fakeState.tasksData = { 'proj-1': { nowCount: 5 } }
    render(<ActivityRail />)
    expect(within(screen.getByTitle('Tasks')).getByText('5')).toBeTruthy()
  })

  test('automations badge shows the unread-hook count', () => {
    setAutomationCount(2)
    render(<ActivityRail />)
    expect(within(screen.getByTitle('Automations')).getByText('2')).toBeTruthy()
  })

  test('files icon is never badged, even with git/task/automation activity', () => {
    fakeState.gitStatus = { 'proj-1': gitStatus(4, 0, 0, 0) }
    fakeState.tasksData = { 'proj-1': { nowCount: 5 } }
    setAutomationCount(2)
    render(<ActivityRail />)
    expect(screen.getByTitle('Files').textContent).toBe('')
  })
})
