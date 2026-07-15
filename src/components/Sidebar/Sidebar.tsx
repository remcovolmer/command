import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  Plus,
  FolderOpen,
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  Check,
  AlertCircle,
  Settings,
  Zap,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore } from '../../stores/projectStore'
import type { TerminalSession, Worktree, Project } from '../../types'
import { getElectronAPI } from '../../utils/electron'
import { terminalEvents } from '../../utils/terminalEvents'
import { closeWorktreeTerminals } from '../../utils/worktreeCleanup'
import { SortableProjectList } from './SortableProjectList'
import { UsageIndicator } from './UsageIndicator'
import { CreateWorktreeDialog } from '../Worktree/CreateWorktreeDialog'
import { formatBinding, DEFAULT_HOTKEY_CONFIG } from '../../utils/hotkeys'
import { AddProjectDialog } from '../Project/AddProjectDialog'
import { useCreateTerminal } from '../../hooks/useCreateTerminal'
import { LogoIcon } from '../LogoIcon'
import { fileWatcherEvents } from '../../utils/fileWatcherEvents'
import { isHtmlFile } from '../../utils/editorLanguages'
import { useAutomationUnreadCount } from '../../hooks/useAutomationUnreadCount'

export function Sidebar() {
  // Use granular selectors to prevent unnecessary re-renders
  const projects = useProjectStore((s) => s.projects)
  const terminals = useProjectStore((s) => s.terminals)
  const worktrees = useProjectStore((s) => s.worktrees)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const activeTerminalId = useProjectStore((s) => s.activeTerminalId)
  const theme = useProjectStore((s) => s.theme)
  const toggleTheme = useProjectStore((s) => s.toggleTheme)
  const setSettingsDialogOpen = useProjectStore((s) => s.setSettingsDialogOpen)
  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG
  const profiles = useProjectStore((s) => s.profiles)
  const activeProfileId = useProjectStore((s) => s.activeProfileId)

  // Group actions together with useShallow for stable reference
  const {
    setActiveProject,
    setActiveTerminal,
    toggleProjectCollapsed,
    addProject,
    removeProject,
    addTerminal,
    removeTerminal,
    addWorktree,
    removeWorktree,
    loadProjects,
    loadWorktrees,
    reorderProjects,
    checkVertexConfig,
    updateTerminalSummary,
    updateTerminalGeneratedTitle,
  } = useProjectStore(
    useShallow((s) => ({
      setActiveProject: s.setActiveProject,
      setActiveTerminal: s.setActiveTerminal,
      toggleProjectCollapsed: s.toggleProjectCollapsed,
      addProject: s.addProject,
      removeProject: s.removeProject,
      addTerminal: s.addTerminal,
      removeTerminal: s.removeTerminal,
      addWorktree: s.addWorktree,
      removeWorktree: s.removeWorktree,
      loadProjects: s.loadProjects,
      loadWorktrees: s.loadWorktrees,
      reorderProjects: s.reorderProjects,
      checkVertexConfig: s.checkVertexConfig,
      updateTerminalSummary: s.updateTerminalSummary,
      updateTerminalGeneratedTitle: s.updateTerminalGeneratedTitle,
    }))
  )

  const api = useMemo(() => getElectronAPI(), [])
  const { createTerminal } = useCreateTerminal()

  // Global automations entry (above the project list).
  const automationsOverviewVisible = useProjectStore((s) => s.automationsOverviewVisible)
  const setAutomationsOverviewVisible = useProjectStore((s) => s.setAutomationsOverviewVisible)
  const automationUnread = useAutomationUnreadCount()

  // State for worktree dialog
  const [worktreeDialogProjectId, setWorktreeDialogProjectId] = useState<string | null>(null)

  // State for add project dialog
  const [addProjectDialogOpen, setAddProjectDialogOpen] = useState(false)

  // State for app version
  const [appVersion, setAppVersion] = useState<string>('')

  // State for update check
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'available' | 'up-to-date' | 'error'
  >('idle')
  const [latestVersion, setLatestVersion] = useState<string>('')

  // Scroll active project into view when it changes
  const projectScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!activeProjectId || !projectScrollRef.current) return
    const el = projectScrollRef.current.querySelector(`[data-project-id="${activeProjectId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeProjectId])

  // Load app version on mount
  useEffect(() => {
    api.update
      .getVersion()
      .then(setAppVersion)
      .catch((error) => {
        console.error('Failed to get app version:', error)
      })
  }, [api])

  // Load projects on mount, then load worktrees only for active project
  useEffect(() => {
    loadProjects().catch((error) => {
      console.error('Failed to load projects:', error)
    })
  }, [loadProjects])

  // Check Vertex config for all projects (only re-run when projects added/removed)
  const checkConfigProjectIds = projects.map((p) => p.id).join(',')
  useEffect(() => {
    for (const project of projects) {
      checkVertexConfig(project.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkConfigProjectIds])

  // Load worktrees for active project (deferred: other projects load on-demand when selected)
  useEffect(() => {
    if (activeProjectId) {
      loadWorktrees(activeProjectId).catch((error) => {
        console.error(`Failed to load worktrees for project ${activeProjectId}:`, error)
      })
    }
  }, [activeProjectId, loadWorktrees])

  // React to externally-created worktrees via FileWatcher
  useEffect(() => {
    const debounceTimers = new Map<string, NodeJS.Timeout>()

    for (const project of projects) {
      fileWatcherEvents.subscribe(project.id, 'worktree-sidebar', (events) => {
        const hasWorktreeChange = events.some(
          (e) =>
            (e.type === 'dir-added' || e.type === 'dir-removed') && e.path.includes('/.worktrees/')
        )
        if (!hasWorktreeChange) return

        const existing = debounceTimers.get(project.id)
        if (existing) clearTimeout(existing)
        debounceTimers.set(
          project.id,
          setTimeout(() => {
            loadWorktrees(project.id)
            debounceTimers.delete(project.id)
          }, 1000)
        )
      })
    }

    return () => {
      for (const project of projects) {
        fileWatcherEvents.unsubscribe(project.id, 'worktree-sidebar')
      }
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer)
      }
    }
  }, [projects, loadWorktrees])

  // Listen for restored sessions (from previous app close)
  useEffect(() => {
    const unsubscribe = terminalEvents.onSessionRestored((session) => {
      const terminal: TerminalSession = {
        id: session.terminalId,
        projectId: session.projectId,
        worktreeId: session.worktreeId,
        state: 'busy', // Restored sessions start in busy state
        lastActivity: Date.now(),
        title: session.title || 'Restored',
        type: 'claude',
        summary: session.summary,
      }
      addTerminal(terminal)
      console.log(`[Session] Added restored terminal ${session.terminalId} to store`)
    })
    return unsubscribe
  }, [addTerminal])

  // Listen for server-created sidecar terminals
  useEffect(() => {
    const { registerSidecarTerminal } = useProjectStore.getState()
    const unsubscribe = terminalEvents.onSidecarCreated((contextKey, terminal) => {
      registerSidecarTerminal(contextKey, terminal)
      console.log(
        `[Sidecar] Registered server-created sidecar ${terminal.id} in context ${contextKey}`
      )
    })
    return unsubscribe
  }, [])

  // Listen for CommandServer events: status messages, editor open file/diff
  useEffect(() => {
    const unsubStatus = terminalEvents.onStatusMessage((terminalId, message) => {
      useProjectStore.getState().setTerminalStatus(terminalId, message)
    })
    const unsubOpenFile = terminalEvents.onEditorOpenFile((data) => {
      const store = useProjectStore.getState()
      // HTML opens in the built-in browser; everything else in the editor.
      // terminalId (the calling chat) targets the invoking chat's tab area
      // rather than whichever chat the user currently has focused.
      if (isHtmlFile(data.fileName)) {
        store.openFileInBrowser(data.filePath, data.fileName, data.projectId, data.terminalId)
      } else {
        store.openEditorTab(data.filePath, data.fileName, data.projectId, data.terminalId)
      }
    })
    const unsubOpenBrowser = terminalEvents.onEditorOpenBrowser((data) => {
      const store = useProjectStore.getState()
      store.openUrlInBrowser(data.url, data.projectId, data.terminalId)
    })
    return () => {
      unsubStatus()
      unsubOpenFile()
      unsubOpenBrowser()
    }
  }, [])

  // Listen for summary updates from main process (SessionIndexService)
  useEffect(() => {
    const unsubscribe = terminalEvents.onSummaryUpdate((terminalId, summary) => {
      updateTerminalSummary(terminalId, summary)
    })
    return unsubscribe
  }, [updateTerminalSummary])

  // Listen for generated title updates from main process (SessionIndexService)
  useEffect(() => {
    const unsubscribe = terminalEvents.onGeneratedTitleUpdate((terminalId, title) => {
      updateTerminalGeneratedTitle(terminalId, title)
    })
    return unsubscribe
  }, [updateTerminalGeneratedTitle])

  const handleCheckForUpdate = async () => {
    setUpdateStatus('checking')
    try {
      const result = await api.update.check()
      if (result.isDev) {
        setUpdateStatus('idle')
        api.notification.show('Development Mode', 'Auto-updates disabled in development')
        return
      }
      if (result.updateAvailable && result.version) {
        setUpdateStatus('available')
        setLatestVersion(result.version)
        api.notification.show('Update Available', `Version ${result.version} is available`)
      } else {
        setUpdateStatus('up-to-date')
        // Reset to idle after 3 seconds
        setTimeout(() => setUpdateStatus('idle'), 3000)
      }
    } catch (error) {
      console.error('Failed to check for updates:', error)
      setUpdateStatus('error')
      // Reset to idle after 3 seconds
      setTimeout(() => setUpdateStatus('idle'), 3000)
    }
  }

  const handleAddProject = () => {
    setAddProjectDialogOpen(true)
  }

  const handleProjectCreated = (project: Project) => {
    addProject(project)
  }

  const handleRemoveProject = async (projectId: string) => {
    try {
      await api.project.remove(projectId)
      removeProject(projectId)
    } catch (error) {
      console.error('Failed to remove project:', error)
    }
  }

  const handleCreateTerminal = async (projectId: string, worktreeId?: string) => {
    await createTerminal(projectId, { worktreeId })
  }

  const handleCloseTerminal = async (e: React.MouseEvent, terminalId: string) => {
    e.stopPropagation()
    try {
      await api.terminal.close(terminalId)
    } catch (error) {
      console.error('Failed to close terminal:', error)
    }
    removeTerminal(terminalId)
  }

  const handleCreateWorktree = (projectId: string) => {
    setWorktreeDialogProjectId(projectId)
  }

  const handleWorktreeCreated = (worktree: Worktree) => {
    addWorktree(worktree)
    // Automatically create a terminal in the new worktree and switch to it
    createTerminal(worktree.projectId, {
      worktreeId: worktree.id,
      onCreated: (terminalId) => setActiveTerminal(terminalId),
    })
  }

  const handleRemoveWorktree = async (worktreeId: string) => {
    try {
      // Check for uncommitted changes
      const hasChanges = await api.worktree.hasChanges(worktreeId)
      if (hasChanges) {
        const confirmed = window.confirm(
          'This worktree has uncommitted changes. Are you sure you want to remove it?'
        )
        if (!confirmed) return
      }

      // Close active terminals before removal (prevents EBUSY on Windows)
      const worktreeTerminals = Object.values(terminals).filter((t) => t.worktreeId === worktreeId)
      await closeWorktreeTerminals(worktreeTerminals, removeTerminal)

      await api.worktree.remove(worktreeId, hasChanges)
      removeWorktree(worktreeId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove worktree'
      console.error('Failed to remove worktree:', error)
      api.notification.show('Error', message)
    }
  }

  const getProjectTerminals = useCallback(
    (projectId: string): TerminalSession[] => {
      return Object.values(terminals).filter((t) => t.projectId === projectId)
    },
    [terminals]
  )

  // Chats only — sidecar 'normal' shells live in the bottom drawer, not the sidebar.
  const getProjectDirectTerminals = useCallback(
    (projectId: string): TerminalSession[] => {
      return Object.values(terminals).filter(
        (t) => t.projectId === projectId && t.worktreeId === null && t.type !== 'normal'
      )
    },
    [terminals]
  )

  const getWorktreeTerminals = useCallback(
    (worktreeId: string): TerminalSession[] => {
      return Object.values(terminals).filter(
        (t) => t.worktreeId === worktreeId && t.type !== 'normal'
      )
    },
    [terminals]
  )

  const getProjectWorktrees = useCallback(
    (projectId: string): Worktree[] => {
      return Object.values(worktrees).filter((w) => w.projectId === projectId)
    },
    [worktrees]
  )

  return (
    <>
      <div className="flex flex-col h-full bg-sidebar" data-sidebar>
        {/* Logo Header */}
        <div className="flex items-center gap-2 px-4 py-5">
          <LogoIcon className="w-6 h-6 text-primary" />
          <h1 className="text-lg font-semibold text-sidebar-foreground">Command</h1>
          <button
            onClick={handleAddProject}
            title="Add project"
            className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Global Automations entry — above the project list. Opens the overview
            in the center without changing the active project (R1, R3). */}
        <div className="px-3 pt-1 pb-1">
          <button
            onClick={() => setAutomationsOverviewVisible(true)}
            className={`w-full px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors ${
              automationsOverviewVisible
                ? 'bg-[var(--sidebar-highlight)] text-sidebar-foreground'
                : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50'
            }`}
          >
            <Zap className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left font-medium">Automations</span>
            {automationUnread > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-[18px] text-center">
                {automationUnread}
              </span>
            )}
          </button>
        </div>

        {/* Project List — section headers (Pinned/Active/Inactive) label the list;
            no standalone "Projects" header now that workspaces are gone. */}
        <div
          ref={projectScrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden sidebar-scroll px-3 pt-1"
        >
          {projects.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <FolderOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground mb-2">No projects yet</p>
              <button onClick={handleAddProject} className="text-sm text-primary hover:underline">
                Add your first project
              </button>
            </div>
          ) : (
            <SortableProjectList
              projects={projects}
              getProjectTerminals={getProjectTerminals}
              getProjectDirectTerminals={getProjectDirectTerminals}
              getProjectWorktrees={getProjectWorktrees}
              getWorktreeTerminals={getWorktreeTerminals}
              activeProjectId={activeProjectId}
              activeTerminalId={activeTerminalId}
              onSelect={(projectId) => {
                if (projectId === activeProjectId) {
                  // Clicking the already-active project toggles its sidebar collapse.
                  // (Project overview is still reachable via its hotkey.)
                  toggleProjectCollapsed(projectId)
                } else {
                  setActiveProject(projectId)
                }
              }}
              onRemove={handleRemoveProject}
              onCreateTerminal={handleCreateTerminal}
              onCreateWorktree={handleCreateWorktree}
              onRemoveWorktree={handleRemoveWorktree}
              onSelectTerminal={setActiveTerminal}
              onCloseTerminal={handleCloseTerminal}
              onReorder={reorderProjects}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-border">
          <UsageIndicator />
          <div className="flex items-center">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-xs text-muted-foreground shrink-0">
                {appVersion ? `v${appVersion}` : ''}
              </span>
              {/* Active profile badge */}
              <button
                onClick={() => setSettingsDialogOpen(true, 'accounts')}
                className={`truncate px-1.5 py-0.5 text-[10px] font-medium rounded-md transition-colors ${
                  activeProfileId
                    ? 'text-primary bg-primary/10 hover:bg-primary/20'
                    : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted'
                }`}
                title={
                  activeProfileId
                    ? `Active: ${profiles.find((p) => p.id === activeProfileId)?.name}`
                    : 'No active profile'
                }
              >
                {activeProfileId
                  ? (profiles.find((p) => p.id === activeProfileId)?.name ?? 'Unknown')
                  : 'No account'}
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleCheckForUpdate}
                disabled={updateStatus === 'checking'}
                className={`p-1.5 rounded-lg transition-colors ${
                  updateStatus === 'available'
                    ? 'bg-green-500/20 text-green-500'
                    : updateStatus === 'up-to-date'
                      ? 'text-green-500'
                      : updateStatus === 'error'
                        ? 'text-red-500'
                        : 'hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground'
                } disabled:opacity-50`}
                title={
                  updateStatus === 'checking'
                    ? 'Checking for updates...'
                    : updateStatus === 'available'
                      ? `Update available: v${latestVersion}`
                      : updateStatus === 'up-to-date'
                        ? 'Up to date'
                        : updateStatus === 'error'
                          ? 'Failed to check for updates'
                          : 'Check for updates'
                }
              >
                {updateStatus === 'checking' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : updateStatus === 'available' || updateStatus === 'up-to-date' ? (
                  <Check className="w-4 h-4" />
                ) : updateStatus === 'error' ? (
                  <AlertCircle className="w-4 h-4" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-lg transition-colors hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground"
                title={`Theme: ${theme} (${formatBinding(hotkeyConfig['ui.toggleTheme'])})`}
              >
                {theme === 'light' ? (
                  <Sun className="w-4 h-4" />
                ) : theme === 'dark' ? (
                  <Moon className="w-4 h-4" />
                ) : (
                  <Monitor className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => setSettingsDialogOpen(true)}
                className="p-1.5 rounded-lg transition-colors hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground"
                title={`Settings (${formatBinding(hotkeyConfig['ui.openSettings'])})`}
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Create Worktree Dialog */}
      {worktreeDialogProjectId && (
        <CreateWorktreeDialog
          projectId={worktreeDialogProjectId}
          isOpen={true}
          onClose={() => setWorktreeDialogProjectId(null)}
          onCreated={handleWorktreeCreated}
        />
      )}

      {/* Add Project Dialog */}
      <AddProjectDialog
        isOpen={addProjectDialogOpen}
        onClose={() => setAddProjectDialogOpen(false)}
        onCreated={handleProjectCreated}
      />
    </>
  )
}
