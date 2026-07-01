// @vitest-environment jsdom

import { describe, test, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Project, ProjectType } from '../src/types'

// Bypass persist middleware (no localStorage) — same pattern as projectStore.test.ts.
vi.mock('zustand/middleware', () => ({
  persist: (fn: unknown) => fn,
}))

// FileExplorer fires git/automation IPC and watcher subscriptions on mount.
// Stub them so the mount is inert and the test exercises only the git-gating branch.
vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({
    git: {
      getStatus: vi.fn().mockResolvedValue(null),
      getHeadHash: vi.fn().mockResolvedValue(null),
      getCommitLog: vi.fn().mockResolvedValue(null),
    },
    automation: {
      listRuns: vi.fn().mockResolvedValue([]),
      onRunCompleted: vi.fn(() => () => {}),
      onRunFailed: vi.fn(() => () => {}),
    },
    tasks: { scan: vi.fn().mockResolvedValue(null) },
  }),
}))

vi.mock('../src/utils/fileWatcherEvents', () => ({
  fileWatcherEvents: {
    subscribe: vi.fn(),
    subscribeError: vi.fn(),
    unsubscribe: vi.fn(),
  },
}))

// Stub the heavy panels so this test isolates the git-gating decision, not their
// internals (xterm, Monaco, git data, etc.).
vi.mock('../src/components/FileExplorer/FileTree', () => ({
  FileTree: () => <div data-testid="file-tree" />,
}))
vi.mock('../src/components/FileExplorer/GitStatusPanel', () => ({
  GitStatusPanel: () => <div data-testid="git-panel" />,
}))
vi.mock('../src/components/FileExplorer/TasksPanel', () => ({
  TasksPanel: () => <div data-testid="tasks-panel" />,
}))
vi.mock('../src/components/FileExplorer/AutomationsPanel', () => ({
  AutomationsPanel: () => <div data-testid="automations-panel" />,
}))
vi.mock('../src/components/FileExplorer/SessionsPanel', () => ({
  SessionsPanel: () => <div data-testid="sessions-panel" />,
}))
vi.mock('../src/components/FileExplorer/AutomationCreateDialog', () => ({
  AutomationCreateDialog: () => null,
}))
vi.mock('../src/components/FileExplorer/DeleteConfirmDialog', () => ({
  DeleteConfirmDialog: () => null,
}))
vi.mock('../src/components/FileExplorer/FileExplorerHeader', () => ({
  FileExplorerHeader: () => <div data-testid="explorer-header" />,
}))

import { useProjectStore } from '../src/stores/projectStore'
import { FileExplorer } from '../src/components/FileExplorer/FileExplorer'

function makeProject(type: ProjectType): Project {
  return { id: 'p1', name: 'Folder', path: '/folder', type, createdAt: 0, sortOrder: 0, pinned: false }
}

// Seed with the git tab explicitly active, so the only thing deciding whether git
// content renders is the project-type gate.
function seed(type: ProjectType) {
  useProjectStore.setState({
    projects: [makeProject(type)],
    activeProjectId: 'p1',
    activeTerminalId: null,
    terminals: {},
    worktrees: {},
    fileExplorerActiveTab: 'git',
    fileExplorerDeletingEntry: null,
    gitStatus: {},
    gitStatusLoading: {},
    gitHeadHash: {},
    tasksData: {},
  })
}

describe('FileExplorer git gating for project-type folders', () => {
  afterEach(() => {
    cleanup()
  })

  // R4: git stays off for non-coding folders even when the git tab is the active tab.
  test('Project-type folder with the git tab active shows files, not git content', async () => {
    seed('project')
    render(<FileExplorer />)
    await waitFor(() => expect(screen.getByTestId('file-tree')).toBeTruthy())
    expect(screen.queryByTestId('git-panel')).toBeNull()
  })

  // Regression: Code-type folders still show git content and offer the git tab.
  test('Code-type folder with the git tab active shows git content', async () => {
    seed('code')
    render(<FileExplorer />)
    await waitFor(() => expect(screen.getByTestId('git-panel')).toBeTruthy())
    expect(screen.queryByTestId('file-tree')).toBeNull()
  })
})
