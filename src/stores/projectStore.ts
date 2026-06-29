import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Project,
  TerminalSession,
  TerminalState,
  FileSystemEntry,
  GitStatus,
  Worktree,
  TerminalType,
  PRStatus,
  UsageData,
  EditorTab,
  DiffTab,
  WorkingTreeDiffTab,
  BrowserTab,
  GitCommit,
  GitCommitLog,
  CenterTab,
  TasksData,
  AccountProfile,
} from '../types'
import type { HotkeyAction, HotkeyBinding, HotkeyConfig } from '../types/hotkeys'
import { DEFAULT_HOTKEY_CONFIG, mergeMissingHotkeyDefaults } from '../utils/hotkeys'
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
  activeProjectId: string | null
  activeTerminalId: string | null

  // Worktree state
  worktrees: Record<string, Worktree> // worktreeId -> Worktree

  // File explorer state
  fileExplorerVisible: boolean
  fileExplorerActiveTab: 'files' | 'git' | 'tasks' | 'automations'
  expandedPaths: Record<string, Record<string, true>>
  directoryCache: Record<string, FileSystemEntry[]>
  directoryCacheVersion: number

  // Theme state
  theme: 'light' | 'dark' | 'system'
  resolvedTheme: 'light' | 'dark'

  // Terminal status messages from CommandServer (not persisted)
  terminalStatus: Record<string, string>
  setTerminalStatus: (terminalId: string, message: string) => void

  // Git status state (not persisted)
  gitStatus: Record<string, GitStatus>
  gitStatusLoading: Record<string, boolean>

  // GitHub PR status (not persisted)
  prStatus: Record<string, PRStatus> // key (worktreeId or projectId) -> PRStatus
  ghAvailable: { installed: boolean; authenticated: boolean } | null

  // Plan-usage indicator (data not persisted; toggle is)
  usageData: UsageData | null
  setUsageData: (data: UsageData) => void
  showUsageIndicator: boolean
  toggleUsageIndicator: () => void

  // Editor tab state (includes both file editor and diff tabs)
  editorTabs: Record<string, CenterTab> // tabId -> EditorTab | DiffTab
  // Per-chat active content tab (chatId -> active content tab id). Rendered by the
  // second panel; the '' key holds content opened without an active chat.
  activeContentTabId: Record<string, string | null>
  // Show the project overview in place of the chat (hotkey/sidebar toggled)
  projectOverviewVisible: boolean

  // Hotkey configuration
  hotkeyConfig: HotkeyConfig

  // Terminal pool settings (persisted)
  terminalPoolSize: number
  setTerminalPoolSize: (size: number) => void

  // Track which mode confirmations have been dismissed (persisted)
  confirmedModeKeys: string[]
  addConfirmedModeKey: (key: string) => void

  // Settings dialog state
  settingsDialogOpen: boolean
  settingsInitialTab: string | null

  // Profile state
  profiles: AccountProfile[]
  activeProfileId: string | null
  projectVertexConfigs: Record<string, boolean> // projectId -> has Vertex AI configured

  // Profile actions
  loadProfiles: () => Promise<void>
  addProfile: (name: string) => Promise<AccountProfile | null>
  updateProfile: (id: string, updates: { name: string }) => Promise<void>
  removeProfile: (id: string) => Promise<void>
  setActiveProfile: (id: string | null) => Promise<void>
  setProfileEnvVars: (profileId: string, vars: Record<string, string>) => Promise<void>
  clearProfileEnvVars: (profileId: string) => Promise<void>
  getProfileEnvKeys: (profileId: string) => Promise<string[]>
  checkVertexConfig: (projectId: string) => Promise<void>

  // Editor tab actions
  openEditorTab: (filePath: string, fileName: string, projectId: string) => void
  closeEditorTab: (tabId: string) => void
  setEditorDirty: (tabId: string, isDirty: boolean) => void
  setEditorTabDeletedExternally: (tabId: string, isDeleted: boolean) => void
  setActiveContentTab: (tabId: string) => void
  setProjectOverviewVisible: (visible: boolean) => void

  // Hotkey actions
  updateHotkey: (action: HotkeyAction, binding: Partial<HotkeyBinding>) => void
  resetHotkey: (action: HotkeyAction) => void
  resetAllHotkeys: () => void

  // Settings dialog actions
  setSettingsDialogOpen: (open: boolean, initialTab?: string | null) => void

  // Inactive section collapse state
  inactiveSectionCollapsed: boolean
  toggleInactiveSectionCollapsed: () => void

  // Per-project collapse state (persisted; keyed record for O(1) lookup)
  collapsedProjects: Record<string, true>
  toggleProjectCollapsed: (projectId: string) => void

  // Per-project "show inactive worktrees" state (persisted). Absent = inactive
  // worktrees hidden (default); present = expanded.
  inactiveWorktreesExpanded: Record<string, true>
  toggleInactiveWorktrees: (projectId: string) => void

  // Sidecar terminal state (per context: worktreeId or projectId)
  sidecarTerminals: Record<string, string[]> // contextKey -> terminalId[]
  sidecarTerminalCollapsed: boolean
  activeSidecarTerminalId: Record<string, string | null> // per-context active terminal

  // Sidecar terminal actions
  createSidecarTerminal: (
    contextKey: string,
    projectId: string,
    worktreeId?: string
  ) => Promise<void>
  registerSidecarTerminal: (contextKey: string, terminal: TerminalSession) => void
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
  setFileExplorerActiveTab: (tab: 'files' | 'git' | 'tasks' | 'automations') => void
  toggleExpandedPath: (projectId: string, path: string) => void
  setDirectoryContents: (path: string, entries: FileSystemEntry[]) => void
  clearDirectoryCache: (projectId?: string, rootPath?: string) => void
  invalidateDirectories: (dirPaths: string[]) => void

  // Theme actions
  toggleTheme: () => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setResolvedTheme: (theme: 'light' | 'dark') => void

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
  openDiffTab: (
    filePath: string,
    fileName: string,
    commitHash: string,
    parentHash: string,
    projectId: string,
    oldPath?: string
  ) => void
  openWorkingTreeDiffTab: (
    filePath: string,
    fileName: string,
    diffKind: 'staged' | 'unstaged' | 'untracked' | 'deleted',
    projectId: string
  ) => void
  closeWorkingTreeDiffTabs: (affectedFiles?: string[]) => void
  openBrowserTab: (projectId: string) => void
  setBrowserTabUrl: (tabId: string, url: string) => void

  // Discard confirmation state
  discardingFiles: { files: string[]; isUntracked: boolean } | null
  setDiscardingFiles: (value: { files: string[]; isUntracked: boolean } | null) => void
  clearDiscardingFiles: () => void

  // Tasks state (not persisted - reload from disk)
  tasksData: Record<string, TasksData> // keyed by project.id
  tasksLoading: Record<string, boolean>

  // Tasks actions
  setTasksData: (projectId: string, data: TasksData) => void
  setTasksLoading: (projectId: string, loading: boolean) => void

  // GitHub PR status actions
  setPRStatus: (key: string, status: PRStatus) => void
  markPRStatusStale: (key: string, error: string) => void
  setGhAvailable: (available: { installed: boolean; authenticated: boolean }) => void

  // Project actions
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (id: string) => void
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'settings'>>) => Promise<void>
  togglePinProject: (id: string) => Promise<void>
  setActiveProject: (id: string | null) => void
  reorderProjects: (projectIds: string[]) => Promise<void>

  // Terminal actions
  addTerminal: (terminal: TerminalSession) => void
  removeTerminal: (id: string) => void
  updateTerminalState: (id: string, state: TerminalState) => void
  updateTerminalWorktree: (id: string, worktreeId: string) => void
  updateTerminalTitle: (id: string, title: string) => void
  updateTerminalSummary: (id: string, summary: string) => void
  updateTerminalGeneratedTitle: (id: string, generatedTitle: string) => void
  setActiveTerminal: (id: string | null) => void
  getProjectTerminals: (projectId: string) => TerminalSession[]
  getWorktreeTerminals: (worktreeId: string) => TerminalSession[]

  // Worktree actions
  addWorktree: (worktree: Worktree) => void
  removeWorktree: (id: string) => void
  getProjectWorktrees: (projectId: string) => Worktree[]
  loadWorktrees: (projectId: string) => Promise<void>

  // Initialization
  loadProjects: () => Promise<void>
}

