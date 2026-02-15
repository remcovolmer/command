import { describe, test, expect, vi, beforeEach } from 'vitest'

// Mock zustand persist middleware to bypass localStorage
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
}))

// Mock electron API before importing store
vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({
    terminal: { create: vi.fn(), close: vi.fn() },
    project: { list: vi.fn(), update: vi.fn(), reorder: vi.fn() },
    worktree: { list: vi.fn() },
    fs: { readDirectory: vi.fn() },
  }),
}))

import { useProjectStore } from '../src/stores/projectStore'
import type { TerminalSession } from '../src/types'

function makeTerminal(overrides: Partial<TerminalSession> & { id: string; projectId: string }): TerminalSession {
  return {
    state: 'done',
    lastActivity: Date.now(),
    title: 'Chat',
    type: 'claude',
    worktreeId: null,
    ...overrides,
  }
}

describe('projectStore activeCenterTabId', () => {
  beforeEach(() => {
    // Reset store to clean state
    useProjectStore.setState({
      terminals: {},
      activeTerminalId: null,
      activeCenterTabId: null,
      activeProjectId: null,
      projects: [],
      layouts: {},
      sidecarTerminals: {},
      activeSidecarTerminalId: {},
      worktrees: {},
      editorTabs: {},
    })
  })

  describe('getProjectTerminals', () => {
    test('excludes sidecar and normal terminals', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const sidecar = makeTerminal({ id: 'sidecar-1', projectId: 'proj-1', type: 'normal' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'sidecar-1': sidecar, 'term-2': t2 },
        sidecarTerminals: { 'proj-1': ['sidecar-1'] },
      })

      const result = useProjectStore.getState().getProjectTerminals('proj-1')
      const ids = result.map((t) => t.id)
      expect(ids).toContain('term-1')
      expect(ids).toContain('term-2')
      expect(ids).not.toContain('sidecar-1')
    })
  })

  describe('removeTerminal', () => {
    test('closing active terminal switches activeCenterTabId to next visible terminal', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'term-2': t2 },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().removeTerminal('term-1')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBe('term-2')
      expect(state.activeCenterTabId).toBe('term-2')
    })

    test('closing last terminal sets activeCenterTabId to null', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1 },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().removeTerminal('term-1')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBeNull()
      expect(state.activeCenterTabId).toBeNull()
    })

    test('closing non-active terminal does not change activeCenterTabId', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'term-2': t2 },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().removeTerminal('term-2')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBe('term-1')
      expect(state.activeCenterTabId).toBe('term-1')
    })

    test('does not fall back to sidecar terminal when closing active', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const sidecar = makeTerminal({ id: 'sidecar-1', projectId: 'proj-1', type: 'normal' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'sidecar-1': sidecar },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
        sidecarTerminals: { 'proj-1': ['sidecar-1'] },
      })

      useProjectStore.getState().removeTerminal('term-1')

      const state = useProjectStore.getState()
      // Should be null, NOT sidecar-1
      expect(state.activeTerminalId).toBeNull()
      expect(state.activeCenterTabId).toBeNull()
    })

    test('does not change activeCenterTabId when editor tab is active and non-center terminal is closed', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'term-2': t2 },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'editor-tab-1', // editor tab is active
        activeProjectId: 'proj-1',
        editorTabs: {
          'editor-tab-1': {
            id: 'editor-tab-1',
            type: 'editor',
            filePath: '/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            projectId: 'proj-1',
          },
        },
      })

      useProjectStore.getState().removeTerminal('term-2')

      const state = useProjectStore.getState()
      expect(state.activeCenterTabId).toBe('editor-tab-1')
      expect(state.activeTerminalId).toBe('term-1')
    })
  })

  describe('setActiveProject', () => {
    test('switches to first visible terminal of new project', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-2' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'term-2': t2 },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().setActiveProject('proj-2')

      const state = useProjectStore.getState()
      expect(state.activeProjectId).toBe('proj-2')
      expect(state.activeTerminalId).toBe('term-2')
      expect(state.activeCenterTabId).toBe('term-2')
    })

    test('does not select sidecar terminal when switching project', () => {
      const sidecar = makeTerminal({ id: 'sidecar-1', projectId: 'proj-2', type: 'normal' })
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'sidecar-1': sidecar },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
        sidecarTerminals: { 'proj-2': ['sidecar-1'] },
      })

      useProjectStore.getState().setActiveProject('proj-2')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBeNull()
      expect(state.activeCenterTabId).toBeNull()
    })

    test('sets null when project has no terminals', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1 },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().setActiveProject('proj-2')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBeNull()
      expect(state.activeCenterTabId).toBeNull()
    })
  })

  describe('removeProject', () => {
    test('updates activeCenterTabId when active project is removed', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1 },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
        projects: [{ id: 'proj-1', name: 'Project 1', path: '/proj1' }],
      })

      useProjectStore.getState().removeProject('proj-1')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBeNull()
      expect(state.activeCenterTabId).toBeNull()
    })

    test('preserves activeCenterTabId when non-active project is removed', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-2' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'term-2': t2 },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
        projects: [
          { id: 'proj-1', name: 'Project 1', path: '/proj1' },
          { id: 'proj-2', name: 'Project 2', path: '/proj2' },
        ],
      })

      useProjectStore.getState().removeProject('proj-2')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBe('term-1')
      expect(state.activeCenterTabId).toBe('term-1')
      expect(state.activeProjectId).toBe('proj-1')
    })
  })

  describe('removeWorktree', () => {
    test('updates activeCenterTabId when worktree with active terminal is removed', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1', worktreeId: 'wt-1' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-1', worktreeId: null })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'term-2': t2 },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
        worktrees: { 'wt-1': { id: 'wt-1', projectId: 'proj-1', name: 'feature', path: '/wt1', branch: 'feature' } },
      })

      useProjectStore.getState().removeWorktree('wt-1')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBe('term-2')
      expect(state.activeCenterTabId).toBe('term-2')
      expect(state.terminals['term-1']).toBeUndefined()
    })

    test('preserves editor tab in activeCenterTabId when worktree is removed', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1', worktreeId: 'wt-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1 },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'editor-tab-1',
        activeProjectId: 'proj-1',
        editorTabs: {
          'editor-tab-1': {
            id: 'editor-tab-1',
            type: 'editor',
            filePath: '/test.ts',
            fileName: 'test.ts',
            isDirty: false,
            projectId: 'proj-1',
          },
        },
        worktrees: { 'wt-1': { id: 'wt-1', projectId: 'proj-1', name: 'feature', path: '/wt1', branch: 'feature' } },
      })

      useProjectStore.getState().removeWorktree('wt-1')

      const state = useProjectStore.getState()
      expect(state.activeCenterTabId).toBe('editor-tab-1')
      expect(state.activeTerminalId).toBeNull()
      expect(state.terminals['term-1']).toBeUndefined()
    })

    test('does not fall back to sidecar terminal when removing worktree', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1', worktreeId: 'wt-1' })
      const sidecar = makeTerminal({ id: 'sidecar-1', projectId: 'proj-1', type: 'normal' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'sidecar-1': sidecar },
        activeTerminalId: 'term-1',
        activeCenterTabId: 'term-1',
        activeProjectId: 'proj-1',
        sidecarTerminals: { 'proj-1': ['sidecar-1'] },
        worktrees: { 'wt-1': { id: 'wt-1', projectId: 'proj-1', name: 'feature', path: '/wt1', branch: 'feature' } },
      })

      useProjectStore.getState().removeWorktree('wt-1')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBeNull()
      expect(state.activeCenterTabId).toBeNull()
    })
  })
})
