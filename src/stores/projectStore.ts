import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project, TerminalSession, TerminalState, TerminalLayout, FileSystemEntry, GitStatus, Worktree, TerminalType, PRStatus } from '../types'
import { getElectronAPI } from '../utils/electron'

/** Maximum number of terminals allowed per project */
export const MAX_TERMINALS_PER_PROJECT = 10

interface ProjectStore {
  // State
  projects: Project[]
  terminals: Record<string, TerminalSession>
  layouts: Record<string, TerminalLayout>
  activeProjectId: string | null
  activeTerminalId: string | null

  // Worktree state
  worktrees: Record<string, Worktree>  // worktreeId -> Worktree
  activeWorktreeId: string | null

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

  // Sidecar terminal state (per project)
  sidecarTerminals: Record<string, string | null>  // projectId -> terminalId
  sidecarTerminalCollapsed: boolean

  // Sidecar terminal actions
  createSidecarTerminal: (projectId: string) => Promise<void>
  closeSidecarTerminal: (projectId: string) => void
  setSidecarTerminalCollapsed: (collapsed: boolean) => void

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
  getProjectDirectTerminals: (projectId: string) => TerminalSession[]

  // Worktree actions
  addWorktree: (worktree: Worktree) => void
  removeWorktree: (id: string) => void
  setActiveWorktree: (id: string | null) => void
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
      activeWorktreeId: null,

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

      // Sidecar terminal state
      sidecarTerminals: {},
      sidecarTerminalCollapsed: false,

      // Sidecar terminal actions
      createSidecarTerminal: async (projectId) => {
        const api = getElectronAPI()
        const terminalId = await api.terminal.create(projectId, undefined, 'normal')

        set((state) => ({
          terminals: {
            ...state.terminals,
            [terminalId]: {
              id: terminalId,
              projectId,
              worktreeId: null,
              state: 'done',
              lastActivity: Date.now(),
              title: 'Terminal',
              type: 'normal' as TerminalType,
            },
          },
          sidecarTerminals: { ...state.sidecarTerminals, [projectId]: terminalId },
        }))
      },

      closeSidecarTerminal: (projectId) => {
        const { sidecarTerminals, terminals } = get()
        const terminalId = sidecarTerminals[projectId]
        if (terminalId) {
          const api = getElectronAPI()
          api.terminal.close(terminalId)

          const newTerminals = { ...terminals }
          delete newTerminals[terminalId]
          const newSidecarTerminals = { ...sidecarTerminals }
          delete newSidecarTerminals[projectId]

          set({ terminals: newTerminals, sidecarTerminals: newSidecarTerminals })
        }
      },

      setSidecarTerminalCollapsed: (collapsed) =>
        set({ sidecarTerminalCollapsed: collapsed }),

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

          // Update active worktree if it was in the removed project
          const newActiveWorktreeId =
            state.activeWorktreeId && !newWorktrees[state.activeWorktreeId]
              ? null
              : state.activeWorktreeId

          return {
            projects: newProjects,
            terminals: newTerminals,
            worktrees: newWorktrees,
            layouts: newLayouts,
            activeProjectId: newActiveProjectId,
            activeWorktreeId: newActiveWorktreeId,
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
          }
        }),

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

          return {
            terminals: newTerminals,
            activeTerminalId: newActiveTerminalId,
            layouts: newLayouts,
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
            return { activeTerminalId: null }
          }

          const terminal = state.terminals[id]
          if (!terminal) {
            return { activeTerminalId: id }
          }

          // Als terminal in ander project zit, wissel ook van project
          if (terminal.projectId !== state.activeProjectId) {
            return {
              activeProjectId: terminal.projectId,
              activeTerminalId: id,
            }
          }

          return { activeTerminalId: id }
        }),

      getProjectTerminals: (projectId) => {
        const state = get()
        const sidecarIds = new Set(Object.values(state.sidecarTerminals).filter(Boolean))
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

      getProjectDirectTerminals: (projectId) => {
        const state = get()
        const sidecarIds = new Set(Object.values(state.sidecarTerminals).filter(Boolean))
        return Object.values(state.terminals).filter(
          (t) => t.projectId === projectId && t.worktreeId === null && !sidecarIds.has(t.id)
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

          // Update active worktree if needed
          let newActiveWorktreeId = state.activeWorktreeId
          if (state.activeWorktreeId === id) {
            // Find another worktree in the same project or null
            const sameProjectWorktrees = Object.values(newWorktrees).filter(
              (w) => w.projectId === removedWorktree?.projectId
            )
            newActiveWorktreeId = sameProjectWorktrees.length > 0
              ? sameProjectWorktrees[0].id
              : null
          }

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
            activeWorktreeId: newActiveWorktreeId,
            activeTerminalId: newActiveTerminalId,
          }
        }),

      setActiveWorktree: (id) =>
        set({ activeWorktreeId: id }),

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
      }),
    }
  )
)
