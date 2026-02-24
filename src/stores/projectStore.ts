import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project, TerminalSession, TerminalState, TerminalLayout, FileSystemEntry, GitStatus, Worktree, TerminalType, PRStatus, EditorTab, DiffTab, GitCommit, GitCommitLog, GitCommitDetail, CenterTab, TasksData } from '../types'
import type { HotkeyAction, HotkeyBinding, HotkeyConfig } from '../types/hotkeys'
import { DEFAULT_HOTKEY_CONFIG } from '../utils/hotkeys'
import { getElectronAPI } from '../utils/electron'
import { terminalPool } from '../utils/terminalPool'

/** Maximum number of terminals allowed per project */
export const MAX_TERMINALS_PER_PROJECT = 10

/** Maximum number of editor tabs allowed per project */
export const MAX_EDITOR_TABS = 15

/** Returns center-area visible terminals for a project (excludes sidecar/normal terminals) */
function getVisibleTerminals(
  terminals: Record<string, TerminalSession>,
  sidecarTerminals: Record<string, string[]>,
  projectId: string
): TerminalSession[] {
  const sidecarIds = new Set(Object.values(sidecarTerminals).flat())
  return Object.values(terminals).filter(
    (t) => t.projectId === projectId && t.type !== 'normal' && !sidecarIds.has(t.id)
  )
}

interface ProjectStore {
  // State
  projects: Project[]
  terminals: Record<string, TerminalSession>
  layouts: Record<string, TerminalLayout>
  activeProjectId: string | null
  activeTerminalId: string | null

  // Worktree state
  worktrees: Record<string, Worktree>  // worktreeId -> Worktree

  // File explorer state
  fileExplorerVisible: boolean
  fileExplorerActiveTab: 'files' | 'git' | 'tasks'
  expandedPaths: Record<string, string[]>
  directoryCache: Record<string, FileSystemEntry[]>

  // Theme state
  theme: 'light' | 'dark'

  // Git status state (not persisted)
  gitStatus: Record<string, GitStatus>
  gitStatusLoading: Record<string, boolean>

  // GitHub PR status (not persisted)
  prStatus: Record<string, PRStatus>  // key (worktreeId or projectId) -> PRStatus
  ghAvailable: { installed: boolean; authenticated: boolean } | null

  // Editor tab state (includes both file editor and diff tabs)
  editorTabs: Record<string, CenterTab>  // tabId -> EditorTab | DiffTab
  activeCenterTabId: string | null  // can be terminal or editor tab (type derived from lookup)

  // Hotkey configuration
  hotkeyConfig: HotkeyConfig

  // Terminal pool settings (persisted)
  terminalPoolSize: number
  setTerminalPoolSize: (size: number) => void

  // Settings dialog state
  settingsDialogOpen: boolean

  // Editor tab actions
  openEditorTab: (filePath: string, fileName: string, projectId: string) => void
  closeEditorTab: (tabId: string) => void
  setEditorDirty: (tabId: string, isDirty: boolean) => void
  setEditorTabDeletedExternally: (tabId: string, isDeleted: boolean) => void
  setActiveCenterTab: (id: string) => void

  // Hotkey actions
  updateHotkey: (action: HotkeyAction, binding: Partial<HotkeyBinding>) => void
  resetHotkey: (action: HotkeyAction) => void
  resetAllHotkeys: () => void

  // Settings dialog actions
  setSettingsDialogOpen: (open: boolean) => void

  // Inactive section collapse state
  inactiveSectionCollapsed: boolean
  toggleInactiveSectionCollapsed: () => void

  // Sidecar terminal state (per context: worktreeId or projectId)
  sidecarTerminals: Record<string, string[]>  // contextKey -> terminalId[]
  sidecarTerminalCollapsed: boolean
  activeSidecarTerminalId: Record<string, string | null>  // per-context active terminal

  // Sidecar terminal actions
  createSidecarTerminal: (contextKey: string, projectId: string, worktreeId?: string) => Promise<void>
  closeSidecarTerminal: (contextKey: string, terminalId: string) => void
  setSidecarTerminalCollapsed: (collapsed: boolean) => void
  setActiveSidecarTerminal: (contextKey: string, id: string | null) => void
  getSidecarTerminals: (contextKey: string) => TerminalSession[]

  // File explorer interaction state (ephemeral, not persisted)
  fileExplorerSelectedPath: string | null
  fileExplorerRenamingPath: string | null
  fileExplorerCreating: { parentPath: string; type: 'file' | 'directory' } | null
  fileExplorerDeletingEntry: FileSystemEntry | null

  // File explorer interaction actions
  setFileExplorerSelectedPath: (path: string | null) => void
  startRename: (path: string) => void
  cancelRename: () => void
  startCreate: (parentPath: string, type: 'file' | 'directory') => void
  cancelCreate: () => void
  setDeletingEntry: (entry: FileSystemEntry | null) => void
  clearDeletingEntry: () => void
  refreshDirectory: (dirPath: string) => Promise<void>
  updateExpandedPathsAfterRename: (projectId: string, oldPath: string, newPath: string) => void
  cleanupAfterDelete: (projectId: string, deletedPath: string) => void

