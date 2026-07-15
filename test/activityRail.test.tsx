// @vitest-environment jsdom

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

// The rail reads many store selectors. Mock the store with a controllable
// fake-state object (selectors run against it) so the badge + git-gating logic
// is tested in isolation.
const { fakeState } = vi.hoisted(() => {
  const state = {
    fileExplorerVisible: false,
    fileExplorerActiveTab: 'files' as 'files' | 'git' | 'tasks',
    setFileExplorerActiveTab: () => {},
    setFileExplorerVisible: () => {},
    activeProjectId: 'proj-1' as string | null,
    activeTerminalId: null as string | null,
    projects: [] as Array<{ id: string; type: string }>,
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
  }
  return { fakeState: state }
})

vi.mock('../src/stores/projectStore', () => ({
  useProjectStore: (selector: (s: typeof fakeState) => unknown) => selector(fakeState),
}))

import { ActivityRail } from '../src/components/Layout/ActivityRail'

function gitStatus(staged: number, modified: number, untracked: number, conflicted: number) {
  const arr = (n: number) => Array.from({ length: n }, (_, i) => i)
  return {
    staged: arr(staged),
    modified: arr(modified),
    untracked: arr(untracked),
    conflicted: arr(conflicted),
  }
}

function resetState() {
  fakeState.fileExplorerVisible = false
  fakeState.fileExplorerActiveTab = 'files'
  fakeState.activeProjectId = 'proj-1'
  fakeState.activeTerminalId = null
  fakeState.projects = []
  fakeState.gitStatus = {}
  fakeState.tasksData = {}
}

beforeEach(resetState)
afterEach(() => cleanup())

describe('ActivityRail badges', () => {
  test('no counts: no numeric badge on any panel icon', () => {
    render(<ActivityRail />)
    for (const label of ['Files', 'Git', 'Tasks']) {
      expect(within(screen.getByTitle(label)).queryByText(/^\d+$/)).toBeNull()
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

  test('automations is no longer a rail entry (moved to the sidebar)', () => {
    render(<ActivityRail />)
    expect(screen.queryByTitle('Automations')).toBeNull()
  })

  test('non-limited project keeps the git badge', () => {
    fakeState.projects = [{ id: 'proj-1', type: 'code' }]
    fakeState.gitStatus = { 'proj-1': gitStatus(2, 1, 0, 0) }
    render(<ActivityRail />)
    expect(within(screen.getByTitle('Git')).getByText('3')).toBeTruthy()
  })

  test('files icon is never badged, even with git/task activity', () => {
    fakeState.gitStatus = { 'proj-1': gitStatus(4, 0, 0, 0) }
    fakeState.tasksData = { 'proj-1': { nowCount: 5 } }
    render(<ActivityRail />)
    expect(screen.getByTitle('Files').textContent).toBe('')
  })
})

describe('ActivityRail git entry gating', () => {
  // Limited ('project'-type) folders have no git tab; since the rail is the only
  // place tab switching lives, the Git entry is hidden entirely for them (which
  // supersedes the old "show the icon, suppress its badge" behavior).
  test('hides the Git entry for a Project-type (limited) folder', () => {
    fakeState.projects = [{ id: 'proj-1', type: 'project' }]
    fakeState.gitStatus = { 'proj-1': gitStatus(3, 0, 0, 0) }
    render(<ActivityRail />)
    expect(screen.queryByTitle('Git')).toBeNull()
    // The other rail entries remain.
    expect(screen.queryByTitle('Files')).not.toBeNull()
    expect(screen.queryByTitle('Tasks')).not.toBeNull()
  })

  test('shows the Git entry for a Code-type project', () => {
    fakeState.projects = [{ id: 'proj-1', type: 'code' }]
    render(<ActivityRail />)
    expect(screen.queryByTitle('Git')).not.toBeNull()
  })

  // No active project → type is undefined (not 'project'), so the list is
  // unfiltered. This is unchanged from pre-fix behavior; pin it.
  test('renders the unfiltered rail when there is no active project', () => {
    fakeState.activeProjectId = null
    fakeState.projects = []
    render(<ActivityRail />)
    expect(screen.queryByTitle('Files')).not.toBeNull()
    expect(screen.queryByTitle('Git')).not.toBeNull()
  })
})
