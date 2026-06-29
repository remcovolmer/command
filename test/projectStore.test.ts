import { describe, test, expect, vi, beforeEach } from 'vitest'

// Captures the partialize option passed to persist so the persist contract is testable
const persistCapture = vi.hoisted(() => ({
  partialize: undefined as
    | ((state: Record<string, unknown>) => Record<string, unknown>)
    | undefined,
}))

// Stable mock fns for the project IPC surface so pin tests can configure returns
// (the factory below would otherwise hand out fresh fns on every call).
const { mockProjectList, mockSetPinned } = vi.hoisted(() => ({
  mockProjectList: vi.fn(),
  mockSetPinned: vi.fn(),
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

// Hoisted spy so the usage side effect is inspectable across getElectronAPI calls
const { usageSetEnabledMock } = vi.hoisted(() => ({
  usageSetEnabledMock: vi.fn(() => Promise.resolve()),
}))

// Mock electron API before importing store
vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({
    terminal: { create: vi.fn(), close: vi.fn() },
    project: {
      list: mockProjectList,
      update: vi.fn(),
      reorder: vi.fn(),
      setPinned: mockSetPinned,
      setActiveWatcher: vi.fn().mockResolvedValue(undefined),
    },
    worktree: { list: vi.fn() },
    fs: { readDirectory: vi.fn() },
    usage: { setEnabled: usageSetEnabledMock, onUpdate: vi.fn() },
  }),
}))

import { useProjectStore } from '../src/stores/projectStore'
import { DEFAULT_HOTKEY_CONFIG, mergeMissingHotkeyDefaults } from '../src/utils/hotkeys'
import type { HotkeyAction, HotkeyConfig } from '../src/types/hotkeys'
import type { Project, TerminalSession } from '../src/types'

function makeProject(overrides: Partial<Project> & { id: string }): Project {
  return {
    name: 'Project',
    path: '/project',
    type: 'project',
    createdAt: 0,
    sortOrder: 0,
    pinned: false,
    ...overrides,
  }
}

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