  // File explorer actions
  toggleFileExplorer: () => void
  setFileExplorerVisible: (visible: boolean) => void
  setFileExplorerActiveTab: (tab: 'files' | 'git' | 'tasks') => void
  toggleExpandedPath: (projectId: string, path: string) => void
  setDirectoryContents: (path: string, entries: FileSystemEntry[]) => void
  clearDirectoryCache: (projectId?: string) => void
  invalidateDirectories: (dirPaths: string[]) => void

  // Theme actions
  toggleTheme: () => void
  setTheme: (theme: 'light' | 'dark') => void

  // Git status actions
  setGitStatus: (projectId: string, status: GitStatus) => void
  setGitStatusLoading: (projectId: string, loading: boolean) => void

  // Git commit log state (not persisted)
  gitCommitLog: Record<string, { commits: GitCommit[]; hasMore: boolean; cursor: number }>
  gitCommitLogLoading: Record<string, boolean>
  expandedCommitHash: Record<string, string | null>
  gitHeadHash: Record<string, string | null>

  // Git commit log actions
  setGitCommitLog: (contextId: string, log: GitCommitLog) => void
  appendGitCommitLog: (contextId: string, log: GitCommitLog) => void
  setGitCommitLogLoading: (contextId: string, loading: boolean) => void
  setExpandedCommit: (contextId: string, hash: string | null) => void
  setGitHeadHash: (contextId: string, hash: string | null) => void

  // Diff tab actions
  openDiffTab: (filePath: string, fileName: string, commitHash: string, parentHash: string, projectId: string) => void

  // Tasks state (not persisted - reload from disk)
  tasksData: Record<string, TasksData>        // keyed by project.id
  tasksLoading: Record<string, boolean>

  // Tasks actions
  setTasksData: (projectId: string, data: TasksData) => void
  setTasksLoading: (projectId: string, loading: boolean) => void

  // GitHub PR status actions
  setPRStatus: (key: string, status: PRStatus) => void
  setGhAvailable: (available: { installed: boolean; authenticated: boolean }) => void

