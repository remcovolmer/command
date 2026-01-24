import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project, TerminalSession, TerminalState, TerminalLayout, FileSystemEntry } from '../types'
import { getElectronAPI } from '../utils/electron'

/** Maximum number of terminals allowed per project */
export const MAX_TERMINALS_PER_PROJECT = 3

interface ProjectStore {
  // State
  projects: Project[]
  terminals: Record<string, TerminalSession>
  layouts: Record<string, TerminalLayout>
  activeProjectId: string | null
  activeTerminalId: string | null

  // File explorer state
  fileExplorerVisible: boolean
  expandedPaths: Record<string, string[]>
  directoryCache: Record<string, FileSystemEntry[]>

  // File explorer actions
  toggleFileExplorer: () => void
  setFileExplorerVisible: (visible: boolean) => void
  toggleExpandedPath: (projectId: string, path: string) => void
  setDirectoryContents: (path: string, entries: FileSystemEntry[]) => void
  clearDirectoryCache: (projectId?: string) => void

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
  setActiveTerminal: (id: string | null) => void
  getProjectTerminals: (projectId: string) => TerminalSession[]

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

      // File explorer state
      fileExplorerVisible: false,
      expandedPaths: {},
      directoryCache: {},

      // File explorer actions
      toggleFileExplorer: () =>
        set((state) => ({ fileExplorerVisible: !state.fileExplorerVisible })),

      setFileExplorerVisible: (visible) =>
        set({ fileExplorerVisible: visible }),

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

          // Remove layout
          const newLayouts = { ...state.layouts }
          delete newLayouts[id]

          // Update active project if needed
          const newProjects = state.projects.filter((p) => p.id !== id)
          const newActiveProjectId =
            state.activeProjectId === id
              ? newProjects[0]?.id ?? null
              : state.activeProjectId

          return {
            projects: newProjects,
            terminals: newTerminals,
            layouts: newLayouts,
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
        return Object.values(state.terminals).filter(
          (t) => t.projectId === projectId
        )
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
        expandedPaths: state.expandedPaths,
      }),
    }
  )
)
