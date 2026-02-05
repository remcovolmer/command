import { useEffect, useMemo, useState, useCallback } from 'react'
import { Plus, FolderOpen, PanelRightOpen, PanelRightClose, Sun, Moon, RefreshCw, Check, AlertCircle, Star, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from '../../stores/projectStore'
import type { TerminalSession, Worktree, Project } from '../../types'
import { getElectronAPI } from '../../utils/electron'
import { SortableProjectList } from './SortableProjectList'
import { CreateWorktreeDialog } from '../Worktree/CreateWorktreeDialog'
import { AddProjectDialog } from '../Project/AddProjectDialog'

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
    api.update.getVersion().then(setAppVersion)
  }, [api])

  // Load projects on mount
  useEffect(() => {
    loadProjects().then(() => {
      // Load worktrees for all projects after projects are loaded
      projects.forEach((project) => {
        loadWorktrees(project.id)
      })
    })
  }, [loadProjects])

  // Load worktrees when projects change
  useEffect(() => {
    projects.forEach((project) => {
      loadWorktrees(project.id)
    })
  }, [projects.length, loadWorktrees])

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
    await api.project.remove(projectId)
    removeProject(projectId)
  }

  const handleCreateTerminal = async (projectId: string, worktreeId?: string) => {
    // Enforce 1:1 worktree-terminal coupling
    if (worktreeId) {
      const existing = Object.values(terminals).find((t) => t.worktreeId === worktreeId)
      if (existing) {
        // Already has a terminal — just select it
        setActiveTerminal(existing.id)
        return
      }
    }

    // Check terminal limit (max per project)
    const projectTerminals = Object.values(terminals).filter(
      (t) => t.projectId === projectId
    )
    if (projectTerminals.length >= MAX_TERMINALS_PER_PROJECT) {
      api.notification.show(
        'Terminal Limit',
        `Maximum ${MAX_TERMINALS_PER_PROJECT} terminals per project`
      )
      return
    }

    const terminalId = await api.terminal.create(projectId, worktreeId)

    // For worktree terminals, use the worktree name as the tab title
    const worktree = worktreeId
      ? Object.values(worktrees).find((w) => w.id === worktreeId)
      : null

    const title = worktree
      ? worktree.name
      : `Terminal ${Object.values(terminals).filter((t) => t.projectId === projectId && t.worktreeId === null).length + 1}`

    const terminal: TerminalSession = {
      id: terminalId,
      projectId,
      worktreeId: worktreeId ?? null,
      state: 'busy',
      lastActivity: Date.now(),
      title,
      type: 'claude',
    }
    addTerminal(terminal)
  }

  const handleCreateWorktree = (projectId: string) => {
    setWorktreeDialogProjectId(projectId)
  }

  const handleWorktreeCreated = (worktree: Worktree) => {
    addWorktree(worktree)
    // Automatically create a terminal in the new worktree
    handleCreateTerminal(worktree.projectId, worktree.id)
  }

  const handleRemoveWorktree = async (worktreeId: string) => {
    // Check for uncommitted changes
    const hasChanges = await api.worktree.hasChanges(worktreeId)
    if (hasChanges) {
      const confirmed = window.confirm(
        'This worktree has uncommitted changes. Are you sure you want to remove it?'
      )
      if (!confirmed) return
    }

    try {
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

  const handleCloseTerminal = (e: React.MouseEvent, terminalId: string) => {
    e.stopPropagation()
    api.terminal.close(terminalId)
    removeTerminal(terminalId)
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
    <div className="flex flex-col h-full bg-sidebar">
      {/* Logo Header */}
      <div className="flex items-center gap-2 px-4 py-5">
        <img src="favicon.png" alt="Command" className="w-6 h-6" />
        <h1 className="text-lg font-semibold text-sidebar-foreground">Command</h1>
      </div>

      {/* Add Project Button */}
      <div className="px-3 mb-2">
        <button
          onClick={handleAddProject}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-sidebar-accent hover:bg-muted text-sidebar-foreground text-sm font-medium transition-colors"
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
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
            Workspaces
          </h2>
          <ul className="space-y-1">
            {workspaceProjects.map((workspace) => (
              <li
                key={workspace.id}
                onClick={() => setActiveProject(workspace.id)}
                className={`
                  group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer
                  border-2 transition-colors duration-150
                  ${activeProjectId === workspace.id
                    ? 'border-primary/50 bg-primary/10 text-sidebar-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-muted hover:text-sidebar-foreground'}
                `}
              >
                <Star
                  className={`w-4 h-4 flex-shrink-0 ${
                    activeProjectId === workspace.id ? 'text-primary fill-primary' : 'text-muted-foreground'
                  }`}
                />
                <span className="flex-1 text-sm font-medium truncate" title={workspace.path}>
                  {workspace.name}
                </span>
                <button
                  onClick={(e) => handleRemoveProject(e, workspace.id)}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-opacity"
                  title="Remove Workspace"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Projects Section */}
      <div className="px-3 py-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
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
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-3">
          <img src="favicon.png" alt="Command" className="w-8 h-8" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              Command
            </p>
            <p className="text-xs text-muted-foreground">
              {appVersion ? `v${appVersion}` : ''}
            </p>
          </div>
          <button
            onClick={handleCheckForUpdate}
            disabled={updateStatus === 'checking'}
            className={`p-2 rounded-lg transition-colors ${
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
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : updateStatus === 'available' || updateStatus === 'up-to-date' ? (
              <Check className="w-5 h-5" />
            ) : updateStatus === 'error' ? (
              <AlertCircle className="w-5 h-5" />
            ) : (
              <RefreshCw className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg transition-colors hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={toggleFileExplorer}
            className={`p-2 rounded-lg transition-colors ${
              fileExplorerVisible
                ? 'bg-sidebar-accent text-primary'
                : 'hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground'
            }`}
            title={fileExplorerVisible ? 'Hide Files (Ctrl+Alt+B)' : 'Show Files (Ctrl+Alt+B)'}
          >
            {fileExplorerVisible ? (
              <PanelRightClose className="w-5 h-5" />
            ) : (
              <PanelRightOpen className="w-5 h-5" />
            )}
          </button>
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