// Guard to prevent subscriber from firing during Zustand hydration.
// Set to true inside onRehydrateStorage once hydration completes.
let isRendererReady = false

// Unsubscribe handle for the global usage:update subscription. Held so a
// re-run of onRehydrateStorage (dev HMR) replaces the listener instead of
// stacking a second one.
let unsubUsageUpdate: (() => void) | null = null

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      // Initial state
      projects: [],
      terminals: {},
      activeProjectId: null,
      activeTerminalId: null,

      // Worktree state
      worktrees: {},

      // File explorer state
      fileExplorerVisible: false,
      fileExplorerActiveTab: 'files',
      expandedPaths: {},
      directoryCache: {},
      directoryCacheVersion: 0,

      // File explorer interaction state (ephemeral)
      fileExplorerSelectedPath: null,
      fileExplorerRenamingPath: null,
      fileExplorerCreating: null,
      fileExplorerDeletingEntry: null,

      // Theme state (system follows OS preference)
      theme: 'system',
      resolvedTheme:
        typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light',

      // Terminal status messages (not persisted)
      terminalStatus: {},

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

      // Plan-usage indicator
      usageData: null,
      showUsageIndicator: true,

      // Tasks state
      tasksData: {},
      tasksLoading: {},

      // Discard confirmation state
      discardingFiles: null,

      // Editor tab state
      editorTabs: {},
      activeContentTabId: {},
      projectOverviewVisible: false,

      // Hotkey configuration
      hotkeyConfig: DEFAULT_HOTKEY_CONFIG,

      // Terminal pool settings
      terminalPoolSize: 5,

      // Confirmed mode keys
      confirmedModeKeys: [],

      // Settings dialog state
      settingsDialogOpen: false,
      settingsInitialTab: null,

      // Profile state
      profiles: [],
      activeProfileId: null,
      projectVertexConfigs: {},

      // Profile actions
      loadProfiles: async () => {
        const api = getElectronAPI()
        try {
          const profiles = await api.profile.list()
          const activeProfileId = await api.profile.getActive()
          set({ profiles, activeProfileId })
        } catch (error) {
          console.error('Failed to load profiles:', error)
        }
      },

      addProfile: async (name) => {
        const api = getElectronAPI()
        try {
          const profile = await api.profile.add(name)
          set((state) => ({ profiles: [...state.profiles, profile] }))
          return profile
        } catch (error) {
          console.error('Failed to add profile:', error)
          return null
        }
      },

      updateProfile: async (id, updates) => {
        const api = getElectronAPI()
        try {
          const updated = await api.profile.update(id, updates)
          if (updated) {
            set((state) => ({
              profiles: state.profiles.map((p) => (p.id === id ? updated : p)),
            }))
          }
        } catch (error) {
          console.error('Failed to update profile:', error)
        }
      },

      removeProfile: async (id) => {
        const api = getElectronAPI()
        try {
          await api.profile.remove(id)
          set((state) => ({
            profiles: state.profiles.filter((p) => p.id !== id),
            activeProfileId: state.activeProfileId === id ? null : state.activeProfileId,
          }))
        } catch (error) {
          console.error('Failed to remove profile:', error)
        }
      },

      setActiveProfile: async (id) => {
        const api = getElectronAPI()
        try {
          await api.profile.setActive(id)
          set({ activeProfileId: id })
        } catch (error) {
          console.error('Failed to set active profile:', error)
        }
      },

      setProfileEnvVars: async (profileId, vars) => {
        const api = getElectronAPI()
        try {
          await api.profile.setEnvVars(profileId, vars)
          // Refresh profiles to get updated envVarCount
          const profiles = await api.profile.list()
          set({ profiles })
        } catch (error) {
          console.error('Failed to set env vars:', error)
        }
      },

      clearProfileEnvVars: async (profileId) => {
        const api = getElectronAPI()
        try {
          await api.profile.clearEnvVars(profileId)
          const profiles = await api.profile.list()
          set({ profiles })
        } catch (error) {
          console.error('Failed to clear env vars:', error)
        }
      },

      getProfileEnvKeys: async (profileId) => {
        const api = getElectronAPI()
        try {
          return await api.profile.getEnvVarKeys(profileId)
        } catch (error) {
          console.error('Failed to get env var keys:', error)
          return []
        }
      },

      checkVertexConfig: async (projectId) => {
        const api = getElectronAPI()
        try {
          const hasConfig = await api.project.hasVertexConfig(projectId)
          set((state) => ({
            projectVertexConfigs: { ...state.projectVertexConfigs, [projectId]: hasConfig },
          }))
        } catch (error) {
          console.error('Failed to check Vertex config:', error)
        }
      },

      // Editor tab actions
      openEditorTab: (filePath, fileName, projectId) =>
        set((state) => {
          const chatId = state.activeTerminalId ?? ''
          // Check if already open
          const existing = Object.values(state.editorTabs).find(
            (t) => t.type !== 'browser' && t.filePath === filePath
          )
          if (existing) {
            return {
              activeContentTabId: {
                ...state.activeContentTabId,
                [existing.terminalId]: existing.id,
              },
            }
          }
          // Enforce tab limit
          const projectTabCount = Object.values(state.editorTabs).filter(
            (t) => t.projectId === projectId
          ).length
          if (projectTabCount >= MAX_EDITOR_TABS) {
            return state
          }
          const id = `editor-${crypto.randomUUID()}`
          const tab: EditorTab = {
            id,
            type: 'editor',
            filePath,
            fileName,
            isDirty: false,
            projectId,
            terminalId: chatId,
          }
          return {
            editorTabs: { ...state.editorTabs, [id]: tab },
            activeContentTabId: { ...state.activeContentTabId, [chatId]: id },
          }
        }),

      closeEditorTab: (tabId) =>
        set((state) => {
          const removed = state.editorTabs[tabId]
          const newTabs = { ...state.editorTabs }
          delete newTabs[tabId]
          // Per-chat content map: if the closed tab was its chat's active content,
          // fall back to another content tab of the same chat, else null.
          const newContent = { ...state.activeContentTabId }
          if (removed && newContent[removed.terminalId] === tabId) {
            const chatTabs = Object.values(newTabs).filter((t) => t.terminalId === removed.terminalId)
            newContent[removed.terminalId] =
              chatTabs.length > 0 ? chatTabs[chatTabs.length - 1].id : null
          }
          return {
            editorTabs: newTabs,
            activeContentTabId: newContent,
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

      setActiveContentTab: (tabId) =>
        set((state) => {
          const tab = state.editorTabs[tabId]
          if (!tab) return state
          return {
            activeContentTabId: { ...state.activeContentTabId, [tab.terminalId]: tabId },
          }
        }),

      setProjectOverviewVisible: (visible) => set({ projectOverviewVisible: visible }),

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

      resetAllHotkeys: () => set({ hotkeyConfig: DEFAULT_HOTKEY_CONFIG }),

      // Confirmed mode keys
      addConfirmedModeKey: (key) => {
        const current = get().confirmedModeKeys
        if (!current.includes(key)) {
          set({ confirmedModeKeys: [...current, key] })
        }
      },

      // Terminal pool settings
      setTerminalPoolSize: (size) => {
        const clamped = Math.max(2, Math.min(20, size))
        set({ terminalPoolSize: clamped })
        terminalPool.setMaxSize(clamped)
      },

      // Settings dialog actions
      setSettingsDialogOpen: (open, initialTab) =>
        set({ settingsDialogOpen: open, settingsInitialTab: initialTab ?? null }),

      // Inactive section collapse state
      inactiveSectionCollapsed: false,
      toggleInactiveSectionCollapsed: () =>
        set((state) => {
          const newCollapsed = !state.inactiveSectionCollapsed
          // When collapsing, auto-switch away from inactive project if selected
          if (newCollapsed && state.activeProjectId) {
            const terminalValues = Object.values(state.terminals)
            const hasTerminals = terminalValues.some((t) => t.projectId === state.activeProjectId)
            const activeProject = state.projects.find((p) => p.id === state.activeProjectId)
            // Pinned projects sit in the always-visible Pinned section; only a
            // non-pinned project with no terminals gets hidden when the inactive
            // section collapses, so switch away from it to a visible one.
            if (activeProject && !activeProject.pinned && !hasTerminals) {
              const firstVisible =
                state.projects.find((p) => terminalValues.some((t) => t.projectId === p.id)) ??
                state.projects.find((p) => p.pinned)
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

      // Per-project collapse state. Click handler and hotkey both call this
      // single action so the behavior cannot drift apart (KTD5).
      collapsedProjects: {},
      toggleProjectCollapsed: (projectId) =>
        set((state) => {
          const next = { ...state.collapsedProjects }
          if (next[projectId]) {
            delete next[projectId]
          } else {
            next[projectId] = true
          }
          return { collapsedProjects: next }
        }),

      // Per-project "show inactive worktrees" toggle. Worktrees with no running
      // session are hidden by default; this expands them. Click handler and
      // hotkey both call this single action so behavior cannot drift.
      inactiveWorktreesExpanded: {},
      toggleInactiveWorktrees: (projectId) =>
        set((state) => {
          const next = { ...state.inactiveWorktreesExpanded }
          if (next[projectId]) {
            delete next[projectId]
          } else {
            next[projectId] = true
          }
          return { inactiveWorktreesExpanded: next }
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
        if (!terminalId) return // spawn-failed event surfaces the error to the user

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

      registerSidecarTerminal: (contextKey, terminal) => {
        set((state) => {
          const existing = state.sidecarTerminals[contextKey] ?? []
          // Enforce limit of 5 sidecar terminals per context
          if (existing.length >= 5) return state
          // Prevent duplicate registration
          if (existing.includes(terminal.id)) return state
          return {
            terminals: {
              ...state.terminals,
              [terminal.id]: terminal,
            },
            sidecarTerminals: {
              ...state.sidecarTerminals,
              [contextKey]: [...existing, terminal.id],
            },
            activeSidecarTerminalId: {
              ...state.activeSidecarTerminalId,
              [contextKey]: state.activeSidecarTerminalId[contextKey] ?? terminal.id,
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

      setSidecarTerminalCollapsed: (collapsed) => set({ sidecarTerminalCollapsed: collapsed }),

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
      setFileExplorerSelectedPath: (path) => set({ fileExplorerSelectedPath: path }),

      startRename: (path) => set({ fileExplorerRenamingPath: path, fileExplorerCreating: null }),

      cancelRename: () => set({ fileExplorerRenamingPath: null }),

      startCreate: (parentPath, type) =>
        set({ fileExplorerCreating: { parentPath, type }, fileExplorerRenamingPath: null }),

      cancelCreate: () => set({ fileExplorerCreating: null }),

      setDeletingEntry: (entry) => set({ fileExplorerDeletingEntry: entry }),

      clearDeletingEntry: () => set({ fileExplorerDeletingEntry: null }),

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
          const current = state.expandedPaths[projectId] ?? {}
          const sep = oldPath.includes('\\') ? '\\' : '/'
          let changed = false
          const updated: Record<string, true> = {}
          for (const p of Object.keys(current)) {
            if (p === oldPath) {
              updated[newPath] = true
              changed = true
            } else if (p.startsWith(oldPath + sep)) {
              updated[newPath + p.slice(oldPath.length)] = true
              changed = true
            } else {
              updated[p] = true
            }
          }
          return changed ? { expandedPaths: { ...state.expandedPaths, [projectId]: updated } } : {}
        })
      },

      cleanupAfterDelete: (projectId, deletedPath) => {
        set((state) => {
          // Remove expandedPaths starting with deleted path
          const current = state.expandedPaths[projectId] ?? {}
          let changed = false
          const filtered: Record<string, true> = {}
          for (const p of Object.keys(current)) {
            if (
              p === deletedPath ||
              p.startsWith(deletedPath + '\\') ||
              p.startsWith(deletedPath + '/')
            ) {
              changed = true
            } else {
              filtered[p] = true
            }
          }

          // Remove deleted path and children from directory cache
          const newCache = { ...state.directoryCache }
          delete newCache[deletedPath]
          for (const key of Object.keys(newCache)) {
            if (key.startsWith(deletedPath + '\\') || key.startsWith(deletedPath + '/')) {
              delete newCache[key]
            }
          }

          return {
            expandedPaths: changed
              ? { ...state.expandedPaths, [projectId]: filtered }
              : state.expandedPaths,
            directoryCache: newCache,
          }
        })
      },

      // File explorer actions
      toggleFileExplorer: () =>
        set((state) => ({ fileExplorerVisible: !state.fileExplorerVisible })),

      setFileExplorerVisible: (visible) => set({ fileExplorerVisible: visible }),

      setFileExplorerActiveTab: (tab) => set({ fileExplorerActiveTab: tab }),

      toggleExpandedPath: (projectId, path) =>
        set((state) => {
          const current = { ...(state.expandedPaths[projectId] ?? {}) }
          if (current[path]) {
            delete current[path]
          } else {
            current[path] = true
          }
          return {
            expandedPaths: { ...state.expandedPaths, [projectId]: current },
          }
        }),

      setDirectoryContents: (path, entries) =>
        set((state) => ({
          directoryCache: {
            ...state.directoryCache,
            [path]: entries,
          },
        })),

      clearDirectoryCache: (projectId, rootPath) =>
        set((state) => {
          if (!projectId) {
            return { directoryCache: {}, directoryCacheVersion: state.directoryCacheVersion + 1 }
          }
          const basePath = rootPath ?? state.projects.find((p) => p.id === projectId)?.path
          if (!basePath) return state
          const newCache = { ...state.directoryCache }
          Object.keys(newCache).forEach((path) => {
            if (path.startsWith(basePath)) {
              delete newCache[path]
            }
          })
          return {
            directoryCache: newCache,
            directoryCacheVersion: state.directoryCacheVersion + 1,
          }
        }),

      invalidateDirectories: (dirPaths) =>
        set((state) => {
          const toDelete = dirPaths.filter((dir) => state.directoryCache[dir])
          if (toDelete.length === 0) return state
          const newCache = { ...state.directoryCache }
          for (const dir of toDelete) {
            delete newCache[dir]
          }
          return { directoryCache: newCache }
        }),

      // Theme actions
      toggleTheme: () =>
        set((state) => ({
          theme: state.theme === 'light' ? 'dark' : state.theme === 'dark' ? 'system' : 'light',
        })),

      setTheme: (theme) => set({ theme }),

      setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),

      // Git status actions
      setGitStatus: (projectId, status) =>
        set((state) => {
          // Shallow equality check to avoid no-op re-renders from file watcher
          const existing = state.gitStatus[projectId]
          if (
            existing &&
            existing.isClean === status.isClean &&
            existing.branch?.name === status.branch?.name &&
            existing.branch?.ahead === status.branch?.ahead &&
            existing.branch?.behind === status.branch?.behind &&
            existing.staged.length === status.staged.length &&
            existing.modified.length === status.modified.length &&
            existing.untracked.length === status.untracked.length &&
            existing.conflicted.length === status.conflicted.length
          ) {
            // Check if actual file paths changed
            const sameFiles = (a: { path: string }[], b: { path: string }[]) =>
              a.length === b.length && a.every((f, i) => f.path === b[i].path)
            if (
              sameFiles(existing.staged, status.staged) &&
              sameFiles(existing.modified, status.modified) &&
              sameFiles(existing.untracked, status.untracked) &&
              sameFiles(existing.conflicted, status.conflicted)
            ) {
              return state // no change, skip re-render
            }
          }
          return { gitStatus: { ...state.gitStatus, [projectId]: status } }
        }),

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
      openDiffTab: (filePath, fileName, commitHash, parentHash, projectId, oldPath) =>
        set((state) => {
          const chatId = state.activeTerminalId ?? ''
          // Check if already open with same commit+file
          const existing = Object.values(state.editorTabs).find(
            (t) =>
              t.type === 'diff' &&
              (t as DiffTab).commitHash === commitHash &&
              t.filePath === filePath
          )
          if (existing) {
            return {
              activeContentTabId: {
                ...state.activeContentTabId,
                [existing.terminalId]: existing.id,
              },
            }
          }
          const id = `diff-${crypto.randomUUID()}`
          const tab: DiffTab = {
            id,
            type: 'diff',
            filePath,
            fileName,
            commitHash,
            parentHash,
            projectId,
            terminalId: chatId,
            ...(oldPath ? { oldPath } : {}),
          }
          return {
            editorTabs: { ...state.editorTabs, [id]: tab },
            activeContentTabId: { ...state.activeContentTabId, [chatId]: id },
          }
        }),

      openWorkingTreeDiffTab: (filePath, fileName, diffKind, projectId) =>
        set((state) => {
          const chatId = state.activeTerminalId ?? ''
          // Check if already open with same file+diffKind
          const existing = Object.values(state.editorTabs).find(
            (t) =>
              t.type === 'working-tree-diff' &&
              (t as WorkingTreeDiffTab).diffKind === diffKind &&
              t.filePath === filePath
          )
          if (existing) {
            return {
              activeContentTabId: {
                ...state.activeContentTabId,
                [existing.terminalId]: existing.id,
              },
            }
          }
          // Enforce MAX_EDITOR_TABS
          const MAX_EDITOR_TABS = 15
          const projectTabs = Object.values(state.editorTabs).filter(
            (t) => t.projectId === projectId
          )
          const newTabs = { ...state.editorTabs }
          if (projectTabs.length >= MAX_EDITOR_TABS) {
            // Remove oldest non-active tab
            const activeContentId = state.activeContentTabId[state.activeTerminalId ?? ''] ?? null
            const toRemove = projectTabs.find((t) => t.id !== activeContentId)
            if (toRemove) delete newTabs[toRemove.id]
          }
          const id = `wt-diff-${crypto.randomUUID()}`
          const tab: WorkingTreeDiffTab = {
            id,
            type: 'working-tree-diff',
            filePath,
            fileName,
            diffKind,
            projectId,
            terminalId: chatId,
          }
          return {
            editorTabs: { ...newTabs, [id]: tab },
            activeContentTabId: { ...state.activeContentTabId, [chatId]: id },
          }
        }),

      closeWorkingTreeDiffTabs: (affectedFiles) =>
        set((state) => {
          const newTabs = { ...state.editorTabs }
          let changed = false
          for (const [id, tab] of Object.entries(newTabs)) {
            if (tab.type === 'working-tree-diff') {
              if (!affectedFiles || affectedFiles.includes(tab.filePath)) {
                delete newTabs[id]
                changed = true
              }
            }
          }
          if (!changed) return state
          // Drop per-chat content pointers to removed tabs; recompute per chat.
          const newContent = { ...state.activeContentTabId }
          for (const [chatId, activeId] of Object.entries(newContent)) {
            if (activeId && !newTabs[activeId]) {
              const chatTabs = Object.values(newTabs).filter((t) => t.terminalId === chatId)
              newContent[chatId] = chatTabs.length > 0 ? chatTabs[chatTabs.length - 1].id : null
            }
          }
          return { editorTabs: newTabs, activeContentTabId: newContent }
        }),

      openBrowserTab: (projectId) =>
        set((state) => {
          const chatId = state.activeTerminalId ?? ''
          const id = `browser-${crypto.randomUUID()}`
          const tab: BrowserTab = {
            id,
            type: 'browser',
            url: 'http://localhost:5173',
            projectId,
            terminalId: chatId,
          }
          return {
            editorTabs: { ...state.editorTabs, [id]: tab },
            activeContentTabId: { ...state.activeContentTabId, [chatId]: id },
          }
        }),

      setBrowserTabUrl: (tabId, url) =>
        set((state) => {
          const tab = state.editorTabs[tabId]
          if (!tab || tab.type !== 'browser') return state
          return { editorTabs: { ...state.editorTabs, [tabId]: { ...tab, url } } }
        }),

      // Discard confirmation actions
      setDiscardingFiles: (value) => set({ discardingFiles: value }),
      clearDiscardingFiles: () => set({ discardingFiles: null }),

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

      markPRStatusStale: (key, error) =>
        set((state) => {
          const prior = state.prStatus[key]
          // No prior data to preserve — nothing meaningful to show; skip so
          // we don't render a stale row that has never been populated.
          if (!prior) return state
          return {
            prStatus: {
              ...state.prStatus,
              [key]: { ...prior, stale: true, error, lastUpdated: Date.now() },
            },
          }
        }),

      setGhAvailable: (available) => set({ ghAvailable: available }),

      setUsageData: (data) => set({ usageData: data }),

      // Single owner of the toggle side effect: Settings UI and the hotkey
      // both call this action, so main-process start/stop cannot diverge.
      toggleUsageIndicator: () => {
        const next = !get().showUsageIndicator
        set({ showUsageIndicator: next })
        try {
          getElectronAPI()
            .usage.setEnabled(next)
            .catch(() => {})
        } catch {
          // electronAPI not available (e.g., in tests)
        }
      },

      // Project actions
      setProjects: (projects) => set({ projects }),

      addProject: (project) =>
        set((state) => ({
          projects: [...state.projects, project],
          activeProjectId: state.activeProjectId ?? project.id,
        })),

      removeProject: (id) =>
        set((state) => {
          // Collect worktree IDs for this project (needed for keyed state cleanup)
          const worktreeIds = Object.keys(state.worktrees).filter(
            (wtId) => state.worktrees[wtId].projectId === id
          )
          const cleanKeys = [id, ...worktreeIds]

          // Remove all terminals for this project
          const newTerminals = { ...state.terminals }
          Object.keys(newTerminals).forEach((termId) => {
            if (newTerminals[termId].projectId === id) {
              // Clean terminal from pool
              terminalPool.remove(termId)
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

          // Update active project if needed
          const newProjects = state.projects.filter((p) => p.id !== id)
          const newActiveProjectId =
            state.activeProjectId === id ? (newProjects[0]?.id ?? null) : state.activeProjectId

          // Clean sidecar terminals for removed project/worktrees
          const removedTerminalIds = new Set(
            Object.keys(state.terminals).filter((tid) => state.terminals[tid].projectId === id)
          )
          const newSidecarTerminals = { ...state.sidecarTerminals }
          const newActiveSidecar = { ...state.activeSidecarTerminalId }
          delete newSidecarTerminals[id]
          delete newActiveSidecar[id]
          for (const [contextKey, ids] of Object.entries(newSidecarTerminals)) {
            const filtered = ids.filter((tid) => !removedTerminalIds.has(tid))
            if (filtered.length === 0) {
              delete newSidecarTerminals[contextKey]
              delete newActiveSidecar[contextKey]
            } else {
              newSidecarTerminals[contextKey] = filtered
            }
          }

          // Clean editor tabs for this project
          const newEditorTabs = { ...state.editorTabs }
          for (const [tabId, tab] of Object.entries(newEditorTabs)) {
            if (tab.projectId === id) delete newEditorTabs[tabId]
          }
          // Clean per-chat content pointers for the removed project's chats
          const newActiveContentTabId = { ...state.activeContentTabId }
          for (const tid of removedTerminalIds) delete newActiveContentTabId[tid]

          // Clean per-project/worktree keyed state
          const newGitStatus = { ...state.gitStatus }
          const newGitStatusLoading = { ...state.gitStatusLoading }
          const newPrStatus = { ...state.prStatus }
          const newGitCommitLog = { ...state.gitCommitLog }
          const newGitCommitLogLoading = { ...state.gitCommitLogLoading }
          const newExpandedCommitHash = { ...state.expandedCommitHash }
          const newGitHeadHash = { ...state.gitHeadHash }
          const newTasksData = { ...state.tasksData }
          const newTasksLoading = { ...state.tasksLoading }
          const newExpandedPaths = { ...state.expandedPaths }
          const newCollapsedProjects = { ...state.collapsedProjects }
          delete newCollapsedProjects[id]
          const newInactiveWorktreesExpanded = { ...state.inactiveWorktreesExpanded }
          delete newInactiveWorktreesExpanded[id]
          for (const key of cleanKeys) {
            delete newGitStatus[key]
            delete newGitStatusLoading[key]
            delete newPrStatus[key]
            delete newGitCommitLog[key]
            delete newGitCommitLogLoading[key]
            delete newExpandedCommitHash[key]
            delete newGitHeadHash[key]
            delete newTasksData[key]
            delete newTasksLoading[key]
            delete newExpandedPaths[key]
          }

          // Clean directoryCache entries under project path (separator-aware)
          const projectPath = state.projects.find((p) => p.id === id)?.path
          const newDirectoryCache = { ...state.directoryCache }
          if (projectPath) {
            for (const key of Object.keys(newDirectoryCache)) {
              if (
                key === projectPath ||
                key.startsWith(projectPath + '/') ||
                key.startsWith(projectPath + '\\')
              ) {
                delete newDirectoryCache[key]
              }
            }
          }

          // Update active terminal/center tab if the removed project owned them
          const newActiveTerminalId =
            state.activeTerminalId && newTerminals[state.activeTerminalId]
              ? state.activeTerminalId
              : null
          return {
            projects: newProjects,
            terminals: newTerminals,
            worktrees: newWorktrees,
            sidecarTerminals: newSidecarTerminals,
            activeSidecarTerminalId: newActiveSidecar,
            activeProjectId: newActiveProjectId,
            activeTerminalId: newActiveTerminalId,
            activeContentTabId: newActiveContentTabId,
            editorTabs: newEditorTabs,
            gitStatus: newGitStatus,
            gitStatusLoading: newGitStatusLoading,
            prStatus: newPrStatus,
            gitCommitLog: newGitCommitLog,
            gitCommitLogLoading: newGitCommitLogLoading,
            expandedCommitHash: newExpandedCommitHash,
            gitHeadHash: newGitHeadHash,
            tasksData: newTasksData,
            tasksLoading: newTasksLoading,
            expandedPaths: newExpandedPaths,
            collapsedProjects: newCollapsedProjects,
            inactiveWorktreesExpanded: newInactiveWorktreesExpanded,
            directoryCache: newDirectoryCache,
          }
        }),

      setActiveProject: (id) =>
        set((state) => {
          // When switching projects, also update active terminal (exclude sidecar/normal)
          const visible = getVisibleTerminals(state.terminals, state.sidecarTerminals, id ?? '')
          const newActiveTerminalId = visible.length > 0 ? visible[0].id : null

          // Auto-expand: selecting a project clears its collapse entry in the
          // same set-call, so the active project can never be hidden (KTD5)
          let newCollapsedProjects = state.collapsedProjects
          if (id && newCollapsedProjects[id]) {
            newCollapsedProjects = { ...newCollapsedProjects }
            delete newCollapsedProjects[id]
          }

          // Clear directoryCache to prevent unbounded growth across project switches
          // File tree reloads lazily when the user browses
          return {
            activeProjectId: id,
            collapsedProjects: newCollapsedProjects,
            activeTerminalId: newActiveTerminalId,
            directoryCache: {},
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

      togglePinProject: async (id) => {
        const api = getElectronAPI()
        try {
          const project = get().projects.find((p) => p.id === id)
          if (!project) return
          const result = await api.project.setPinned(id, !project.pinned)
          if (result) {
            const projects = await api.project.list()
            set({ projects })
          }
        } catch (error) {
          console.error('Failed to toggle project pin:', error)
        }
      },

      // Terminal actions
      addTerminal: (terminal) =>
        set((state) => ({
          terminals: { ...state.terminals, [terminal.id]: terminal },
          activeProjectId: terminal.projectId,
          activeTerminalId: terminal.id,
          projectOverviewVisible: false,
        })),

      removeTerminal: (id) =>
        set((state) => {
          const newTerminals = { ...state.terminals }
          const removedTerminal = newTerminals[id]
          delete newTerminals[id]

          // Update active terminal if needed
          let newActiveTerminalId = state.activeTerminalId

          if (state.activeTerminalId === id) {
            const visible = getVisibleTerminals(
              newTerminals,
              state.sidecarTerminals,
              removedTerminal?.projectId ?? ''
            )
            newActiveTerminalId = visible.length > 0 ? visible[0].id : null
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

          const newActiveContentTabId = { ...state.activeContentTabId }
          delete newActiveContentTabId[id]

          return {
            terminals: newTerminals,
            activeTerminalId: newActiveTerminalId,
            activeContentTabId: newActiveContentTabId,
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

      updateTerminalWorktree: (id, worktreeId) =>
        set((state) => {
          const terminal = state.terminals[id]
          if (!terminal) return state

          return {
            terminals: {
              ...state.terminals,
              [id]: { ...terminal, worktreeId },
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

      setTerminalStatus: (terminalId, message) =>
        set((state) => ({
          terminalStatus: { ...state.terminalStatus, [terminalId]: message },
        })),

      updateTerminalSummary: (id, summary) =>
        set((state) => {
          const terminal = state.terminals[id]
          if (!terminal) return state

          return {
            terminals: {
              ...state.terminals,
              [id]: { ...terminal, summary },
            },
          }
        }),

      updateTerminalGeneratedTitle: (id, generatedTitle) =>
        set((state) => {
          const terminal = state.terminals[id]
          if (!terminal) return state

          return {
            terminals: {
              ...state.terminals,
              [id]: { ...terminal, generatedTitle },
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
            return { activeTerminalId: id, projectOverviewVisible: false }
          }

          // Als terminal in ander project zit, wissel ook van project
          if (terminal.projectId !== state.activeProjectId) {
            return {
              activeProjectId: terminal.projectId,
              activeTerminalId: id,
              projectOverviewVisible: false,
            }
          }

          return { activeTerminalId: id, projectOverviewVisible: false }
        }),

      getProjectTerminals: (projectId) => {
        const state = get()
        return getVisibleTerminals(state.terminals, state.sidecarTerminals, projectId)
      },

      getWorktreeTerminals: (worktreeId) => {
        const state = get()
        return Object.values(state.terminals).filter((t) => t.worktreeId === worktreeId)
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
              terminalPool.remove(termId)
              delete newTerminals[termId]
            }
          })

          // Clean editor tabs for this worktree
          const newEditorTabs = { ...state.editorTabs }
          if (removedWorktree) {
            for (const [tabId, tab] of Object.entries(newEditorTabs)) {
              if ('filePath' in tab && tab.filePath.startsWith(removedWorktree.path)) {
                delete newEditorTabs[tabId]
              }
            }
          }

          // Clean worktree-keyed state
          const newPrStatus = { ...state.prStatus }
          const newGitCommitLog = { ...state.gitCommitLog }
          const newGitCommitLogLoading = { ...state.gitCommitLogLoading }
          const newExpandedCommitHash = { ...state.expandedCommitHash }
          const newGitHeadHash = { ...state.gitHeadHash }
          delete newPrStatus[id]
          delete newGitCommitLog[id]
          delete newGitCommitLogLoading[id]
          delete newExpandedCommitHash[id]
          delete newGitHeadHash[id]

          // Clean expandedPaths for this worktree context
          const newExpandedPaths = { ...state.expandedPaths }
          delete newExpandedPaths[id]

          // Clean directoryCache entries under worktree path
          const newDirectoryCache = { ...state.directoryCache }
          if (removedWorktree) {
            const wtPath = removedWorktree.path
            for (const key of Object.keys(newDirectoryCache)) {
              if (key === wtPath || key.startsWith(wtPath + '/') || key.startsWith(wtPath + '\\')) {
                delete newDirectoryCache[key]
              }
            }
          }

          // Clean sidecar terminals for removed worktree
          const removedTerminalIds = new Set(
            Object.keys(state.terminals).filter((tid) => state.terminals[tid].worktreeId === id)
          )
          const newSidecarTerminals = { ...state.sidecarTerminals }
          const newActiveSidecar = { ...state.activeSidecarTerminalId }
          delete newSidecarTerminals[id]
          delete newActiveSidecar[id]
          for (const [contextKey, ids] of Object.entries(newSidecarTerminals)) {
            const filtered = ids.filter((tid) => !removedTerminalIds.has(tid))
            if (filtered.length === 0) {
              delete newSidecarTerminals[contextKey]
              delete newActiveSidecar[contextKey]
            } else {
              newSidecarTerminals[contextKey] = filtered
            }
          }

          // Update active terminal if it was in the removed worktree
          let newActiveTerminalId = state.activeTerminalId
          const activeTerminalGone = state.activeTerminalId && !newTerminals[state.activeTerminalId]
          if (activeTerminalGone) {
            const visible = getVisibleTerminals(
              newTerminals,
              newSidecarTerminals,
              removedWorktree?.projectId ?? ''
            )
            newActiveTerminalId = visible.length > 0 ? visible[0].id : null
          }
          // Clean per-chat content pointers for removed worktree chats
          const newActiveContentTabId = { ...state.activeContentTabId }
          for (const tid of removedTerminalIds) delete newActiveContentTabId[tid]

          return {
            worktrees: newWorktrees,
            terminals: newTerminals,
            editorTabs: newEditorTabs,
            sidecarTerminals: newSidecarTerminals,
            activeSidecarTerminalId: newActiveSidecar,
            prStatus: newPrStatus,
            gitCommitLog: newGitCommitLog,
            gitCommitLogLoading: newGitCommitLogLoading,
            expandedCommitHash: newExpandedCommitHash,
            gitHeadHash: newGitHeadHash,
            expandedPaths: newExpandedPaths,
            directoryCache: newDirectoryCache,
            activeTerminalId: newActiveTerminalId,
            activeContentTabId: newActiveContentTabId,
          }
        }),

      getProjectWorktrees: (projectId) => {
        const state = get()
        return Object.values(state.worktrees).filter((w) => w.projectId === projectId)
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

          // Also load profiles
          get().loadProfiles()
        } catch (error) {
          console.error('Failed to load projects:', error)
        }
      },
    }),
    {
      name: 'command-center-storage',
      partialize: (state) => ({
        activeProjectId: state.activeProjectId,
        // File explorer state
        fileExplorerVisible: state.fileExplorerVisible,
        fileExplorerActiveTab: state.fileExplorerActiveTab,
        expandedPaths: state.expandedPaths,
        // Sidecar terminal state (only collapse state, not terminal IDs)
        sidecarTerminalCollapsed: state.sidecarTerminalCollapsed,
        // Inactive section collapse state
        inactiveSectionCollapsed: state.inactiveSectionCollapsed,
        // Per-project collapse state (additive field, hydrates safely without migration)
        collapsedProjects: state.collapsedProjects,
        // Per-project show-inactive-worktrees state (additive, hydrates safely)
        inactiveWorktreesExpanded: state.inactiveWorktreesExpanded,
        // Theme state
        theme: state.theme,
        // Hotkey configuration
        hotkeyConfig: state.hotkeyConfig,
        // Terminal pool settings
        terminalPoolSize: state.terminalPoolSize,
        // Plan-usage indicator toggle
        showUsageIndicator: state.showUsageIndicator,
        // Confirmed mode dialog keys
        confirmedModeKeys: state.confirmedModeKeys,
        // Profile state
        activeProfileId: state.activeProfileId,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Zustand hydration failed:', error)
        }
        // Backfill hotkey defaults for actions added after the user's config
        // was persisted, so they show up in Settings, the Ctrl+/ overlay and
        // conflict detection. The lookup fallback in useHotkeys stays as a
        // safety net for the pre-hydration window.
        if (state?.hotkeyConfig) {
          state.hotkeyConfig = mergeMissingHotkeyDefaults(state.hotkeyConfig)
        }
        // Migrate expandedPaths from old string[] format to Record<string, true>
        if (state?.expandedPaths) {
          for (const [key, val] of Object.entries(state.expandedPaths)) {
            if (Array.isArray(val)) {
              const migrated: Record<string, true> = {}
              for (const p of val) migrated[p] = true
              ;(state.expandedPaths as Record<string, Record<string, true>>)[key] = migrated
            }
          }
        }
        // Signal main process that store is hydrated (triggers session restoration)
        try {
          const api = getElectronAPI()
          api.app.storeHydrated()
        } catch {
          // Ignore if electronAPI not available (e.g., in tests)
        }
        // Sync persisted terminal pool size to the pool singleton
        terminalPool.setMaxSize(useProjectStore.getState().terminalPoolSize)
        // Start usage polling per the persisted toggle and register the single
        // global subscription that feeds the sidebar indicator. This callback is
        // the one place the renderer subscribes to usage:update — components
        // read usageData from the store.
        try {
          const api = getElectronAPI()
          api.usage.setEnabled(useProjectStore.getState().showUsageIndicator).catch(() => {})
          unsubUsageUpdate?.()
          unsubUsageUpdate = api.usage.onUpdate((data) => {
            useProjectStore.getState().setUsageData(data)
          })
        } catch {
          // electronAPI not available (e.g., in tests)
        }
        // Mark renderer ready so the subscriber below starts processing
        isRendererReady = true
      },
    }
  )
)

// Centralized watcher: whenever activeProjectId changes, notify the main process.
// This ensures ALL code paths that modify activeProjectId trigger a watcher switch
// (setActiveProject, setActiveTerminal, addProject, removeProject, loadProjects, etc.)
useProjectStore.subscribe((state, prevState) => {
  if (!isRendererReady) return
  if (state.activeProjectId && state.activeProjectId !== prevState.activeProjectId) {
    const api = getElectronAPI()
    api.project.setActiveWatcher(state.activeProjectId).catch((err: unknown) => {
      console.error('Failed to switch active watcher:', err)
    })
  }
})
