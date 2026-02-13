import { useEffect, useMemo, useState, useCallback } from 'react'
import { Plus, FolderOpen, PanelRightOpen, PanelRightClose, Sun, Moon, RefreshCw, Check, AlertCircle, Settings, Star, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore } from '../../stores/projectStore'
import type { TerminalSession, Worktree, Project } from '../../types'
import { getElectronAPI } from '../../utils/electron'
import { terminalEvents } from '../../utils/terminalEvents'
import { SortableProjectList } from './SortableProjectList'
import { CreateWorktreeDialog } from '../Worktree/CreateWorktreeDialog'
import { formatBinding, DEFAULT_HOTKEY_CONFIG } from '../../utils/hotkeys'
import { AddProjectDialog } from '../Project/AddProjectDialog'
import { TerminalListItem } from './TerminalListItem'
import { useCreateTerminal } from '../../hooks/useCreateTerminal'

export function Sidebar() {
  // Use granular selectors to prevent unnecessary re-renders
  const projects = useProjectStore((s) => s.projects)
  const terminals = useProjectStore((s) => s.terminals)
  const worktrees = useProjectStore((s) => s.worktrees)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const activeTerminalId = useProjectStore((s) => s.activeTerminalId)
  const fileExplorerVisible = useProjectStore((s) => s.fileExplorerVisible)
  const toggleFileExplorer = useProjectStore((s) => s.toggleFileExplorer)
  const theme = useProjectStore((s) => s.theme)
  const toggleTheme = useProjectStore((s) => s.toggleTheme)
  const setSettingsDialogOpen = useProjectStore((s) => s.setSettingsDialogOpen)
  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG

  // Group actions together with useShallow for stable reference
  const {
    setActiveProject,
    setActiveTerminal,
    addProject,
    removeProject,
    addTerminal,
    removeTerminal,
    addWorktree,
    removeWorktree,
    loadProjects,
    loadWorktrees,
    reorderProjects,
  } = useProjectStore(
    useShallow((s) => ({
      setActiveProject: s.setActiveProject,
      setActiveTerminal: s.setActiveTerminal,
      addProject: s.addProject,
      removeProject: s.removeProject,
      addTerminal: s.addTerminal,
      removeTerminal: s.removeTerminal,
      addWorktree: s.addWorktree,
      removeWorktree: s.removeWorktree,
      loadProjects: s.loadProjects,
      loadWorktrees: s.loadWorktrees,
      reorderProjects: s.reorderProjects,
    }))
  )

  const api = useMemo(() => getElectronAPI(), [])
  const { createTerminal } = useCreateTerminal()

  // State for worktree dialog
  const [worktreeDialogProjectId, setWorktreeDialogProjectId] = useState<string | null>(null)

  // State for add project dialog
  const [addProjectDialogOpen, setAddProjectDialogOpen] = useState(false)

  // State for app version
  const [appVersion, setAppVersion] = useState<string>('')

  // State for update check
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'up-to-date' | 'error'>('idle')
  const [latestVersion, setLatestVersion] = useState<string>('')

  // Load app version on mount
  useEffect(() => {
    api.update.getVersion().then(setAppVersion).catch((error) => {
      console.error('Failed to get app version:', error)
    })
  }, [api])

  // Load projects on mount
  useEffect(() => {
    loadProjects().then(() => {
      // Load worktrees for all projects after projects are loaded
      projects.forEach((project) => {
        loadWorktrees(project.id).catch((error) => {
          console.error(`Failed to load worktrees for project ${project.id}:`, error)
        })
      })
    }).catch((error) => {
      console.error('Failed to load projects:', error)
    })
  }, [loadProjects])

  // Load worktrees when projects change
  useEffect(() => {
    projects.forEach((project) => {
      loadWorktrees(project.id).catch((error) => {
        console.error(`Failed to load worktrees for project ${project.id}:`, error)
      })
    })
  }, [projects.length, loadWorktrees])

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
      }
      addTerminal(terminal)
      console.log(`[Session] Added restored terminal ${session.terminalId} to store`)
    })
    return unsubscribe
  }, [addTerminal])

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

  const handleRemoveProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
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
    // Automatically create a terminal in the new worktree
    createTerminal(worktree.projectId, { worktreeId: worktree.id })
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

      // Close all terminals in worktree first
      const terminalsToClose = Object.values(terminals).filter((t) => t.worktreeId === worktreeId)
      terminalsToClose.forEach((t) => {
        api.terminal.close(t.id)
        removeTerminal(t.id)
      })

      // Add delay for Windows to release file handles
      if (terminalsToClose.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      await api.worktree.remove(worktreeId, hasChanges)
      removeWorktree(worktreeId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove worktree'
      console.error('Failed to remove worktree:', error)
      api.notification.show('Error', message)
    }
  }

  const getProjectTerminals = useCallback((projectId: string): TerminalSession[] => {
    return Object.values(terminals).filter((t) => t.projectId === projectId)
  }, [terminals])

  const getProjectDirectTerminals = useCallback((projectId: string): TerminalSession[] => {
    return Object.values(terminals).filter((t) => t.projectId === projectId && t.worktreeId === null)
  }, [terminals])

  const getWorktreeTerminals = useCallback((worktreeId: string): TerminalSession[] => {
    return Object.values(terminals).filter((t) => t.worktreeId === worktreeId)
  }, [terminals])

  const getProjectWorktrees = useCallback((projectId: string): Worktree[] => {
    return Object.values(worktrees).filter((w) => w.projectId === projectId)
  }, [worktrees])

  // Split projects into workspaces (pinned at top) and regular projects
  const workspaceProjects = useMemo(() => projects.filter(p => p.type === 'workspace'), [projects])
  const regularProjects = useMemo(() => projects.filter(p => p.type !== 'workspace'), [projects])

  return (
    <>
    <div className="flex flex-col h-full bg-sidebar" data-sidebar>
      {/* Logo Header */}
      <div className="flex items-center gap-2 px-4 py-5">
        <img src="favicon.png" alt="Command" className="w-6 h-6" />
        <h1 className="text-lg font-semibold text-sidebar-foreground">Command</h1>
      </div>

      {/* Add Project Button */}
      <div className="px-3 mb-2">
        <button
          onClick={handleAddProject}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add project
        </button>
      </div>

      {/* Workspaces Section - Always visible at top
          NOTE: Workspaces use simplified rendering (not SortableProjectList) intentionally:
          - They are pinned at top and should not be reorderable via drag-and-drop
          - They have a distinct visual treatment (star icon, border) to emphasize importance
          - Future: Will gain dashboard functionality that differs from regular projects
      */}
      {workspaceProjects.length > 0 && (
        <div className="px-3 mb-2">
          <h2 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-[0.1em] px-3 mb-2">
            Workspaces
          </h2>
          <ul className="space-y-1">
            {workspaceProjects.map((workspace) => {
              const workspaceTerminals = getProjectTerminals(workspace.id)
              const isActive = activeProjectId === workspace.id
              return (
                <li key={workspace.id}>
                  <div
                    onClick={() => setActiveProject(workspace.id)}
                    className={`
                      group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer
                      transition-colors duration-150
                      ${isActive
                        ? 'bg-[var(--sidebar-highlight)] text-sidebar-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-sidebar-foreground'}
                    `}
                  >
                    <Star
                      className={`w-4 h-4 flex-shrink-0 ${
                        isActive ? 'text-primary fill-primary' : 'text-muted-foreground'
                      }`}
                    />
                    <span className="flex-1 text-sm font-medium truncate" title={workspace.path}>
                      {workspace.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCreateTerminal(workspace.id)
                      }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-opacity"
                      title="New Terminal"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleRemoveProject(e, workspace.id)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-opacity"
                      title="Remove Workspace"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Show terminals for workspaces (always visible) */}
                  {workspaceTerminals.length > 0 && (
                    <ul className="ml-6 mt-1 space-y-0.5 border-l border-border/30 pl-3">
                      {workspaceTerminals.map((terminal) => (
                        <TerminalListItem
                          key={terminal.id}
                          terminal={terminal}
                          isActive={activeTerminalId === terminal.id}
                          onSelect={() => setActiveTerminal(terminal.id)}
                          onClose={(e) => handleCloseTerminal(e, terminal.id)}
                        />
                      ))}
                    </ul>
                  )}
                  {/* Empty state for workspace with no terminals */}
                  {workspaceTerminals.length === 0 && (
                    <div className="ml-6 pl-3 py-2 border-l border-border/30">
                      <button
                        onClick={() => handleCreateTerminal(workspace.id)}
                        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        New Terminal
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Projects Section */}
      <div className="px-3 py-2">
        <h2 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-[0.1em] px-3 mb-2">
          Projects
        </h2>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto sidebar-scroll px-3">
        {regularProjects.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground mb-2">No projects yet</p>
            <button
              onClick={handleAddProject}
              className="text-sm text-primary hover:underline"
            >
              Add your first project
            </button>
          </div>
        ) : (
          <SortableProjectList
            projects={regularProjects}
            getProjectTerminals={getProjectTerminals}
            getProjectDirectTerminals={getProjectDirectTerminals}
            getProjectWorktrees={getProjectWorktrees}
            getWorktreeTerminals={getWorktreeTerminals}
            activeProjectId={activeProjectId}
            activeTerminalId={activeTerminalId}
            onSelect={setActiveProject}
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
        <div className="flex items-center">
          <span className="text-xs text-muted-foreground flex-1">
            {appVersion ? `v${appVersion}` : ''}
          </span>
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
              title={`${theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} (${formatBinding(hotkeyConfig['ui.toggleTheme'])})`}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setSettingsDialogOpen(true)}
              className="p-1.5 rounded-lg transition-colors hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground"
              title={`Settings (${formatBinding(hotkeyConfig['ui.openSettings'])})`}
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={toggleFileExplorer}
              className={`p-1.5 rounded-lg transition-colors ${
                fileExplorerVisible
                  ? 'bg-sidebar-accent text-primary'
                  : 'hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground'
              }`}
              title={`${fileExplorerVisible ? 'Hide Files' : 'Show Files'} (${formatBinding(hotkeyConfig['fileExplorer.toggle'])})`}
            >
              {fileExplorerVisible ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRightOpen className="w-4 h-4" />
              )}
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