  // Project actions
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (id: string) => void
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'settings'>>) => Promise<void>
  setActiveProject: (id: string | null) => void
  reorderProjects: (projectIds: string[]) => Promise<void>

  // Terminal actions
  addTerminal: (terminal: TerminalSession) => void
  removeTerminal: (id: string) => void
  updateTerminalState: (id: string, state: TerminalState) => void
  updateTerminalTitle: (id: string, title: string) => void
  setActiveTerminal: (id: string | null) => void
  getProjectTerminals: (projectId: string) => TerminalSession[]
  getWorktreeTerminals: (worktreeId: string) => TerminalSession[]

  // Worktree actions
  addWorktree: (worktree: Worktree) => void
  removeWorktree: (id: string) => void
  getProjectWorktrees: (projectId: string) => Worktree[]
  loadWorktrees: (projectId: string) => Promise<void>

  // Layout actions
  getLayout: (projectId: string) => TerminalLayout | null
  addToSplit: (projectId: string, terminalId: string) => void
  removeFromSplit: (projectId: string, terminalId: string) => void
  setSplitSizes: (projectId: string, sizes: number[]) => void

  // Initialization
  loadProjects: () => Promise<void>
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      // Initial state
      projects: [],
      terminals: {},
      layouts: {},
      activeProjectId: null,
      activeTerminalId: null,

      // Worktree state
      worktrees: {},

      // File explorer state
      fileExplorerVisible: false,
      fileExplorerActiveTab: 'files',
      expandedPaths: {},
      directoryCache: {},

      // File explorer interaction state (ephemeral)
      fileExplorerSelectedPath: null,
      fileExplorerRenamingPath: null,
      fileExplorerCreating: null,
      fileExplorerDeletingEntry: null,

      // Theme state (light is default)
      theme: 'light',

      // Git status state (not persisted)
      gitStatus: {},
      gitStatusLoading: {},

      // Git commit log state (not persisted)
      gitCommitLog: {},
      gitCommitLogLoading: {},
      expandedCommitHash: {},
      gitHeadHash: {},

      // GitHub PR status (not persisted)
      prStatus: {},
      ghAvailable: null,

      // Tasks state
      tasksData: {},
      tasksLoading: {},

      // Editor tab state
      editorTabs: {},
      activeCenterTabId: null,

      // Hotkey configuration
      hotkeyConfig: DEFAULT_HOTKEY_CONFIG,

      // Terminal pool settings
      terminalPoolSize: 5,

      // Settings dialog state
      settingsDialogOpen: false,

      // Editor tab actions
      openEditorTab: (filePath, fileName, projectId) =>
        set((state) => {
          // Check if already open
          const existing = Object.values(state.editorTabs).find(
            (t) => t.filePath === filePath
          )
          if (existing) {
            return { activeCenterTabId: existing.id }
          }
          // Enforce tab limit
          const projectTabCount = Object.values(state.editorTabs).filter(
            (t) => t.projectId === projectId
          ).length
          if (projectTabCount >= MAX_EDITOR_TABS) {
            return state
          }
          const id = `editor-${crypto.randomUUID()}`
          const tab: EditorTab = { id, type: 'editor', filePath, fileName, isDirty: false, projectId }
          return {
            editorTabs: { ...state.editorTabs, [id]: tab },
            activeCenterTabId: id,
          }
        }),

      closeEditorTab: (tabId) =>
        set((state) => {
          const newTabs = { ...state.editorTabs }
          delete newTabs[tabId]
          let newActiveId = state.activeCenterTabId
          if (state.activeCenterTabId === tabId) {
            const remaining = Object.values(newTabs)
            if (remaining.length > 0) {
              newActiveId = remaining[remaining.length - 1].id
            } else {
              newActiveId = state.activeTerminalId
            }
          }
          return {
            editorTabs: newTabs,
            activeCenterTabId: newActiveId,
          }
        }),

      setEditorDirty: (tabId, isDirty) =>
        set((state) => {
          const tab = state.editorTabs[tabId]
          if (!tab || tab.type !== 'editor') return state
          if (tab.isDirty === isDirty) return state
          return {
            editorTabs: {
              ...state.editorTabs,
              [tabId]: { ...tab, isDirty },
            },
          }
        }),

      setEditorTabDeletedExternally: (tabId, isDeleted) =>
        set((state) => {
          const tab = state.editorTabs[tabId]
          if (!tab || tab.type !== 'editor') return state
          if (tab.isDeletedExternally === isDeleted) return state
          return {
            editorTabs: {
              ...state.editorTabs,
              [tabId]: { ...tab, isDeletedExternally: isDeleted },
            },
          }
        }),

      setActiveCenterTab: (id) =>
        set((state) => ({
          activeCenterTabId: id,
          // If it's a terminal, also update activeTerminalId
          ...(state.terminals[id] ? { activeTerminalId: id } : {}),
        })),

      // Hotkey actions
      updateHotkey: (action, binding) =>
        set((state) => ({
          hotkeyConfig: {
            ...state.hotkeyConfig,
            [action]: {
              ...state.hotkeyConfig[action],
              ...binding,
            },
          },
        })),

      resetHotkey: (action) =>
        set((state) => ({
          hotkeyConfig: {
            ...state.hotkeyConfig,
            [action]: DEFAULT_HOTKEY_CONFIG[action],
          },
        })),

      resetAllHotkeys: () =>
        set({ hotkeyConfig: DEFAULT_HOTKEY_CONFIG }),

      // Terminal pool settings
      setTerminalPoolSize: (size) => {
        const clamped = Math.max(2, Math.min(20, size))
        set({ terminalPoolSize: clamped })
        terminalPool.setMaxSize(clamped)
      },

      // Settings dialog actions
      setSettingsDialogOpen: (open) =>
        set({ settingsDialogOpen: open }),

      // Inactive section collapse state
      inactiveSectionCollapsed: false,
      toggleInactiveSectionCollapsed: () =>
        set((state) => {
          const newCollapsed = !state.inactiveSectionCollapsed
          // When collapsing, auto-switch away from inactive project if selected
          if (newCollapsed && state.activeProjectId) {
            const terminalValues = Object.values(state.terminals)
            const hasTerminals = terminalValues.some(
              (t) => t.projectId === state.activeProjectId
            )
            const activeProject = state.projects.find(p => p.id === state.activeProjectId)
            if (activeProject && activeProject.type !== 'workspace' && !hasTerminals) {
              const firstVisible = state.projects.find(
                (p) => p.type !== 'workspace' && terminalValues.some((t) => t.projectId === p.id)
              ) ?? state.projects.find((p) => p.type === 'workspace')
              if (firstVisible) {
                return {
                  inactiveSectionCollapsed: newCollapsed,
                  activeProjectId: firstVisible.id,
                }
              }
            }
          }
          return { inactiveSectionCollapsed: newCollapsed }
        }),

      // Sidecar terminal state
      sidecarTerminals: {},
      sidecarTerminalCollapsed: false,
      activeSidecarTerminalId: {},

      // Sidecar terminal actions
      createSidecarTerminal: async (contextKey, projectId, worktreeId) => {
        const state = get()
        const existing = state.sidecarTerminals[contextKey] ?? []
        // Enforce limit of 5 sidecar terminals per context
        if (existing.length >= 5) return

        const api = getElectronAPI()
        const terminalId = await api.terminal.create(projectId, worktreeId, 'normal')

        set((state) => {
          const existing = state.sidecarTerminals[contextKey] ?? []
          return {
            terminals: {
              ...state.terminals,
              [terminalId]: {
                id: terminalId,
                projectId,
                worktreeId: worktreeId ?? null,
                state: 'done',
                lastActivity: Date.now(),
                title: 'Terminal',
                type: 'normal' as TerminalType,
              },
            },
            sidecarTerminals: {
              ...state.sidecarTerminals,
              [contextKey]: [...existing, terminalId],
            },
            activeSidecarTerminalId: {
              ...state.activeSidecarTerminalId,
              [contextKey]: terminalId,
            },
            sidecarTerminalCollapsed: false,
            fileExplorerVisible: true,
          }
        })
      },

      closeSidecarTerminal: (contextKey, terminalId) => {
        const { sidecarTerminals, terminals, activeSidecarTerminalId } = get()
        const api = getElectronAPI()
        api.terminal.close(terminalId)

        const newTerminals = { ...terminals }
        delete newTerminals[terminalId]

        const existing = sidecarTerminals[contextKey] ?? []
        const newList = existing.filter((id) => id !== terminalId)
        const newSidecarTerminals = { ...sidecarTerminals }
        if (newList.length === 0) {
          delete newSidecarTerminals[contextKey]
        } else {
          newSidecarTerminals[contextKey] = newList
        }

        // Auto-select next if active was closed
        const newActiveSidecar = { ...activeSidecarTerminalId }
        if (activeSidecarTerminalId[contextKey] === terminalId) {
          newActiveSidecar[contextKey] = newList.length > 0 ? newList[newList.length - 1] : null
        }

        set({
          terminals: newTerminals,
          sidecarTerminals: newSidecarTerminals,
          activeSidecarTerminalId: newActiveSidecar,
        })
      },

      setSidecarTerminalCollapsed: (collapsed) =>
        set({ sidecarTerminalCollapsed: collapsed }),

      setActiveSidecarTerminal: (contextKey, id) =>
        set((state) => ({
          activeSidecarTerminalId: {
            ...state.activeSidecarTerminalId,
            [contextKey]: id,
          },
        })),

      getSidecarTerminals: (contextKey) => {
        const state = get()
        const ids = state.sidecarTerminals[contextKey] ?? []
        return ids.map((id) => state.terminals[id]).filter(Boolean)
      },

      // File explorer interaction actions
      setFileExplorerSelectedPath: (path) =>
        set({ fileExplorerSelectedPath: path }),

      startRename: (path) =>
        set({ fileExplorerRenamingPath: path, fileExplorerCreating: null }),

      cancelRename: () =>
        set({ fileExplorerRenamingPath: null }),

      startCreate: (parentPath, type) =>
        set({ fileExplorerCreating: { parentPath, type }, fileExplorerRenamingPath: null }),

      cancelCreate: () =>
        set({ fileExplorerCreating: null }),

      setDeletingEntry: (entry) =>
        set({ fileExplorerDeletingEntry: entry }),

      clearDeletingEntry: () =>
        set({ fileExplorerDeletingEntry: null }),

      refreshDirectory: async (dirPath) => {
        const api = getElectronAPI()
        try {
          const entries = await api.fs.readDirectory(dirPath)
          set((state) => ({
            directoryCache: {
              ...state.directoryCache,
              [dirPath]: entries,
            },
          }))
        } catch (error) {
          console.error('Failed to refresh directory:', error)
        }
      },

      updateExpandedPathsAfterRename: (projectId, oldPath, newPath) => {
        set((state) => {
          const currentPaths = state.expandedPaths[projectId] ?? []
          const sep = oldPath.includes('\\') ? '\\' : '/'
          const updatedPaths = currentPaths.map((p) =>
            p === oldPath ? newPath : p.startsWith(oldPath + sep) ? newPath + p.slice(oldPath.length) : p
          )
          if (JSON.stringify(updatedPaths) !== JSON.stringify(currentPaths)) {
            return { expandedPaths: { ...state.expandedPaths, [projectId]: updatedPaths } }
          }
          return {}
        })
      },

      cleanupAfterDelete: (projectId, deletedPath) => {
        set((state) => {
          // Remove expandedPaths starting with deleted path
          const currentPaths = state.expandedPaths[projectId] ?? []
          const filteredPaths = currentPaths.filter(
            (p) => p !== deletedPath && !p.startsWith(deletedPath + '\\') && !p.startsWith(deletedPath + '/')
          )

          // Remove deleted path and children from directory cache
          const newCache = { ...state.directoryCache }
          delete newCache[deletedPath]
          for (const key of Object.keys(newCache)) {
            if (key.startsWith(deletedPath + '\\') || key.startsWith(deletedPath + '/')) {
              delete newCache[key]
            }
          }

          return {
            expandedPaths: filteredPaths.length !== currentPaths.length
              ? { ...state.expandedPaths, [projectId]: filteredPaths }
              : state.expandedPaths,
            directoryCache: newCache,
          }
        })
      },

      // File explorer actions
      toggleFileExplorer: () =>
        set((state) => ({ fileExplorerVisible: !state.fileExplorerVisible })),

      setFileExplorerVisible: (visible) =>
        set({ fileExplorerVisible: visible }),

      setFileExplorerActiveTab: (tab) =>
        set({ fileExplorerActiveTab: tab }),

      toggleExpandedPath: (projectId, path) =>
        set((state) => {
          const currentPaths = state.expandedPaths[projectId] ?? []
          const isExpanded = currentPaths.includes(path)
          return {
            expandedPaths: {
              ...state.expandedPaths,
              [projectId]: isExpanded
                ? currentPaths.filter((p) => p !== path)
                : [...currentPaths, path],
            },
          }
        }),

      setDirectoryContents: (path, entries) =>
        set((state) => ({
          directoryCache: {
            ...state.directoryCache,
            [path]: entries,
          },
        })),

      clearDirectoryCache: (projectId) =>
        set((state) => {
          if (!projectId) {
            return { directoryCache: {} }
          }
          const project = state.projects.find((p) => p.id === projectId)
          if (!project) return state
          const newCache = { ...state.directoryCache }
          Object.keys(newCache).forEach((path) => {
            if (path.startsWith(project.path)) {
              delete newCache[path]
            }
          })
          return { directoryCache: newCache }
        }),

      invalidateDirectories: (dirPaths) =>
        set((state) => {
          const toDelete = dirPaths.filter(dir => state.directoryCache[dir])
          if (toDelete.length === 0) return state
          const newCache = { ...state.directoryCache }
          for (const dir of toDelete) {
            delete newCache[dir]
          }
          return { directoryCache: newCache }
        }),

      // Theme actions
      toggleTheme: () =>
        set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

      setTheme: (theme) => set({ theme }),

      // Git status actions
      setGitStatus: (projectId, status) =>
        set((state) => ({
          gitStatus: { ...state.gitStatus, [projectId]: status },
        })),

      setGitStatusLoading: (projectId, loading) =>
        set((state) => ({
          gitStatusLoading: { ...state.gitStatusLoading, [projectId]: loading },
        })),

      // Git commit log actions
      setGitCommitLog: (contextId, log) =>
        set((state) => ({
          gitCommitLog: {
            ...state.gitCommitLog,
            [contextId]: { commits: log.commits, hasMore: log.hasMore, cursor: log.commits.length },
          },
        })),

      appendGitCommitLog: (contextId, log) =>
        set((state) => {
          const existing = state.gitCommitLog[contextId]
          const commits = existing ? [...existing.commits, ...log.commits] : log.commits
          return {
            gitCommitLog: {
              ...state.gitCommitLog,
              [contextId]: { commits, hasMore: log.hasMore, cursor: commits.length },
            },
          }
        }),

      setGitCommitLogLoading: (contextId, loading) =>
        set((state) => ({
          gitCommitLogLoading: { ...state.gitCommitLogLoading, [contextId]: loading },
        })),

      setExpandedCommit: (contextId, hash) =>
        set((state) => ({
          expandedCommitHash: { ...state.expandedCommitHash, [contextId]: hash },
        })),

      setGitHeadHash: (contextId, hash) =>
        set((state) => ({
          gitHeadHash: { ...state.gitHeadHash, [contextId]: hash },
        })),

      // Diff tab actions
      openDiffTab: (filePath, fileName, commitHash, parentHash, projectId) =>
        set((state) => {
          // Check if already open with same commit+file
          const existing = Object.values(state.editorTabs).find(
            (t) => t.type === 'diff' && (t as DiffTab).commitHash === commitHash && t.filePath === filePath
          )
          if (existing) {
            return { activeCenterTabId: existing.id }
          }
          const id = `diff-${crypto.randomUUID()}`
          const tab: DiffTab = { id, type: 'diff', filePath, fileName, commitHash, parentHash, projectId }
          return {
            editorTabs: { ...state.editorTabs, [id]: tab },
            activeCenterTabId: id,
          }
        }),

      // GitHub PR status actions
      // Tasks setters
      setTasksData: (projectId, data) =>
        set((state) => ({
          tasksData: { ...state.tasksData, [projectId]: data },
        })),
      setTasksLoading: (projectId, loading) =>
        set((state) => ({
          tasksLoading: { ...state.tasksLoading, [projectId]: loading },
        })),

      setPRStatus: (key, status) =>
        set((state) => ({
          prStatus: { ...state.prStatus, [key]: status },
        })),

      setGhAvailable: (available) =>
        set({ ghAvailable: available }),

      // Project actions
      setProjects: (projects) => set({ projects }),

      addProject: (project) =>
        set((state) => ({
          projects: [...state.projects, project],
          activeProjectId: state.activeProjectId ?? project.id,
        })),

      removeProject: (id) =>
        set((state) => {
          // Remove all terminals for this project
          const newTerminals = { ...state.terminals }
          Object.keys(newTerminals).forEach((termId) => {
            if (newTerminals[termId].projectId === id) {
              delete newTerminals[termId]
            }
          })

          // Remove all worktrees for this project
          const newWorktrees = { ...state.worktrees }
          Object.keys(newWorktrees).forEach((wtId) => {
            if (newWorktrees[wtId].projectId === id) {
              delete newWorktrees[wtId]
            }
          })

          // Remove layout
          const newLayouts = { ...state.layouts }
          delete newLayouts[id]

          // Update active project if needed
          const newProjects = state.projects.filter((p) => p.id !== id)
          const newActiveProjectId =
            state.activeProjectId === id
              ? newProjects[0]?.id ?? null
              : state.activeProjectId

          // Clean sidecar terminals for removed project/worktrees
          const removedTerminalIds = new Set(
            Object.keys(state.terminals).filter((tid) => state.terminals[tid].projectId === id)
          )
          const newSidecarTerminals = { ...state.sidecarTerminals }
          const newActiveSidecar = { ...state.activeSidecarTerminalId }
          // Remove project context key and any worktree context keys
          delete newSidecarTerminals[id]
          delete newActiveSidecar[id]
          for (const wtId of Object.keys(newWorktrees)) {
            // worktrees for this project were already deleted above
          }
          // Also clean any context keys whose terminals were all removed
          for (const [contextKey, ids] of Object.entries(newSidecarTerminals)) {
            const filtered = ids.filter((tid) => !removedTerminalIds.has(tid))
            if (filtered.length === 0) {
              delete newSidecarTerminals[contextKey]
              delete newActiveSidecar[contextKey]
            } else {
              newSidecarTerminals[contextKey] = filtered
            }
          }

          // Update active terminal/center tab if the removed project owned them
          const newActiveTerminalId =
            state.activeTerminalId && newTerminals[state.activeTerminalId]
              ? state.activeTerminalId
              : null
          const newActiveCenterTabId =
            state.activeProjectId === id
              ? newActiveTerminalId
              : state.activeCenterTabId

          return {
            projects: newProjects,
            terminals: newTerminals,
            worktrees: newWorktrees,
            layouts: newLayouts,
            sidecarTerminals: newSidecarTerminals,
            activeSidecarTerminalId: newActiveSidecar,
            activeProjectId: newActiveProjectId,
            activeTerminalId: newActiveTerminalId,
            activeCenterTabId: newActiveCenterTabId,
          }
        }),

      setActiveProject: (id) =>
        set((state) => {
          // When switching projects, also update active terminal (exclude sidecar/normal)
          const visible = getVisibleTerminals(state.terminals, state.sidecarTerminals, id ?? '')
          const newActiveTerminalId = visible.length > 0 ? visible[0].id : null

          return {
            activeProjectId: id,
            activeTerminalId: newActiveTerminalId,
            activeCenterTabId: newActiveTerminalId,
            // Clear ephemeral file explorer state to prevent cross-project operations
            fileExplorerSelectedPath: null,
            fileExplorerRenamingPath: null,
            fileExplorerCreating: null,
            fileExplorerDeletingEntry: null,
          }
        }),

      updateProject: async (id, updates) => {
        const api = getElectronAPI()
        try {
          const result = await api.project.update(id, updates)
          if (result) {
            const projects = await api.project.list()
            set({ projects })
          }
        } catch (error) {
          console.error('Failed to update project:', error)
        }
      },

      reorderProjects: async (projectIds) => {
        const api = getElectronAPI()
        try {
          const projects = await api.project.reorder(projectIds)
          set({ projects })
        } catch (error) {
          console.error('Failed to reorder projects:', error)
        }
      },

      // Terminal actions
      addTerminal: (terminal) =>
        set((state) => ({
          terminals: { ...state.terminals, [terminal.id]: terminal },
          activeTerminalId: terminal.id,
          activeCenterTabId: terminal.id,
        })),

      removeTerminal: (id) =>
        set((state) => {
          const newTerminals = { ...state.terminals }
          const removedTerminal = newTerminals[id]
          delete newTerminals[id]

          // Update active terminal and center tab if needed
          let newActiveTerminalId = state.activeTerminalId
          let newActiveCenterTabId = state.activeCenterTabId

          if (state.activeTerminalId === id || state.activeCenterTabId === id) {
            const visible = getVisibleTerminals(newTerminals, state.sidecarTerminals, removedTerminal?.projectId ?? '')
            const fallbackTerminalId = visible.length > 0 ? visible[0].id : null

            if (state.activeTerminalId === id) {
              newActiveTerminalId = fallbackTerminalId
            }
            if (state.activeCenterTabId === id) {
              newActiveCenterTabId = fallbackTerminalId
            }
          }

          // Also remove from split layout if present
          const newLayouts = { ...state.layouts }
          if (removedTerminal) {
            const layout = newLayouts[removedTerminal.projectId]
            if (layout && layout.splitTerminalIds.includes(id)) {
              const newSplitIds = layout.splitTerminalIds.filter(
                (tid) => tid !== id
              )
              if (newSplitIds.length <= 1) {
                delete newLayouts[removedTerminal.projectId]
              } else {
                newLayouts[removedTerminal.projectId] = {
                  ...layout,
                  splitTerminalIds: newSplitIds,
                  splitSizes: newSplitIds.map(() => 100 / newSplitIds.length),
                }
              }
            }
          }

          // Clean stale ID from sidecarTerminals
          const newSidecarTerminals = { ...state.sidecarTerminals }
          const newActiveSidecar = { ...state.activeSidecarTerminalId }
          for (const [contextKey, ids] of Object.entries(newSidecarTerminals)) {
            if (ids.includes(id)) {
              const filtered = ids.filter((tid) => tid !== id)
              if (filtered.length === 0) {
                delete newSidecarTerminals[contextKey]
                delete newActiveSidecar[contextKey]
              } else {
                newSidecarTerminals[contextKey] = filtered
                if (newActiveSidecar[contextKey] === id) {
                  newActiveSidecar[contextKey] = filtered[filtered.length - 1]
                }
              }
            }
          }

          return {
            terminals: newTerminals,
            activeTerminalId: newActiveTerminalId,
            activeCenterTabId: newActiveCenterTabId,
            layouts: newLayouts,
            sidecarTerminals: newSidecarTerminals,
            activeSidecarTerminalId: newActiveSidecar,
          }
        }),

      updateTerminalState: (id, terminalState) =>
        set((state) => {
          const terminal = state.terminals[id]
          if (!terminal) return state

          return {
            terminals: {
              ...state.terminals,
              [id]: {
                ...terminal,
                state: terminalState,
                lastActivity: Date.now(),
              },
            },
          }
        }),

      updateTerminalTitle: (id, title) =>
        set((state) => {
          const terminal = state.terminals[id]
          if (!terminal) return state

          return {
            terminals: {
              ...state.terminals,
              [id]: { ...terminal, title },
            },
          }
        }),

      setActiveTerminal: (id) =>
        set((state) => {
          if (id === null) {
            return { activeTerminalId: null, activeCenterTabId: null }
          }

          const terminal = state.terminals[id]
          if (!terminal) {
            return { activeTerminalId: id, activeCenterTabId: id }
          }

          // Als terminal in ander project zit, wissel ook van project
          if (terminal.projectId !== state.activeProjectId) {
            return {
              activeProjectId: terminal.projectId,
              activeTerminalId: id,
              activeCenterTabId: id,
            }
          }

          return { activeTerminalId: id, activeCenterTabId: id }
        }),

      getProjectTerminals: (projectId) => {
        const state = get()
        return getVisibleTerminals(state.terminals, state.sidecarTerminals, projectId)
      },

      getWorktreeTerminals: (worktreeId) => {
        const state = get()
        return Object.values(state.terminals).filter(
          (t) => t.worktreeId === worktreeId
        )
      },

      // Worktree actions
      addWorktree: (worktree) =>
        set((state) => ({
          worktrees: { ...state.worktrees, [worktree.id]: worktree },
        })),

      removeWorktree: (id) =>
        set((state) => {
          const newWorktrees = { ...state.worktrees }
          const removedWorktree = newWorktrees[id]
          delete newWorktrees[id]

          // Remove all terminals for this worktree
          const newTerminals = { ...state.terminals }
          Object.keys(newTerminals).forEach((termId) => {
            if (newTerminals[termId].worktreeId === id) {
              delete newTerminals[termId]
            }
          })

          // Update active terminal and center tab if they were in the removed worktree
          let newActiveTerminalId = state.activeTerminalId
          let newActiveCenterTabId = state.activeCenterTabId
          const activeTerminalGone = state.activeTerminalId && !newTerminals[state.activeTerminalId]
          const activeCenterGone = state.activeCenterTabId && !newTerminals[state.activeCenterTabId] && !state.editorTabs[state.activeCenterTabId]

          if (activeTerminalGone || activeCenterGone) {
            const visible = getVisibleTerminals(newTerminals, state.sidecarTerminals, removedWorktree?.projectId ?? '')
            const fallbackTerminalId = visible.length > 0 ? visible[0].id : null

            if (activeTerminalGone) {
              newActiveTerminalId = fallbackTerminalId
            }
            if (activeCenterGone) {
              newActiveCenterTabId = fallbackTerminalId
            }
          }

          return {
            worktrees: newWorktrees,
            terminals: newTerminals,
            activeTerminalId: newActiveTerminalId,
            activeCenterTabId: newActiveCenterTabId,
          }
        }),

      getProjectWorktrees: (projectId) => {
        const state = get()
        return Object.values(state.worktrees).filter(
          (w) => w.projectId === projectId
        )
      },

      loadWorktrees: async (projectId) => {
        const api = getElectronAPI()
        try {
          const worktrees = await api.worktree.list(projectId)
          set((state) => {
            const newWorktrees = { ...state.worktrees }
            // Remove old worktrees for this project
            Object.keys(newWorktrees).forEach((id) => {
              if (newWorktrees[id].projectId === projectId) {
                delete newWorktrees[id]
              }
            })
            // Add new worktrees
            worktrees.forEach((w) => {
              newWorktrees[w.id] = w
            })
            return { worktrees: newWorktrees }
          })
        } catch (error) {
          console.error('Failed to load worktrees:', error)
        }
      },

      // Layout actions
      getLayout: (projectId) => {
        const state = get()
        return state.layouts[projectId] ?? null
      },

      addToSplit: (projectId, terminalId) =>
        set((state) => {
          const currentLayout = state.layouts[projectId] ?? {
            projectId,
            splitTerminalIds: [],
            splitSizes: [],
          }

          // Don't add if already in split or at max
          if (
            currentLayout.splitTerminalIds.includes(terminalId) ||
            currentLayout.splitTerminalIds.length >= MAX_TERMINALS_PER_PROJECT
          ) {
            return state
          }

          const newSplitIds = [...currentLayout.splitTerminalIds, terminalId]
          // Distribute sizes evenly
          const newSizes = newSplitIds.map(() => 100 / newSplitIds.length)

          return {
            layouts: {
              ...state.layouts,
              [projectId]: {
                projectId,
                splitTerminalIds: newSplitIds,
                splitSizes: newSizes,
              },
            },
          }
        }),

      removeFromSplit: (projectId, terminalId) =>
        set((state) => {
          const currentLayout = state.layouts[projectId]
          if (!currentLayout) return state

          const newSplitIds = currentLayout.splitTerminalIds.filter(
            (id) => id !== terminalId
          )

          // If only one left, clear the split
          if (newSplitIds.length <= 1) {
            const newLayouts = { ...state.layouts }
            delete newLayouts[projectId]
            return { layouts: newLayouts }
          }

          // Redistribute sizes evenly
          const newSizes = newSplitIds.map(() => 100 / newSplitIds.length)

          return {
            layouts: {
              ...state.layouts,
              [projectId]: {
                projectId,
                splitTerminalIds: newSplitIds,
                splitSizes: newSizes,
              },
            },
          }
        }),

      setSplitSizes: (projectId, sizes) =>
        set((state) => {
          const currentLayout = state.layouts[projectId]
          if (!currentLayout) return state

          return {
            layouts: {
              ...state.layouts,
              [projectId]: {
                ...currentLayout,
                splitSizes: sizes,
              },
            },
          }
        }),

      // Initialization
      loadProjects: async () => {
        const api = getElectronAPI()
        try {
          const projects = await api.project.list()
          set({ projects })

          // Set first project as active if none selected
          const state = get()
          if (!state.activeProjectId && projects.length > 0) {
            set({ activeProjectId: projects[0].id })
          }
        } catch (error) {
          console.error('Failed to load projects:', error)
        }
      },
    }),
    {
      name: 'command-center-storage',
      partialize: (state) => ({
        // Only persist layouts, not terminals (they need to be recreated)
        layouts: state.layouts,
        activeProjectId: state.activeProjectId,
        // File explorer state
        fileExplorerVisible: state.fileExplorerVisible,
        fileExplorerActiveTab: state.fileExplorerActiveTab,
        expandedPaths: state.expandedPaths,
        // Sidecar terminal state (only collapse state, not terminal IDs)
        sidecarTerminalCollapsed: state.sidecarTerminalCollapsed,
        // Inactive section collapse state
        inactiveSectionCollapsed: state.inactiveSectionCollapsed,
        // Theme state
        theme: state.theme,
        // Hotkey configuration
        hotkeyConfig: state.hotkeyConfig,
        // Terminal pool settings
        terminalPoolSize: state.terminalPoolSize,
      }),
    }
  )
)

// Sync persisted terminal pool size to the pool singleton on hydration
terminalPool.setMaxSize(useProjectStore.getState().terminalPoolSize)

// Centralized watcher: whenever activeProjectId changes, notify the main process.
// This ensures ALL code paths that modify activeProjectId trigger a watcher switch
// (setActiveProject, setActiveTerminal, addProject, removeProject, loadProjects, etc.)
useProjectStore.subscribe(
  (state, prevState) => {
    if (state.activeProjectId && state.activeProjectId !== prevState.activeProjectId) {
      const api = getElectronAPI()
      api.project.setActiveWatcher(state.activeProjectId).catch((err: unknown) => {
        console.error('Failed to switch active watcher:', err)
      })
    }
  }
)
