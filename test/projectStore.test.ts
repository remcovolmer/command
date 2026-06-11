import { describe, test, expect, vi, beforeEach } from 'vitest'

// Captures the partialize option passed to persist so the persist contract is testable
const persistCapture = vi.hoisted(() => ({
  partialize: undefined as
    | ((state: Record<string, unknown>) => Record<string, unknown>)
    | undefined,
}))

// Mock zustand persist middleware to bypass localStorage
vi.mock('zustand/middleware', () => ({
  persist: (
    fn: unknown,
    options?: { partialize?: (state: Record<string, unknown>) => Record<string, unknown> }
  ) => {
    persistCapture.partialize = options?.partialize
    return fn
  },
}))

// Mock electron API before importing store
vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({
    terminal: { create: vi.fn(), close: vi.fn() },
    project: {
      list: vi.fn(),
      update: vi.fn(),
      reorder: vi.fn(),
      setActiveWatcher: vi.fn().mockResolvedValue(undefined),
    },
    worktree: { list: vi.fn() },
    fs: { readDirectory: vi.fn() },
  }),
}))

import { useProjectStore } from '../src/stores/projectStore'
import { DEFAULT_HOTKEY_CONFIG, mergeMissingHotkeyDefaults } from '../src/utils/hotkeys'
import type { HotkeyAction, HotkeyConfig } from '../src/types/hotkeys'
import type { TerminalSession } from '../src/types'

