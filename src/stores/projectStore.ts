import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project, TerminalSession, TerminalState, TerminalLayout, FileSystemEntry, GitStatus, Worktree, TerminalType, PRStatus, EditorTab } from '../types'
import type { HotkeyAction, HotkeyBinding, HotkeyConfig } from '../types/hotkeys'
import { DEFAULT_HOTKEY_CONFIG } from '../utils/hotkeys'
import { getElectronAPI } from '../utils/electron'

/** Maximum number of terminals allowed per project */
export const MAX_TERMINALS_PER_PROJECT = 10

/** Maximum number of editor tabs allowed per project */
export const MAX_EDITOR_TABS = 15

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
  fileExplorerActiveTab: 'files' | 'git'
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

  // Editor tab state
  editorTabs: Record<string, EditorTab>  // tabId -> EditorTab
  activeCenterTabId: string | null  // can be terminal or editor tab (type derived from lookup)

  // Hotkey configuration
  hotkeyConfig: HotkeyConfig

  // Settings dialog state
  settingsDialogOpen: boolean

  // Editor tab actions
  openEditorTab: (filePath: string, fileName: string, projectId: string) => void
  closeEditorTab: (tabId: string) => void
  setEditorDirty: (tabId: string, isDirty: boolean) => void
  setActiveCenterTab: (id: string) => void

  // Hotkey actions
  updateHotkey: (action: HotkeyAction, binding: Partial<HotkeyBinding>) => void
  resetHotkey: (action: HotkeyAction) => void
  resetAllHotkeys: () => void

  // Settings dialog actions
  setSettingsDialogOpen: (open: boolean) => void

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

  // File explorer actions
  toggleFileExplorer: () => void
  setFileExplorerVisible: (visible: boolean) => void
  setFileExplorerActiveTab: (tab: 'files' | 'git') => void
  toggleExpandedPath: (projectId: string, path: string) => void
  setDirectoryContents: (path: string, entries: FileSystemEntry[]) => void
  clearDirectoryCache: (projectId?: string) => void

  // Theme actions
  toggleTheme: () => void
  setTheme: (theme: 'light' | 'dark') => void

  // Git status actions
  setGitStatus: (projectId: string, status: GitStatus) => void
  setGitStatusLoading: (projectId: string, loading: boolean) => void

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

      // Theme state (light is default)
      theme: 'light',

      // Git status state (not persisted)
      gitStatus: {},
      gitStatusLoading: {},

      // GitHub PR status (not persisted)
      prStatus: {},
      ghAvailable: null,

      // Editor tab state
      editorTabs: {},
      activeCenterTabId: null,

      // Hotkey configuration
      hotkeyConfig: DEFAULT_HOTKEY_CONFIG,

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
          if (!tab || tab.isDirty === isDirty) return state
          return {
            editorTabs: {
              ...state.editorTabs,
              [tabId]: { ...tab, isDirty },
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

      // Settings dialog actions
      setSettingsDialogOpen: (open) =>
        set({ settingsDialogOpen: open }),

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

      // GitHub PR status actions
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

          return {
            projects: newProjects,
            terminals: newTerminals,
            worktrees: newWorktrees,
            layouts: newLayouts,
            sidecarTerminals: newSidecarTerminals,
            activeSidecarTerminalId: newActiveSidecar,
            activeProjectId: newActiveProjectId,
            activeTerminalId:
              state.activeTerminalId &&
              newTerminals[state.activeTerminalId]
                ? state.activeTerminalId
                : null,
          }
        }),

      setActiveProject: (id) =>
        set((state) => {
          // When switching projects, also update active terminal
          const projectTerminals = Object.values(state.terminals).filter(
            (t) => t.projectId === id
          )
          const newActiveTerminalId =
            projectTerminals.length > 0 ? projectTerminals[0].id : null

          return {
            activeProjectId: id,
            activeTerminalId: newActiveTerminalId,
            activeCenterTabId: newActiveTerminalId,
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

          // Update active terminal if needed
          let newActiveTerminalId = state.activeTerminalId
          if (state.activeTerminalId === id) {
            const sameProjectTerminals = Object.values(newTerminals).filter(
              (t) => t.projectId === removedTerminal?.projectId
            )
            newActiveTerminalId =
              sameProjectTerminals.length > 0
                ? sameProjectTerminals[0].id
                : null
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
        const sidecarIds = new Set(Object.values(state.sidecarTerminals).flat())
        return Object.values(state.terminals).filter(
          (t) => t.projectId === projectId && !sidecarIds.has(t.id)
        )
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

          // Update active terminal if it was in the removed worktree
          let newActiveTerminalId = state.activeTerminalId
          if (state.activeTerminalId && !newTerminals[state.activeTerminalId]) {
            const projectTerminals = Object.values(newTerminals).filter(
              (t) => t.projectId === removedWorktree?.projectId
            )
            newActiveTerminalId = projectTerminals.length > 0
              ? projectTerminals[0].id
              : null
          }

          return {
            worktrees: newWorktrees,
            terminals: newTerminals,
            activeTerminalId: newActiveTerminalId,
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
        // Theme state
        theme: state.theme,
        // Hotkey configuration
        hotkeyConfig: state.hotkeyConfig,
      }),
    }
  )
)