describe('projectStore active terminal & content', () => {
  beforeEach(() => {
    // Reset store to clean state
    useProjectStore.setState({
      terminals: {},
      activeTerminalId: null,
      activeProjectId: null,
      projects: [],
      sidecarTerminals: {},
      activeSidecarTerminalId: {},
      worktrees: {},
      editorTabs: {},
      activeContentTabId: {},
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

  describe('per-chat content tabs', () => {
    test('openEditorTab scopes the tab to the active chat', () => {
      useProjectStore.setState({ activeTerminalId: 'chat-A' })
      useProjectStore.getState().openEditorTab('/p/a.ts', 'a.ts', 'proj-1')
      const s = useProjectStore.getState()
      const tab = Object.values(s.editorTabs)[0]
      expect(tab.terminalId).toBe('chat-A')
      expect(s.activeContentTabId['chat-A']).toBe(tab.id)
    })

    test('each chat keeps its own active content tab', () => {
      useProjectStore.setState({ activeTerminalId: 'chat-A' })
      useProjectStore.getState().openEditorTab('/p/a.ts', 'a.ts', 'proj-1')
      const aTabId = useProjectStore.getState().activeContentTabId['chat-A']

      useProjectStore.setState({ activeTerminalId: 'chat-B' })
      useProjectStore.getState().openEditorTab('/p/b.ts', 'b.ts', 'proj-1')

      const s = useProjectStore.getState()
      expect(s.activeContentTabId['chat-A']).toBe(aTabId)
      expect(s.activeContentTabId['chat-B']).not.toBe(aTabId)
      const bTab = Object.values(s.editorTabs).find((t) => t.id === s.activeContentTabId['chat-B'])
      expect(bTab?.terminalId).toBe('chat-B')
    })

    test('closeEditorTab falls back within the same chat, then to null', () => {
      useProjectStore.setState({ activeTerminalId: 'chat-A' })
      useProjectStore.getState().openEditorTab('/p/a.ts', 'a.ts', 'proj-1')
      useProjectStore.getState().openEditorTab('/p/b.ts', 'b.ts', 'proj-1')

      const active = useProjectStore.getState().activeContentTabId['chat-A']
      useProjectStore.getState().closeEditorTab(active!)

      let s = useProjectStore.getState()
      const remaining = Object.values(s.editorTabs)
      expect(remaining.length).toBe(1)
      expect(s.activeContentTabId['chat-A']).toBe(remaining[0].id)

      useProjectStore.getState().closeEditorTab(remaining[0].id)
      s = useProjectStore.getState()
      expect(s.activeContentTabId['chat-A']).toBeNull()
    })

    test('setActiveContentTab updates only the owning chat', () => {
      useProjectStore.setState({ activeTerminalId: 'chat-A' })
      useProjectStore.getState().openEditorTab('/p/a.ts', 'a.ts', 'proj-1')
      useProjectStore.getState().openEditorTab('/p/b.ts', 'b.ts', 'proj-1')

      const firstTab = Object.values(useProjectStore.getState().editorTabs).find(
        (t) => t.fileName === 'a.ts'
      )!
      useProjectStore.getState().setActiveContentTab(firstTab.id)
      expect(useProjectStore.getState().activeContentTabId['chat-A']).toBe(firstTab.id)
    })

    test('removeTerminal clears its chat content pointer', () => {
      const t = makeTerminal({ id: 'chat-A', projectId: 'proj-1' })
      useProjectStore.setState({
        terminals: { 'chat-A': t },
        activeTerminalId: 'chat-A',
        activeProjectId: 'proj-1',
      })
      useProjectStore.getState().openEditorTab('/p/a.ts', 'a.ts', 'proj-1')
      expect(useProjectStore.getState().activeContentTabId['chat-A']).toBeTruthy()

      useProjectStore.getState().removeTerminal('chat-A')
      expect(useProjectStore.getState().activeContentTabId['chat-A']).toBeUndefined()
    })
  })

  describe('removeTerminal', () => {
    test('closing active terminal switches activeCenterTabId to next visible terminal', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'term-2': t2 },
        activeTerminalId: 'term-1',
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().removeTerminal('term-1')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBe('term-2')
    })

    test('closing last terminal sets activeCenterTabId to null', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1 },
        activeTerminalId: 'term-1',
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().removeTerminal('term-1')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBeNull()
    })

    test('closing non-active terminal does not change activeCenterTabId', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'term-2': t2 },
        activeTerminalId: 'term-1',
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().removeTerminal('term-2')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBe('term-1')
    })

    test('does not fall back to sidecar terminal when closing active', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const sidecar = makeTerminal({ id: 'sidecar-1', projectId: 'proj-1', type: 'normal' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'sidecar-1': sidecar },
        activeTerminalId: 'term-1',
        activeProjectId: 'proj-1',
        sidecarTerminals: { 'proj-1': ['sidecar-1'] },
      })

      useProjectStore.getState().removeTerminal('term-1')

      const state = useProjectStore.getState()
      // Should be null, NOT sidecar-1
      expect(state.activeTerminalId).toBeNull()
    })
  })

  describe('setActiveProject', () => {
    test('switches to first visible terminal of new project', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-2' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'term-2': t2 },
        activeTerminalId: 'term-1',
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().setActiveProject('proj-2')

      const state = useProjectStore.getState()
      expect(state.activeProjectId).toBe('proj-2')
      expect(state.activeTerminalId).toBe('term-2')
    })

    test('does not select sidecar terminal when switching project', () => {
      const sidecar = makeTerminal({ id: 'sidecar-1', projectId: 'proj-2', type: 'normal' })
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'sidecar-1': sidecar },
        activeTerminalId: 'term-1',
        activeProjectId: 'proj-1',
        sidecarTerminals: { 'proj-2': ['sidecar-1'] },
      })

      useProjectStore.getState().setActiveProject('proj-2')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBeNull()
    })

    test('sets null when project has no terminals', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1 },
        activeTerminalId: 'term-1',
        activeProjectId: 'proj-1',
      })

      useProjectStore.getState().setActiveProject('proj-2')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBeNull()
    })
  })

  describe('removeProject', () => {
    test('updates activeCenterTabId when active project is removed', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })

      useProjectStore.setState({
        terminals: { 'term-1': t1 },
        activeTerminalId: 'term-1',
        activeProjectId: 'proj-1',
        projects: [{ id: 'proj-1', name: 'Project 1', path: '/proj1' }],
      })

      useProjectStore.getState().removeProject('proj-1')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBeNull()
    })

    test('preserves activeCenterTabId when non-active project is removed', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1' })
      const t2 = makeTerminal({ id: 'term-2', projectId: 'proj-2' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'term-2': t2 },
        activeTerminalId: 'term-1',
        activeProjectId: 'proj-1',
        projects: [
          { id: 'proj-1', name: 'Project 1', path: '/proj1' },
          { id: 'proj-2', name: 'Project 2', path: '/proj2' },
        ],
      })

      useProjectStore.getState().removeProject('proj-2')

      const state = useProjectStore.getState()
      expect(state.activeTerminalId).toBe('term-1')
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
      expect(state.terminals['term-1']).toBeUndefined()
    })

    test('does not fall back to sidecar terminal when removing worktree', () => {
      const t1 = makeTerminal({ id: 'term-1', projectId: 'proj-1', worktreeId: 'wt-1' })
      const sidecar = makeTerminal({ id: 'sidecar-1', projectId: 'proj-1', type: 'normal' })

      useProjectStore.setState({
        terminals: { 'term-1': t1, 'sidecar-1': sidecar },
        activeTerminalId: 'term-1',
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
    })
  })

  describe('collapsedProjects', () => {
    test('toggleProjectCollapsed adds the entry, second call removes it', () => {
      useProjectStore.getState().toggleProjectCollapsed('proj-1')
      expect(useProjectStore.getState().collapsedProjects['proj-1']).toBe(true)

      useProjectStore.getState().toggleProjectCollapsed('proj-1')
      expect(useProjectStore.getState().collapsedProjects['proj-1']).toBeUndefined()
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

  describe('inactiveWorktreesExpanded', () => {
    test('toggleInactiveWorktrees adds the entry, second call removes it', () => {
      useProjectStore.getState().toggleInactiveWorktrees('proj-1')
      expect(useProjectStore.getState().inactiveWorktreesExpanded['proj-1']).toBe(true)

      useProjectStore.getState().toggleInactiveWorktrees('proj-1')
      expect(useProjectStore.getState().inactiveWorktreesExpanded['proj-1']).toBeUndefined()
    })

    test('toggleInactiveWorktrees leaves other entries untouched', () => {
      useProjectStore.setState({ inactiveWorktreesExpanded: { 'proj-2': true } })

      useProjectStore.getState().toggleInactiveWorktrees('proj-1')

      const state = useProjectStore.getState()
      expect(state.inactiveWorktreesExpanded['proj-1']).toBe(true)
      expect(state.inactiveWorktreesExpanded['proj-2']).toBe(true)
    })

    test('removeProject cleans up the inactiveWorktreesExpanded entry', () => {
      useProjectStore.setState({
        projects: [
          { id: 'proj-1', name: 'Project 1', path: '/proj1' },
          { id: 'proj-2', name: 'Project 2', path: '/proj2' },
        ],
        inactiveWorktreesExpanded: { 'proj-1': true, 'proj-2': true },
      })

      useProjectStore.getState().removeProject('proj-1')

      const state = useProjectStore.getState()
      expect(state.inactiveWorktreesExpanded['proj-1']).toBeUndefined()
      expect(state.inactiveWorktreesExpanded['proj-2']).toBe(true)
    })

    test('partialize persists inactiveWorktreesExpanded', () => {
      useProjectStore.setState({ inactiveWorktreesExpanded: { 'proj-1': true } })

      expect(persistCapture.partialize).toBeDefined()
      const persisted = persistCapture.partialize!(
        useProjectStore.getState() as unknown as Record<string, unknown>
      )
      expect(persisted.inactiveWorktreesExpanded).toEqual({ 'proj-1': true })
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

describe('projectStore usage indicator', () => {
  beforeEach(() => {
    usageSetEnabledMock.mockClear()
    useProjectStore.setState({ showUsageIndicator: true, usageData: null })
  })

  test('toggleUsageIndicator flips the flag and notifies main with the new value', () => {
    useProjectStore.getState().toggleUsageIndicator()

    expect(useProjectStore.getState().showUsageIndicator).toBe(false)
    expect(usageSetEnabledMock).toHaveBeenCalledTimes(1)
    expect(usageSetEnabledMock).toHaveBeenCalledWith(false)

    useProjectStore.getState().toggleUsageIndicator()

    expect(useProjectStore.getState().showUsageIndicator).toBe(true)
    expect(usageSetEnabledMock).toHaveBeenLastCalledWith(true)
  })

  test('setUsageData stores the pushed payload', () => {
    useProjectStore.getState().setUsageData({
      status: 'ok',
      fiveHour: { utilization: 45, resetsAt: '2026-06-11T17:50:00+00:00' },
    })

    expect(useProjectStore.getState().usageData?.status).toBe('ok')
    expect(useProjectStore.getState().usageData?.fiveHour?.utilization).toBe(45)

    useProjectStore.getState().setUsageData({ status: 'unavailable' })

    expect(useProjectStore.getState().usageData).toEqual({ status: 'unavailable' })
  })
})

describe('projectStore togglePinProject', () => {
  beforeEach(() => {
    mockSetPinned.mockReset()
    mockProjectList.mockReset()
    useProjectStore.setState({ projects: [], activeProjectId: null, terminals: {} })
  })

  test('pins an unpinned project via setPinned(id, true) and refreshes from main', async () => {
    const proj = makeProject({ id: 'proj-1', pinned: false })
    useProjectStore.setState({ projects: [proj] })
    mockSetPinned.mockResolvedValue({ ...proj, pinned: true })
    mockProjectList.mockResolvedValue([{ ...proj, pinned: true }])

    await useProjectStore.getState().togglePinProject('proj-1')

    expect(mockSetPinned).toHaveBeenCalledWith('proj-1', true)
    expect(useProjectStore.getState().projects[0].pinned).toBe(true)
  })

  test('unpins a pinned project via setPinned(id, false)', async () => {
    const proj = makeProject({ id: 'proj-1', pinned: true })
    useProjectStore.setState({ projects: [proj] })
    mockSetPinned.mockResolvedValue({ ...proj, pinned: false })
    mockProjectList.mockResolvedValue([{ ...proj, pinned: false }])

    await useProjectStore.getState().togglePinProject('proj-1')

    expect(mockSetPinned).toHaveBeenCalledWith('proj-1', false)
    expect(useProjectStore.getState().projects[0].pinned).toBe(false)
  })

  test('is a no-op for an unknown project id', async () => {
    useProjectStore.setState({ projects: [] })

    await useProjectStore.getState().togglePinProject('nope')

    expect(mockSetPinned).not.toHaveBeenCalled()
  })

  test('hotkey path (active project id) flips the same action as the context menu', async () => {
    const proj = makeProject({ id: 'proj-1', pinned: false })
    useProjectStore.setState({ projects: [proj], activeProjectId: 'proj-1' })
    mockSetPinned.mockResolvedValue({ ...proj, pinned: true })
    mockProjectList.mockResolvedValue([{ ...proj, pinned: true }])

    const { activeProjectId } = useProjectStore.getState()
    await useProjectStore.getState().togglePinProject(activeProjectId!)

    expect(mockSetPinned).toHaveBeenCalledWith('proj-1', true)
    expect(useProjectStore.getState().projects[0].pinned).toBe(true)
  })
})

describe('projectStore toggleInactiveSectionCollapsed pinned fallback', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [],
      activeProjectId: null,
      terminals: {},
      inactiveSectionCollapsed: false,
    })
  })

  test('collapsing switches a non-pinned terminal-less active project to one with terminals', () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 'a' }), makeProject({ id: 'b' })],
      activeProjectId: 'a',
      terminals: { t1: makeTerminal({ id: 't1', projectId: 'b' }) },
    })

    useProjectStore.getState().toggleInactiveSectionCollapsed()

    const state = useProjectStore.getState()
    expect(state.inactiveSectionCollapsed).toBe(true)
    expect(state.activeProjectId).toBe('b')
  })

  test('falls back to the first pinned project when none have terminals', () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 'a' }), makeProject({ id: 'p', pinned: true })],
      activeProjectId: 'a',
      terminals: {},
    })

    useProjectStore.getState().toggleInactiveSectionCollapsed()

    expect(useProjectStore.getState().activeProjectId).toBe('p')
  })

  test('does not switch when the active project is pinned (always visible)', () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 'p', pinned: true })],
      activeProjectId: 'p',
      terminals: {},
    })

    useProjectStore.getState().toggleInactiveSectionCollapsed()

    expect(useProjectStore.getState().activeProjectId).toBe('p')
  })

  test('does not switch when the active project has terminals', () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 'a' })],
      activeProjectId: 'a',
      terminals: { t1: makeTerminal({ id: 't1', projectId: 'a' }) },
    })

    useProjectStore.getState().toggleInactiveSectionCollapsed()

    expect(useProjectStore.getState().activeProjectId).toBe('a')
  })
})