function makeTerminal(
  overrides: Partial<TerminalSession> & { id: string; projectId: string }
): TerminalSession {
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
      collapsedProjects: {},
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

  describe('updateTerminalWorktree', () => {
    test('updates worktreeId from null to a valid worktreeId', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1', worktreeId: null })

      useProjectStore.setState({
        terminals: { 'term-1': t1 },
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().updateTerminalWorktree('term-1', 'wt-1')

      const state = useProjectStore.getState()
      expect(state.terminals['term-1'].worktreeId).toBe('wt-1')
    })

    test('does nothing for non-existent terminal', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1 },
      })

      useProjectStore.getState().updateTerminalWorktree('non-existent', 'wt-1')

      const state = useProjectStore.getState()
      // Original terminal unchanged
      expect(state.terminals['term-1'].worktreeId).toBeNull()
      expect(state.terminals['non-existent']).toBeUndefined()
    })

    test('overwrites existing worktreeId', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1', worktreeId: 'wt-old' })

      useProjectStore.setState({
        terminals: { 'term-1': t1 },
      })

      useProjectStore.getState().updateTerminalWorktree('term-1', 'wt-new')

      const state = useProjectStore.getState()
      expect(state.terminals['term-1'].worktreeId).toBe('wt-new')
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
        worktrees: {
          'wt-1': {
            id: 'wt-1',
            projectId: 'proj-1',
            name: 'feature',
            path: '/wt1',
            branch: 'feature',
          },
        },
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
        worktrees: {
          'wt-1': {
            id: 'wt-1',
            projectId: 'proj-1',
            name: 'feature',
            path: '/wt1',
            branch: 'feature',
          },
        },
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
        worktrees: {
          'wt-1': {
            id: 'wt-1',
            projectId: 'proj-1',
            name: 'feature',
            path: '/wt1',
            branch: 'feature',
          },
        },
      })

      useProjectStore.getState().removeWorktree('wt-1')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBeNull()
      expect(state.activeCenterTabId).toBeNull()
    })
  })

  describe('collapsedProjects', () => {
    test('toggleProjectCollapsed adds the entry, second call removes it', () => {
      useProjectStore.getState().toggleProjectCollapsed('proj-1')
      expect(useProjectStore.getState().collapsedProjects['proj-1']).toBe(true)

      useProjectStore.getState().toggleProjectCollapsed('proj-1')
      expect(useProjectStore.getState().collapsedProjects['proj-1']).toBeUndefined()
    })

    test('toggleProjectCollapsed is a no-op for workspace projects', () => {
      useProjectStore.setState({
        projects: [{ id: 'ws-1', name: 'Workspace', path: '/ws1', type: 'workspace' }],
      })

      useProjectStore.getState().toggleProjectCollapsed('ws-1')

      // Workspaces render without a collapse affordance; no dead state written
      expect(useProjectStore.getState().collapsedProjects['ws-1']).toBeUndefined()
    })

    test('toggleProjectCollapsed leaves other entries untouched', () => {
      useProjectStore.setState({ collapsedProjects: { 'proj-2': true } })

      useProjectStore.getState().toggleProjectCollapsed('proj-1')

      const state = useProjectStore.getState()
      expect(state.collapsedProjects['proj-1']).toBe(true)
      expect(state.collapsedProjects['proj-2']).toBe(true)
    })

    test('setActiveProject auto-expands the target project in the same update', () => {
      useProjectStore.setState({ collapsedProjects: { 'proj-1': true, 'proj-2': true } })

      useProjectStore.getState().setActiveProject('proj-1')

      const state = useProjectStore.getState()
      expect(state.activeProjectId).toBe('proj-1')
      expect(state.collapsedProjects['proj-1']).toBeUndefined()
      // Other collapsed projects stay collapsed
      expect(state.collapsedProjects['proj-2']).toBe(true)
    })

    test('removeProject cleans up the collapsedProjects entry', () => {
      useProjectStore.setState({
        projects: [
          { id: 'proj-1', name: 'Project 1', path: '/proj1' },
          { id: 'proj-2', name: 'Project 2', path: '/proj2' },
        ],
        collapsedProjects: { 'proj-1': true, 'proj-2': true },
      })

      useProjectStore.getState().removeProject('proj-1')

      const state = useProjectStore.getState()
      expect(state.collapsedProjects['proj-1']).toBeUndefined()
      expect(state.collapsedProjects['proj-2']).toBe(true)
    })

    test('partialize persists collapsedProjects', () => {
      useProjectStore.setState({ collapsedProjects: { 'proj-1': true } })

      expect(persistCapture.partialize).toBeDefined()
      const persisted = persistCapture.partialize!(
        useProjectStore.getState() as unknown as Record<string, unknown>
      )
      expect(persisted.collapsedProjects).toEqual({ 'proj-1': true })
    })
  })

  describe('hotkey config backfill (mergeMissingHotkeyDefaults)', () => {
    // The persist middleware is mocked, so onRehydrateStorage never runs here;
    // the backfill is a pure helper tested directly (onRehydrateStorage calls it).
    test('adds missing actions with their default binding', () => {
      const { 'sidebar.toggleProjectCollapse': _omitted, ...rest } = DEFAULT_HOTKEY_CONFIG
      const persisted = rest as HotkeyConfig

      const merged = mergeMissingHotkeyDefaults(persisted)

      expect(merged['sidebar.toggleProjectCollapse']).toEqual(
        DEFAULT_HOTKEY_CONFIG['sidebar.toggleProjectCollapse']
      )
      // Every default action is present after the merge
      for (const action of Object.keys(DEFAULT_HOTKEY_CONFIG) as HotkeyAction[]) {
        expect(merged[action]).toBeDefined()
      }
    })

    test('leaves existing user customizations untouched', () => {
      const customized: HotkeyConfig = {
        ...DEFAULT_HOTKEY_CONFIG,
        'terminal.new': {
          ...DEFAULT_HOTKEY_CONFIG['terminal.new'],
          key: 'y',
          modifiers: ['ctrl', 'alt'],
        },
      }
      const { 'sidebar.toggleProjectCollapse': _omitted, ...rest } = customized
      const persisted = rest as HotkeyConfig

      const merged = mergeMissingHotkeyDefaults(persisted)

      expect(merged['terminal.new'].key).toBe('y')
      expect(merged['terminal.new'].modifiers).toEqual(['ctrl', 'alt'])
    })

    test('returns the same reference when nothing is missing', () => {
      expect(mergeMissingHotkeyDefaults(DEFAULT_HOTKEY_CONFIG)).toBe(DEFAULT_HOTKEY_CONFIG)
    })
  })

  describe('PR status', () => {
    test('markPRStatusStale preserves prior fields and only flips stale/error/lastUpdated', () => {
      const prior = {
        noPR: false,
        number: 42,
        title: 'feat: cool thing',
        url: 'https://example.test/pr/42',
        state: 'OPEN' as const,
        mergeable: 'MERGEABLE' as const,
        statusCheckRollup: [{ name: 'ci', state: 'SUCCESS', bucket: 'pass' }],
        additions: 100,
        deletions: 20,
        lastUpdated: 1_000,
      }
      useProjectStore.setState({ prStatus: { 'wt-1': prior } })

      useProjectStore.getState().markPRStatusStale('wt-1', 'network timeout')

      const updated = useProjectStore.getState().prStatus['wt-1']
      expect(updated.stale).toBe(true)
      expect(updated.error).toBe('network timeout')
      expect(updated.lastUpdated).toBeGreaterThan(prior.lastUpdated)
      expect(updated.number).toBe(42)
      expect(updated.title).toBe(prior.title)
      expect(updated.url).toBe(prior.url)
      expect(updated.state).toBe('OPEN')
      expect(updated.mergeable).toBe('MERGEABLE')
      expect(updated.statusCheckRollup).toEqual(prior.statusCheckRollup)
      expect(updated.additions).toBe(100)
      expect(updated.deletions).toBe(20)
      expect(updated.noPR).toBe(false)
    })

    test('markPRStatusStale is a no-op when no prior PR status exists', () => {
      useProjectStore.setState({ prStatus: {} })

      useProjectStore.getState().markPRStatusStale('wt-unknown', 'whatever')

      expect(useProjectStore.getState().prStatus['wt-unknown']).toBeUndefined()
    })

    test('a fresh setPRStatus clears stale/error from prior state', () => {
      useProjectStore.setState({
        prStatus: {
          'wt-1': {
            noPR: false,
            number: 1,
            state: 'OPEN',
            stale: true,
            error: 'prev error',
            lastUpdated: 0,
          },
        },
      })

      useProjectStore.getState().setPRStatus('wt-1', {
        noPR: false,
        number: 1,
        state: 'OPEN',
        lastUpdated: 5_000,
      })

      const updated = useProjectStore.getState().prStatus['wt-1']
      expect(updated.stale).toBeUndefined()
      expect(updated.error).toBeUndefined()
    })
  })
})
