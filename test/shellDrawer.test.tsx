// @vitest-environment jsdom

import { describe, test, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Project, ProjectType, TerminalSession } from '../src/types'

// SidecarTerminalPanel mounts xterm (heavy/unsupported under jsdom). Stub it so
// these tests exercise only the ShellDrawer render gate, not terminal rendering.
vi.mock('../src/components/FileExplorer/SidecarTerminalPanel', () => ({
  SidecarTerminalPanel: () => <div data-testid="sidecar-panel" />,
}))

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
import { ShellDrawer } from '../src/components/Layout/ShellDrawer'

function makeProject(type: ProjectType): Project {
  return { id: 'p1', name: 'Folder', path: '/folder', type, createdAt: 0, sortOrder: 0, pinned: false }
}

function makeShell(): TerminalSession {
  return {
    id: 't1',
    projectId: 'p1',
    worktreeId: null,
    state: 'done',
    lastActivity: 0,
    title: 'Terminal',
    type: 'normal',
  }
}

function seed({
  type,
  hasShell,
  collapsed = false,
}: {
  type: ProjectType
  hasShell: boolean
  collapsed?: boolean
}) {
  useProjectStore.setState({
    projects: [makeProject(type)],
    activeProjectId: 'p1',
    activeTerminalId: null,
    terminals: hasShell ? { t1: makeShell() } : {},
    worktrees: {},
    sidecarTerminals: hasShell ? { p1: ['t1'] } : {},
    activeSidecarTerminalId: hasShell ? { p1: 't1' } : {},
    sidecarTerminalCollapsed: collapsed,
  })
}

describe('ShellDrawer render gate', () => {
  afterEach(() => {
    cleanup()
  })

  // R1 + regression for re-introducing the limited-project guard.
  test('renders the shell panel for a Project-type (limited) folder with an active shell', () => {
    seed({ type: 'project', hasShell: true })
    render(<ShellDrawer />)
    expect(screen.queryByTestId('sidecar-panel')).not.toBeNull()
  })

  test('still renders for a Code-type project (no regression)', () => {
    seed({ type: 'code', hasShell: true })
    render(<ShellDrawer />)
    expect(screen.queryByTestId('sidecar-panel')).not.toBeNull()
  })

  test('renders nothing for a Project-type folder with no shells', () => {
    seed({ type: 'project', hasShell: false })
    render(<ShellDrawer />)
    expect(screen.queryByTestId('sidecar-panel')).toBeNull()
  })

  test('renders nothing when the drawer is collapsed', () => {
    seed({ type: 'project', hasShell: true, collapsed: true })
    render(<ShellDrawer />)
    expect(screen.queryByTestId('sidecar-panel')).toBeNull()
  })
})
