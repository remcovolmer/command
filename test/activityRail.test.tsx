// @vitest-environment jsdom

import { describe, test, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Project, ProjectType } from '../src/types'

// Bypass persist middleware (no localStorage) — same pattern as projectStore.test.ts.
vi.mock('zustand/middleware', () => ({
  persist: (fn: unknown) => fn,
}))

// Store actions call getElectronAPI lazily; stub so nothing hits window.electronAPI.
vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({
    terminal: { create: vi.fn(), close: vi.fn() },
  }),
}))

import { useProjectStore } from '../src/stores/projectStore'
import { ActivityRail } from '../src/components/Layout/ActivityRail'

function makeProject(type: ProjectType): Project {
  return { id: 'p1', name: 'Folder', path: '/folder', type, createdAt: 0, sortOrder: 0, pinned: false }
}

function seed(type: ProjectType | null) {
  useProjectStore.setState({
    projects: type ? [makeProject(type)] : [],
    activeProjectId: type ? 'p1' : null,
    activeTerminalId: null,
    terminals: {},
    worktrees: {},
    sidecarTerminals: {},
    sidecarTerminalCollapsed: false,
    fileExplorerVisible: false,
    fileExplorerActiveTab: 'files',
  })
}

describe('ActivityRail git entry gating', () => {
  afterEach(() => {
    cleanup()
  })

  // R3: limited folders get no git tab, so the rail must not offer a git entry.
  test('hides the Git entry for a Project-type (limited) folder', () => {
    seed('project')
    render(<ActivityRail />)
    expect(screen.queryByTitle('Git')).toBeNull()
    // The other rail entries remain.
    expect(screen.queryByTitle('Files')).not.toBeNull()
    expect(screen.queryByTitle('Tasks')).not.toBeNull()
    expect(screen.queryByTitle('Automations')).not.toBeNull()
  })

  // R4 / regression: code projects keep the git entry.
  test('shows the Git entry for a Code-type project', () => {
    seed('code')
    render(<ActivityRail />)
    expect(screen.queryByTitle('Git')).not.toBeNull()
  })

  // No active project → type is undefined (not 'project'), so the list is
  // unfiltered. This is unchanged from pre-fix behavior; pin it.
  test('renders the unfiltered rail when there is no active project', () => {
    seed(null)
    render(<ActivityRail />)
    expect(screen.queryByTitle('Files')).not.toBeNull()
    expect(screen.queryByTitle('Git')).not.toBeNull()
  })
})
